import type { EcgBatch, SourceStatus } from '../types/ecg';
import type { BatchListener, DataSource, SimulationConfig, SimulationPreset, StatusListener } from '../types/source';
import { DEFAULT_SIM_CONFIG, EcgSynthesizer } from './ecgSynthesizer';

export const SIMULATION_PRESETS: SimulationPreset[] = [
  {
    id: 'stable',
    name: 'Stable rhythm',
    description: '72 bpm, low noise, minimal wander — the cleanest reference trace.',
    config: { bpm: 72, noise: 0.06, wander: 0.05, hum: 0, irregularity: 0.04, leadOff: false, amplitude: 1400 },
  },
  {
    id: 'variable',
    name: 'Variable heart rate',
    description: 'Respiratory sinus arrhythmia with a wider RR spread for HRV exercises.',
    config: { bpm: 78, noise: 0.08, wander: 0.1, hum: 0, irregularity: 0.75, leadOff: false, amplitude: 1300 },
  },
  {
    id: 'noisy',
    name: 'Noisy signal',
    description: 'Elevated EMG-style noise plus 50 Hz mains interference.',
    config: { bpm: 76, noise: 0.6, wander: 0.2, hum: 0.8, irregularity: 0.2, leadOff: false, amplitude: 1300 },
  },
  {
    id: 'lead-off',
    name: 'Electrode disconnection',
    description: 'Railed baseline with no cardiac signal — exercises lead-off detection.',
    config: { bpm: 74, noise: 0.1, wander: 0, hum: 0, irregularity: 0.1, leadOff: true, amplitude: 1200 },
  },
  {
    id: 'wander',
    name: 'Baseline wander',
    description: 'Strong respiration drift to demonstrate the 0.5 Hz high-pass filter.',
    config: { bpm: 70, noise: 0.1, wander: 1.0, hum: 0, irregularity: 0.15, leadOff: false, amplitude: 1400 },
  },
];

const BATCH_INTERVAL_MS = 40;
/** Maximum samples per emitted batch (0.5 s at 500 Hz) — keeps frames small. */
const BATCH_SAMPLES = 250;

/**
 * Generates synthetic ECG in real time and emits it through the same batch
 * contract the hardware path uses.
 */
export class SimulationDataSource implements DataSource {
  readonly kind = 'simulation' as const;

  private synth: EcgSynthesizer;
  private batchListeners = new Set<BatchListener>();
  private statusListeners = new Set<StatusListener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private totalSamples = 0;
  private lastTickAtMs = 0;
  private status: SourceStatus;

  constructor(config: SimulationConfig = DEFAULT_SIM_CONFIG) {
    this.synth = new EcgSynthesizer(config);
    this.status = {
      kind: 'simulation',
      state: 'disconnected',
      deviceId: 'simulator',
      label: 'Simulation',
      sampleRateHz: config.sampleRateHz,
      lastPacketAtMs: null,
      stats: { batches: 0, samples: 0, gaps: 0, outOfOrder: 0, lastBatchAtMs: null, lastSequence: null },
      error: null,
      reconnectAttempts: 0,
    };
  }

  getConfig(): SimulationConfig {
    return this.synth.getConfig();
  }

  configure(patch: Partial<SimulationConfig>): void {
    this.synth.setConfig(patch);
    this.status = { ...this.status, sampleRateHz: this.synth.sampleRateHz };
    this.emitStatus();
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.seq = 0;
    this.totalSamples = 0;
    this.synth.reset();
    this.lastTickAtMs = performance.now();
    this.patchStatus({ state: 'streaming', error: null, reconnectAttempts: 0 });
    this.timer = setInterval(() => this.tick(), BATCH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.patchStatus({ state: 'disconnected' });
  }

  subscribeBatches(listener: BatchListener): () => void {
    this.batchListeners.add(listener);
    return () => this.batchListeners.delete(listener);
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): SourceStatus {
    return this.status;
  }

  private tick(): void {
    const cfg = this.synth.getConfig();
    const now = performance.now();

    // Browsers throttle timers in background tabs. Generating a fixed number of
    // samples per tick would then drift far behind wall time (a hidden tab ticks
    // about once a second instead of 25 times), so the generator catches up to
    // elapsed time instead. The cap bounds a single catch-up burst.
    const elapsedMs = Math.min(2000, now - this.lastTickAtMs);
    if (elapsedMs < BATCH_INTERVAL_MS * 0.8) return;
    this.lastTickAtMs = now;

    const needed = Math.max(1, Math.round((cfg.sampleRateHz * elapsedMs) / 1000));
    let remaining = needed;
    while (remaining > 0) {
      const size = Math.min(BATCH_SAMPLES, remaining);
      remaining -= size;
      this.emit(this.synth.generate(size), now);
    }
  }

  private emit(samples: Int16Array, now: number): void {
    const cfg = this.synth.getConfig();
    const deviceTimeMs = (this.totalSamples / cfg.sampleRateHz) * 1000;

    this.totalSamples += samples.length;
    this.seq += 1;

    const batch: EcgBatch = {
      deviceId: 'simulator',
      seq: this.seq,
      sampleRateHz: cfg.sampleRateHz,
      deviceTimeMs,
      samples,
      leadOffPos: cfg.leadOff,
      leadOffNeg: cfg.leadOff,
      receivedAtMs: now,
      sourceKind: 'simulation',
    };

    this.patchStatus({
      state: 'streaming',
      lastPacketAtMs: now,
      stats: {
        ...this.status.stats,
        batches: this.status.stats.batches + 1,
        samples: this.status.stats.samples + samples.length,
        lastBatchAtMs: now,
        lastSequence: this.seq,
      },
    });

    for (const listener of this.batchListeners) listener(batch);
  }

  private patchStatus(patch: Partial<SourceStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emitStatus();
  }

  private emitStatus(): void {
    for (const listener of this.statusListeners) listener(this.status);
  }
}
