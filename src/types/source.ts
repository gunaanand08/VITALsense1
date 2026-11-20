import type { EcgBatch, SourceStatus } from './ecg';

export type BatchListener = (batch: EcgBatch) => void;
export type StatusListener = (status: SourceStatus) => void;

/**
 * The only contract pages and the engine know about. Adding a new acquisition
 * path must not require changes outside a DataSource implementation.
 */
export interface DataSource {
  readonly kind: 'simulation' | 'hardware';

  start(): void | Promise<void>;
  stop(): void;

  subscribeBatches(listener: BatchListener): () => void;
  subscribeStatus(listener: StatusListener): () => void;

  getStatus(): SourceStatus;
}

/** Simulation-only controls. Kept separate so hardware sources stay simple. */
export interface SimulationConfig {
  bpm: number;
  /** 0..1 — additive white noise relative to signal swing. */
  noise: number;
  /** 0..1 — respiratory baseline wander. */
  wander: number;
  /** 0..1 — 50 Hz mains interference. */
  hum: number;
  /** Peak-to-peak amplitude in ADC counts. */
  amplitude: number;
  /** 0..1 — RR interval variability (respiratory sinus arrhythmia). */
  irregularity: number;
  leadOff: boolean;
  sampleRateHz: number;
}

export interface SimulationPreset {
  id: string;
  name: string;
  description: string;
  config: Partial<SimulationConfig>;
}
