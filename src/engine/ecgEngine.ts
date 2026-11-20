import { FilterChain, DEFAULT_FILTERS, type FilterOptions } from '../signal/filterChain';
import { RPeakDetector } from '../signal/detector';
import { SessionAccumulator, computeHeartRate, computeHrv } from '../signal/metrics';
import { computeQuality } from '../signal/quality';
import { SampleRing } from '../signal/ringBuffer';
import type { BeatEvent, DataSourceKind, EcgBatch, SourceStatus, TelemetrySnapshot } from '../types/ecg';
import type { DataSource } from '../types/source';

export interface RecordingChunk {
  startIndex: number;
  samples: Int16Array;
  leadOff: Uint8Array;
}

export interface RecordingResult {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  sourceKind: DataSourceKind;
  deviceId: string | null;
  sampleRateHz: number;
  sampleCount: number;
  avgBpm: number | null;
  minBpm: number | null;
  maxBpm: number | null;
  sdnnMs: number | null;
  rmssdMs: number | null;
  nnCount: number;
  meanQuality: number | null;
  minQuality: number | null;
  chunks: RecordingChunk[];
}

const RING_SECONDS = 60;
const CHUNK_SAMPLES = 5000;
const TELEMETRY_INTERVAL_MS = 250;
const QUALITY_WINDOW_SECONDS = 2;

const EMPTY_STATUS: SourceStatus = {
  kind: 'simulation',
  state: 'disconnected',
  deviceId: null,
  label: 'No source',
  sampleRateHz: 0,
  lastPacketAtMs: null,
  stats: { batches: 0, samples: 0, gaps: 0, outOfOrder: 0, lastBatchAtMs: null, lastSequence: null },
  error: null,
  reconnectAttempts: 0,
};

/**
 * Owns every piece of mutable signal state. React never touches samples: it
 * receives throttled telemetry snapshots and reads windows for rendering.
 */
export class EcgEngine {
  private sampleRateHz = 500;
  private ring: SampleRing;
  private filteredRing: SampleRing;
  private scratch: Float32Array;

  private filters = new FilterChain(500, DEFAULT_FILTERS);
  private detector = new RPeakDetector({ sampleRateHz: 500 });

  private source: DataSource | null = null;
  private unsubBatch: (() => void) | null = null;
  private unsubStatus: (() => void) | null = null;
  private sourceStatus: SourceStatus = EMPTY_STATUS;

  private beats: BeatEvent[] = [];
  private beatListeners = new Set<(beat: BeatEvent) => void>();
  private telemetryListeners = new Set<(snapshot: TelemetrySnapshot) => void>();
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;

  private sampleCount = 0;
  private startedAtMs: number | null = null;
  private lastBatchAtMs = 0;

  private recording = false;
  private recordStartedAt = 0;
  private recordChunks: RecordingChunk[] = [];
  private recordBuffer = new Int16Array(CHUNK_SAMPLES);
  private recordLead = new Uint8Array(CHUNK_SAMPLES);
  private recordFill = 0;
  private recordStartIndex = 0;
  private recordSource: DataSourceKind = 'simulation';
  private recordDeviceId: string | null = null;
  private recordAccumulator = new SessionAccumulator();
  private qualityCount = 0;
  private qualitySum = 0;
  private lastLeadOffPos = false;
  private lastLeadOffNeg = false;

  constructor() {
    this.ring = new SampleRing(this.sampleRateHz * RING_SECONDS);
    this.filteredRing = new SampleRing(this.sampleRateHz * RING_SECONDS);
    this.scratch = new Float32Array(this.sampleRateHz * QUALITY_WINDOW_SECONDS);
  }

  // ---------------------------------------------------------------- sources

  async setSource(source: DataSource | null): Promise<void> {
    this.unsubBatch?.();
    this.unsubStatus?.();
    this.source?.stop();
    this.unsubBatch = null;
    this.unsubStatus = null;
    this.source = source;

    if (!source) {
      this.sourceStatus = EMPTY_STATUS;
      this.emitTelemetry();
      return;
    }

    this.resetBuffers(source.kind);
    this.unsubBatch = source.subscribeBatches((batch) => this.ingest(batch));
    this.unsubStatus = source.subscribeStatus((status) => {
      // Store only: the 4 Hz telemetry loop publishes it. Emitting here as well
      // would push a full snapshot (and a React render) once per batch (~25/s).
      this.sourceStatus = status;
    });

    await source.start();
    this.startTelemetryLoop();
  }

  private resetBuffers(kind: DataSourceKind): void {
    this.sampleCount = 0;
    this.beats = [];
    this.startedAtMs = null;
    this.lastBatchAtMs = 0;
    this.detector.reset(this.sampleRateHz);
    this.filters.reset();
    this.ring = new SampleRing(this.sampleRateHz * RING_SECONDS);
    this.filteredRing = new SampleRing(this.sampleRateHz * RING_SECONDS);
    this.scratch = new Float32Array(this.sampleRateHz * QUALITY_WINDOW_SECONDS);
    this.sourceStatus = { ...this.sourceStatus, kind };
    this.qualityCount = 0;
    this.qualitySum = 0;
    this.lastLeadOffPos = false;
    this.lastLeadOffNeg = false;
  }

