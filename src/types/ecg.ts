/** A batch of raw ADC samples as delivered by any data source. */
export interface EcgBatch {
  /** Stable device identifier, e.g. `cardiopulse-esp32-01` or `simulator`. */
  deviceId: string;
  /** Monotonic batch counter, starting at 0 per connection. */
  seq: number;
  /** Sample rate actually reported by the source, never assumed. */
  sampleRateHz: number;
  /** Device clock (ms) at the first sample of this batch. */
  deviceTimeMs: number;
  /** Raw ADC counts (12-bit, 0..4095 for hardware). */
  samples: Int16Array;
  leadOffPos: boolean;
  leadOffNeg: boolean;
  /** Local receive time; kept separate from device time. */
  receivedAtMs: number;
  sourceKind: DataSourceKind;
}

export type DataSourceKind = 'simulation' | 'hardware';

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'waiting'
  | 'streaming'
  | 'error';

export interface PacketStats {
  batches: number;
  samples: number;
  gaps: number;
  outOfOrder: number;
  lastBatchAtMs: number | null;
  lastSequence: number | null;
}

export interface SourceStatus {
  kind: DataSourceKind;
  state: ConnectionState;
  deviceId: string | null;
  label: string;
  sampleRateHz: number;
  lastPacketAtMs: number | null;
  stats: PacketStats;
  error: string | null;
  /** Number of consecutive reconnect attempts (hardware only). */
  reconnectAttempts: number;
}

export type QualityCategory = 'good' | 'fair' | 'poor' | 'none';

export interface QualityReport {
  /** 0..100 technical signal score. Not a clinical confidence value. */
  score: number;
  category: QualityCategory;
  reasons: string[];
  leadOffPos: boolean;
  leadOffNeg: boolean;
}

/** A detected beat, in samples since the current buffer epoch. */
export interface BeatEvent {
  index: number;
  timeMs: number;
  rrMs: number | null;
  valid: boolean;
  amplitude: number;
}

export interface HrvMetrics {
  sdnnMs: number | null;
  rmssdMs: number | null;
  pnn50: number | null;
  nnCount: number;
  /** Intervals needed before SDNN/RMSSD are computed. */
  required: number;
}

export interface HeartRateStats {
  bpm: number | null;
  meanBpm: number | null;
  minBpm: number | null;
  maxBpm: number | null;
  lastRrMs: number | null;
  beatCount: number;
}

/** Everything the UI needs at 4 Hz. Intentionally small and serialisable. */
export interface TelemetrySnapshot {
  sourceKind: DataSourceKind;
  deviceId: string | null;
  connection: SourceStatus;
  heartRate: HeartRateStats;
  hrv: HrvMetrics;
  quality: QualityReport;
  /** Session clock in ms (time since the engine started receiving). */
  elapsedMs: number;
  /** Age of the newest sample in ms, used for staleness UI. */
  sampleAgeMs: number;
  sampleCount: number;
  sampleRateHz: number;
  /** Latest visible signal extremes in ADC counts. */
  range: { min: number; max: number };
  /** Number of beads currently marked as unreviewed artefacts. */
  artifacts: number;
}

export type LeadState = 'ok' | 'lead-off' | 'unknown';
