import { afterEach, describe, expect, it } from 'vitest';
import { EcgSynthesizer } from '../../src/data/ecgSynthesizer';
import { EcgEngine } from '../../src/engine/ecgEngine';
import type { EcgBatch, SourceStatus } from '../../src/types/ecg';
import type { BatchListener, DataSource, StatusListener } from '../../src/types/source';

/**
 * Minimal data source double: lets the test push exact batches into the engine
 * so ingest, detection, telemetry and recording can be asserted deterministically.
 */
class FakeSource implements DataSource {
  readonly kind = 'hardware' as const;
  private batchListeners = new Set<BatchListener>();
  private statusListeners = new Set<StatusListener>();
  private status: SourceStatus = {
    kind: 'hardware',
    state: 'disconnected',
    deviceId: 'test-device',
    label: 'test',
    sampleRateHz: 500,
    lastPacketAtMs: null,
    stats: { batches: 0, samples: 0, gaps: 0, outOfOrder: 0, lastBatchAtMs: null, lastSequence: null },
    error: null,
    reconnectAttempts: 0,
  };

  async start(): Promise<void> {
    this.status = { ...this.status, state: 'streaming' };
    this.statusListeners.forEach((listener) => listener(this.status));
  }

  stop(): void {
    this.status = { ...this.status, state: 'disconnected' };
    this.statusListeners.forEach((listener) => listener(this.status));
  }

  subscribeBatches(listener: BatchListener): () => void {
    this.batchListeners.add(listener);
    return () => this.batchListeners.delete(listener);
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): SourceStatus {
    return this.status;
  }

  emit(batch: EcgBatch): void {
    this.status = {
      ...this.status,
      state: 'streaming',
      lastPacketAtMs: batch.receivedAtMs,
      stats: {
        ...this.status.stats,
        batches: this.status.stats.batches + 1,
        samples: this.status.stats.samples + batch.samples.length,
        lastBatchAtMs: batch.receivedAtMs,
        lastSequence: batch.seq,
      },
    };
    this.batchListeners.forEach((listener) => listener(batch));
  }
}

let engine: EcgEngine | null = null;

afterEach(() => {
  engine?.dispose();
  engine = null;
});

describe('EcgEngine integration', () => {
  it('ingests batches, detects beats and reports telemetry', async () => {
    const source = new FakeSource();
    engine = new EcgEngine();
    await engine.setSource(source);

    const synth = new EcgSynthesizer({
      bpm: 72,
      noise: 0,
      wander: 0,
      hum: 0,
      amplitude: 1400,
      irregularity: 0,
      leadOff: false,
      sampleRateHz: 500,
    });

    const batchSize = 25;
    const batches = 320; // 16 s at 500 Hz
    for (let seq = 0; seq < batches; seq += 1) {
      const samples = synth.generate(batchSize);
      source.emit({
        deviceId: 'test-device',
        seq,
        sampleRateHz: 500,
        deviceTimeMs: (seq * batchSize * 1000) / 500,
        samples,
        leadOffPos: false,
        leadOffNeg: false,
        receivedAtMs: performance.now(),
        sourceKind: 'hardware',
      });
    }

    const telemetry = engine.buildTelemetry();
    expect(telemetry.sampleCount).toBe(batches * batchSize);
    expect(telemetry.heartRate.beatCount).toBeGreaterThan(8);
    expect(telemetry.heartRate.bpm).not.toBeNull();
    expect(telemetry.heartRate.bpm ?? 0).toBeGreaterThan(60);
    expect(telemetry.heartRate.bpm ?? 0).toBeLessThan(90);
    expect(telemetry.quality.category === 'none').toBe(false);
  });

  it('records a session and returns aggregated statistics', async () => {
    const source = new FakeSource();
    engine = new EcgEngine();
    await engine.setSource(source);

    const synth = new EcgSynthesizer({
      bpm: 60,
      noise: 0,
      wander: 0,
      hum: 0,
      amplitude: 1400,
      irregularity: 0,
      leadOff: false,
      sampleRateHz: 500,
    });

    engine.startRecording();
    for (let seq = 0; seq < 300; seq += 1) {
      source.emit({
        deviceId: 'test-device',
        seq,
        sampleRateHz: 500,
        deviceTimeMs: seq * 50,
        samples: synth.generate(25),
        leadOffPos: false,
        leadOffNeg: false,
        receivedAtMs: performance.now(),
        sourceKind: 'hardware',
      });
    }

    const result = engine.stopRecording();
    expect(result).not.toBeNull();
    expect(result?.sampleCount).toBe(300 * 25);
    expect(result?.chunks.length).toBeGreaterThan(0);
    expect(result?.sampleRateHz).toBe(500);
    const storedSamples = result?.chunks.reduce((acc, chunk) => acc + chunk.samples.length, 0);
    expect(storedSamples).toBe(300 * 25);
    expect(result?.avgBpm).not.toBeNull();
  });

  it('resets buffers when the sample rate changes', async () => {
    const source = new FakeSource();
    engine = new EcgEngine();
    await engine.setSource(source);

    source.emit({
      deviceId: 'test-device',
      seq: 0,
      sampleRateHz: 500,
      deviceTimeMs: 0,
      samples: new Int16Array(50).fill(2048),
      leadOffPos: false,
      leadOffNeg: false,
      receivedAtMs: performance.now(),
      sourceKind: 'hardware',
    });
    expect(engine.getSampleRate()).toBe(500);

    source.emit({
      deviceId: 'test-device',
      seq: 1,
      sampleRateHz: 250,
      deviceTimeMs: 0,
      samples: new Int16Array(25).fill(2048),
      leadOffPos: false,
      leadOffNeg: false,
      receivedAtMs: performance.now(),
      sourceKind: 'hardware',
    });
    expect(engine.getSampleRate()).toBe(250);
    expect(engine.getSampleCount()).toBe(25);
  });
});