  setFilters(options: FilterOptions): void {
    this.filters.configure(this.sampleRateHz, options);
  }

  // ---------------------------------------------------------------- ingest

  private ingest(batch: EcgBatch): void {
    if (batch.sampleRateHz !== this.sampleRateHz) {
      this.sampleRateHz = batch.sampleRateHz;
      this.ring = new SampleRing(this.sampleRateHz * RING_SECONDS);
      this.filteredRing = new SampleRing(this.sampleRateHz * RING_SECONDS);
      this.scratch = new Float32Array(this.sampleRateHz * QUALITY_WINDOW_SECONDS);
      this.filters.configure(this.sampleRateHz, DEFAULT_FILTERS);
      this.detector.reset(this.sampleRateHz);
      this.sampleCount = 0;
    }

    if (this.startedAtMs === null) this.startedAtMs = batch.receivedAtMs;
    this.lastBatchAtMs = batch.receivedAtMs;
    this.recordSource = batch.sourceKind;
    this.recordDeviceId = batch.deviceId;
    this.lastLeadOffPos = batch.leadOffPos;
    this.lastLeadOffNeg = batch.leadOffNeg;

    const leadOff = batch.leadOffPos || batch.leadOffNeg ? 1 : 0;
    const samples = batch.samples;

    for (let i = 0; i < samples.length; i += 1) {
      const raw = samples[i] ?? 0;
      const filtered = this.filters.process(raw);
      this.ring.push(raw, leadOff);
      this.filteredRing.push(filtered, leadOff);
      this.sampleCount += 1;

      if (this.recording) this.appendRecordingSample(raw, leadOff);

      const beat = this.detector.push(filtered);
      if (beat) this.handleBeat(beat);
    }
  }

  private handleBeat(beat: BeatEvent): void {
    this.beats.push(beat);
    if (this.beats.length > 400) this.beats.shift();

    if (this.recording && beat.rrMs !== null && beat.valid) {
      this.recordAccumulator.addValidInterval(beat.rrMs);
    }

    for (const listener of this.beatListeners) listener(beat);
  }

  // ------------------------------------------------------------- recording

  startRecording(): void {
    this.recording = true;
    this.recordStartedAt = Date.now();
    this.recordChunks = [];
    this.recordBuffer = new Int16Array(CHUNK_SAMPLES);
    this.recordLead = new Uint8Array(CHUNK_SAMPLES);
    this.recordFill = 0;
    this.recordStartIndex = Math.max(0, this.ring.oldestIndex);
    this.recordAccumulator = new SessionAccumulator();
    this.qualityCount = 0;
    this.qualitySum = 0;
  }

  private appendRecordingSample(raw: number, leadOff: number): void {
    if (this.recordFill >= CHUNK_SAMPLES) this.flushChunk();
    this.recordBuffer[this.recordFill] = Math.max(-32768, Math.min(32767, Math.round(raw)));
    this.recordLead[this.recordFill] = leadOff;
    this.recordFill += 1;
  }

  private flushChunk(): void {
    if (this.recordFill === 0) return;
    const samples = this.recordBuffer.slice(0, this.recordFill);
    const leadOff = this.recordLead.slice(0, this.recordFill);
    const lastStart = this.recordChunks.length
      ? (this.recordChunks[this.recordChunks.length - 1]?.startIndex ?? 0) +
        (this.recordChunks[this.recordChunks.length - 1]?.samples.length ?? 0)
      : this.recordStartIndex;
    this.recordChunks.push({ startIndex: lastStart, samples, leadOff });
    this.recordBuffer = new Int16Array(CHUNK_SAMPLES);
    this.recordLead = new Uint8Array(CHUNK_SAMPLES);
    this.recordFill = 0;
  }

  get isRecording(): boolean {
    return this.recording;
  }

  stopRecording(): RecordingResult | null {
    if (!this.recording) return null;
    this.flushChunk();
    this.recording = false;

    const summary = this.recordAccumulator.summary();
    const nn = this.detector.validRrMs;
    const hrv = computeHrv(nn.slice(-1000));
    const endedAt = Date.now();
    const sampleCount = this.recordChunks.reduce((acc, chunk) => acc + chunk.samples.length, 0);

    const result: RecordingResult = {
      startedAt: this.recordStartedAt,
      endedAt,
      durationMs: endedAt - this.recordStartedAt,
      sourceKind: this.recordSource,
      deviceId: this.recordDeviceId,
      sampleRateHz: this.sampleRateHz,
      sampleCount,
      avgBpm: summary.meanRrMs ? 60000 / summary.meanRrMs : null,
      minBpm: summary.minBpm,
      maxBpm: summary.maxBpm,
      sdnnMs: hrv.sdnnMs,
      rmssdMs: hrv.rmssdMs,
      nnCount: hrv.nnCount,
      meanQuality: this.qualityCount ? this.qualitySum / this.qualityCount : null,
      minQuality: summary.minQuality,
      chunks: this.recordChunks,
    };

    this.recordChunks = [];
    return result;
  }

