import type { SimulationConfig } from '../types/source';

export const DEFAULT_SIM_CONFIG: SimulationConfig = {
  bpm: 72,
  noise: 0.12,
  wander: 0.15,
  hum: 0.0,
  amplitude: 1400,
  irregularity: 0.12,
  leadOff: false,
  sampleRateHz: 500,
};

const ADC_MID = 2048;

/** Gaussian bump, the building block of the synthetic P-QRS-T complex. */
function bump(dt: number, center: number, sigma: number, amplitude: number): number {
  const d = (dt - center) / sigma;
  return amplitude * Math.exp(-0.5 * d * d);
}

/**
 * Normalised ECG morphology (R peak = 1.0), evaluated `dt` seconds after the
 * R peak of one beat. Values are approximate but preserve physiological
 * ordering and polarity: P, Q, R, S, T.
 */
export function morphologyAt(dt: number): number {
  return (
    bump(dt, -0.16, 0.025, 0.12) + // P wave
    bump(dt, -0.028, 0.008, -0.14) + // Q wave
    bump(dt, 0.0, 0.0105, 1.0) + // R peak
    bump(dt, 0.030, 0.011, -0.3) + // S wave
    bump(dt, 0.26, 0.055, 0.32) // T wave
  );
}

/**
 * Genuine sample generator: a beat schedule plus continuous mathematics, not a
 * collection of animated numbers. Deterministic per instance so tests can
 * assert on known signals when noise is disabled.
 */
export class EcgSynthesizer {
  private config: SimulationConfig;
  private sampleIndex = 0;
  private rPeaks: number[] = [];
  /** Full beat timeline for tests/diagnostics; not pruned like `rPeaks`. */
  private beatTimeline: number[] = [];
  private nextRTimeS = 0.55;
  private seed = 1;
  private t = 0;

  constructor(config: SimulationConfig = DEFAULT_SIM_CONFIG) {
    this.config = { ...config };
  }

  get sampleRateHz(): number {
    return this.config.sampleRateHz;
  }

  setConfig(patch: Partial<SimulationConfig>): void {
    const rateChanged = patch.sampleRateHz !== undefined && patch.sampleRateHz !== this.config.sampleRateHz;
    this.config = { ...this.config, ...patch };
    if (rateChanged) {
      const elapsed = this.t;
      this.sampleIndex = 0;
      this.t = elapsed;
      this.scheduleNextBeat(elapsed + 60 / Math.max(20, this.config.bpm));
    }
  }

  getConfig(): SimulationConfig {
    return { ...this.config };
  }

  reset(): void {
    this.sampleIndex = 0;
    this.t = 0;
    this.rPeaks = [];
    this.beatTimeline = [];
    this.nextRTimeS = 0.55;
    this.seed = 1;
  }

  /** Random in [-1, 1) — small local PRNG keeps tests reproducible. */
  private random(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return (this.seed / 4294967296) * 2 - 1;
  }

  private scheduleNextBeat(fromTimeS: number): void {
    const base = 60 / Math.max(20, this.config.bpm);
    const rsa = Math.sin(2 * Math.PI * 0.22 * fromTimeS) * 0.14 * this.config.irregularity;
    const jitter = this.random() * 0.06 * this.config.irregularity;
    const rr = Math.max(0.25, base * (1 + rsa + jitter));
    this.nextRTimeS = fromTimeS + rr;
  }

  /** Generate `count` raw ADC samples at the configured rate. */
  generate(count: number): Int16Array {
    const out = new Int16Array(count);
    const fs = this.config.sampleRateHz;
    const amplitude = this.config.amplitude;

    for (let i = 0; i < count; i += 1) {
      const t = this.t;
      // Advance the beat schedule.
      while (t >= this.nextRTimeS) {
        this.rPeaks.push(this.nextRTimeS);
        this.beatTimeline.push(this.nextRTimeS);
        if (this.beatTimeline.length > 2000) this.beatTimeline.shift();
        this.scheduleNextBeat(this.nextRTimeS);
      }
      // Drop beats that can no longer contribute (T wave ends ~0.45 s after R).
      while (this.rPeaks.length > 0 && t - (this.rPeaks[0] ?? 0) > 1.2) this.rPeaks.shift();

      let ecg = 0;
      for (const r of this.rPeaks) {
        const dt = t - r;
        if (dt > -0.35 && dt < 0.6) ecg += morphologyAt(dt);
      }
      // Upcoming beat's P wave can precede this sample.
      const untilNext = t - this.nextRTimeS;
      if (untilNext > -0.35) ecg += morphologyAt(untilNext);

      let value = ecg * (amplitude / 2);

      // Baseline wander: respiration (~0.22 Hz) plus a slow drift.
      if (this.config.wander > 0) {
        value +=
          Math.sin(2 * Math.PI * 0.22 * t) * amplitude * 0.35 * this.config.wander +
          Math.sin(2 * Math.PI * 0.05 * t + 1.1) * amplitude * 0.18 * this.config.wander;
      }

      // 50 Hz mains interference.
      if (this.config.hum > 0) {
        value += Math.sin(2 * Math.PI * 50 * t) * amplitude * 0.18 * this.config.hum;
      }

      // White noise.
      if (this.config.noise > 0) {
        value += this.random() * amplitude * 0.13 * this.config.noise;
      }

      // Lead-off: railed, noisy baseline — the front-end has no patient signal.
      if (this.config.leadOff) {
        value = 4070 + this.random() * 18;
      }

      const adc = Math.max(0, Math.min(4095, Math.round(ADC_MID + value)));
      out[i] = adc;
      this.t += 1 / fs;
      this.sampleIndex += 1;
    }

    return out;
  }

  /** Beat times (seconds) generated so far — used by tests to assert detection. */
  get beatTimes(): number[] {
    return this.beatTimeline.slice();
  }

  get elapsedSeconds(): number {
    return this.t;
  }

  get samplesGenerated(): number {
    return this.sampleIndex;
  }
}