  // ------------------------------------------------------------- telemetry

  subscribeTelemetry(listener: (snapshot: TelemetrySnapshot) => void): () => void {
    this.telemetryListeners.add(listener);
    listener(this.buildTelemetry());
    return () => this.telemetryListeners.delete(listener);
  }

  subscribeBeats(listener: (beat: BeatEvent) => void): () => void {
    this.beatListeners.add(listener);
    return () => this.beatListeners.delete(listener);
  }

  private startTelemetryLoop(): void {
    if (this.telemetryTimer) return;
    this.telemetryTimer = setInterval(() => this.emitTelemetry(), TELEMETRY_INTERVAL_MS);
  }

  private emitTelemetry(): void {
    const snapshot = this.buildTelemetry();
    for (const listener of this.telemetryListeners) listener(snapshot);
  }

  buildTelemetry(): TelemetrySnapshot {
    const nn = this.detector.validRrMs;
    const count = this.ring.copyLast(this.scratch);
    const quality = computeQuality({
      samples: this.scratch,
      count,
      sampleRateHz: this.sampleRateHz,
      leadOffPos: this.lastLeadOffPos,
      leadOffNeg: this.lastLeadOffNeg,
      recentRr: nn.slice(-12),
    });

    if (this.recording) {
      this.qualityCount += 1;
      this.qualitySum += quality.score;
      this.recordAccumulator.addQuality(quality.score);
    }

    const window = Math.max(1, Math.min(this.ring.size, Math.round(this.sampleRateHz * 2)));
    const range = this.ring.range(this.ring.lastIndex - window + 1, this.ring.lastIndex);

    return {
      sourceKind: this.sourceStatus.kind,
      deviceId: this.sourceStatus.deviceId,
      connection: this.sourceStatus,
      heartRate: computeHeartRate(nn, this.beats.length),
      hrv: computeHrv(nn),
      quality,
      elapsedMs: this.startedAtMs === null ? 0 : performance.now() - this.startedAtMs,
      sampleAgeMs: this.lastBatchAtMs ? performance.now() - this.lastBatchAtMs : Number.POSITIVE_INFINITY,
      sampleCount: this.sampleCount,
      sampleRateHz: this.sampleRateHz,
      range,
      artifacts: this.detector.artifactCount,
    };
  }

  // -------------------------------------------------------------- rendering

  getSampleRate(): number {
    return this.sampleRateHz;
  }

  getSampleCount(): number {
    return this.sampleCount;
  }

  getLastIndex(): number {
    return this.ring.lastIndex;
  }

  getBeats(): readonly BeatEvent[] {
    return this.beats;
  }

  /** Valid NN intervals currently held by the detector (bounded, newest last). */
  getValidRr(): number[] {
    return this.detector.validRrMs;
  }

  getArtifactCount(): number {
    return this.detector.artifactCount;
  }

  /** Oldest absolute index still resident in the ring buffer. */
  getOldestIndex(): number {
    return this.ring.oldestIndex;
  }

  /**
   * Copy the newest `seconds` of samples into `out` (oldest first).
   * Returns the number of samples written.
   */
  copyWindow(seconds: number, mode: 'raw' | 'filtered', out: Float32Array): number {
    const ring = mode === 'raw' ? this.ring : this.filteredRing;
    const target = Math.min(out.length, Math.round(seconds * this.sampleRateHz), ring.size);
    if (target <= 0) return 0;
    const start = ring.lastIndex - target + 1;
    for (let i = 0; i < target; i += 1) out[i] = ring.at(start + i);
    return target;
  }

  /** Copy an arbitrary absolute range (used by the pause/inspect view). */
  copyRange(fromAbs: number, toAbs: number, mode: 'raw' | 'filtered', out: Float32Array): number {
    const ring = mode === 'raw' ? this.ring : this.filteredRing;
    const len = Math.min(out.length, toAbs - fromAbs + 1);
    for (let i = 0; i < len; i += 1) out[i] = ring.at(fromAbs + i);
    return len;
  }

  dispose(): void {
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    this.telemetryTimer = null;
    this.unsubBatch?.();
    this.unsubStatus?.();
    this.source?.stop();
    this.source = null;
    this.telemetryListeners.clear();
    this.beatListeners.clear();
  }
}

/** Single engine instance for the whole app. */
export const ecgEngine = new EcgEngine();
