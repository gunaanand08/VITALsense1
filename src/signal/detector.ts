import type { BeatEvent } from '../types/ecg';
import { isPlausibleInterval } from './metrics';

export interface DetectorOptions {
  sampleRateHz: number;
  /** Integration window for the QRS energy envelope (default 150 ms). */
  integrationWindowMs?: number;
  /** Minimum spacing between accepted beats (~300 bpm ceiling). */
  refractoryMs?: number;
  /** Allowed deviation from the running median NN before a beat is an artifact. */
  rrTolerance?: number;
}

/**
 * Streaming, simplified Pan–Tompkins R-peak detector.
 *
 * derivative -> squaring -> 150 ms moving integration -> adaptive threshold
 * with refractory period -> peak refinement on the filtered signal.
 *
 * Educational code: no search-back stage and no validation against annotated
 * databases. It degrades gracefully rather than inventing beats.
 */
export class RPeakDetector {
  private fs: number;
  private windowSize: number;
  private refractorySamples: number;
  private rrTolerance: number;
  private warmupSamples: number;

  private prevFiltered = 0;
  private prevPrevFiltered = 0;

  private envHistory: Float32Array;
  private envIndex = 0;
  private envSum = 0;

  private filteredHistory: Float32Array;
  private filteredWrite = 0;

  private sampleCount = 0;

  private spki = 0;
  private npki = 0;
  private threshold = 0;
  private wasAbove = false;

  private warmup: number[] = [];
  private warmupSettleSamples: number;
  private warmedUp = false;

  private lastPeakAbs = Number.NEGATIVE_INFINITY;
  private rrHistory: number[] = [];
  private artifacts = 0;

  constructor(options: DetectorOptions) {
    this.fs = options.sampleRateHz;
    this.windowSize = Math.max(3, Math.round(((options.integrationWindowMs ?? 150) / 1000) * this.fs));
    this.refractorySamples = Math.round(((options.refractoryMs ?? 200) / 1000) * this.fs);
    this.rrTolerance = options.rrTolerance ?? 0.5;
    this.warmupSamples = Math.max(100, Math.round(this.fs * 2));
    // The high-pass settling transient would otherwise dominate the initial
    // signal estimate and push the threshold above every real beat.
    this.warmupSettleSamples = Math.round(this.fs * 0.5);
    this.envHistory = new Float32Array(this.windowSize);
    this.filteredHistory = new Float32Array(Math.max(64, Math.round(this.fs * 0.5)));
  }

  reset(sampleRateHz = this.fs): void {
    this.fs = sampleRateHz;
    this.windowSize = Math.max(3, Math.round(0.15 * this.fs));
    this.refractorySamples = Math.round(0.2 * this.fs);
    this.warmupSamples = Math.max(100, Math.round(this.fs * 2));
    this.warmupSettleSamples = Math.round(this.fs * 0.5);
    this.envHistory = new Float32Array(this.windowSize);
    this.filteredHistory = new Float32Array(Math.max(64, Math.round(this.fs * 0.5)));
    this.envIndex = 0;
    this.envSum = 0;
    this.filteredWrite = 0;
    this.sampleCount = 0;
    this.prevFiltered = 0;
    this.prevPrevFiltered = 0;
    this.spki = 0;
    this.npki = 0;
    this.threshold = 0;
    this.wasAbove = false;
    this.warmup = [];
    this.warmedUp = false;
    this.lastPeakAbs = Number.NEGATIVE_INFINITY;
    this.rrHistory = [];
    this.artifacts = 0;
  }

  get artifactCount(): number {
    return this.artifacts;
  }

  get validRrMs(): number[] {
    return this.rrHistory.slice();
  }

  get lastRrMs(): number | null {
    return this.rrHistory.length ? (this.rrHistory[this.rrHistory.length - 1] ?? null) : null;
  }

  get isWarmedUp(): boolean {
    return this.warmedUp;
  }

  /** Feed one filtered sample; returns a beat when an R-peak is confirmed. */
  push(filtered: number): BeatEvent | null {
    const x = Number.isFinite(filtered) ? filtered : 0;
    const i = this.sampleCount;
    this.sampleCount += 1;

    // 1. derivative (x[n] - x[n-2]) and 2. squaring
    const derivative = x - this.prevPrevFiltered;
    const squared = derivative * derivative;

    // 3. moving-window integration of the squared derivative
    this.envSum += squared - this.envHistory[this.envIndex];
    this.envHistory[this.envIndex] = squared;
    this.envIndex = (this.envIndex + 1) % this.windowSize;
    const env = this.envSum / this.windowSize;

    // Keep a short filtered-history window for peak refinement.
    this.filteredHistory[this.filteredWrite] = x;
    this.filteredWrite = (this.filteredWrite + 1) % this.filteredHistory.length;

    this.prevPrevFiltered = this.prevFiltered;
    this.prevFiltered = x;

    // 4a. Warm-up: skip the filter settling transient, then seed the
    // signal/noise estimates from a robust (p90/p50) envelope percentile.
    if (!this.warmedUp) {
      if (i < this.warmupSettleSamples) return null;
      this.warmup.push(env);
      if (this.warmup.length >= this.warmupSamples) {
        const sorted = this.warmup.slice().sort((a, b) => a - b);
        const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? 0;
        const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
        this.spki = Math.max(p90, 1e-6);
        this.npki = Math.max(p50, this.spki * 0.02);
        this.threshold = this.npki + 0.25 * (this.spki - this.npki);
        this.warmup = [];
        this.warmedUp = true;
      }
      return null;
    }

    let beat: BeatEvent | null = null;

    if (env > this.threshold) {
      if (!this.wasAbove) {
        // 4b. Rising-edge threshold crossing.
        this.spki = 0.125 * env + 0.875 * this.spki;

        // 6. Peak refinement inside the filtered history.
        const candidate = this.refinePeak(i);
        if (candidate !== null && candidate - this.lastPeakAbs >= this.refractorySamples) {
          const rrMs =
            this.lastPeakAbs === Number.NEGATIVE_INFINITY
              ? null
              : ((candidate - this.lastPeakAbs) / this.fs) * 1000;
          this.lastPeakAbs = candidate;

          const valid = isPlausibleInterval(rrMs, this.rrHistory, this.rrTolerance);
          if (rrMs !== null) {
            if (valid) {
              this.rrHistory.push(rrMs);
              if (this.rrHistory.length > 120) this.rrHistory.shift();
            } else {
              this.artifacts += 1;
            }
          }

          const slot = ((candidate % this.filteredHistory.length) + this.filteredHistory.length) % this.filteredHistory.length;
          beat = {
            index: candidate,
            timeMs: (candidate / this.fs) * 1000,
            rrMs,
            valid,
            amplitude: this.filteredHistory[slot] ?? 0,
          };
        }
        this.threshold = this.npki + 0.25 * (this.spki - this.npki);
      }
      this.wasAbove = true;
    } else {
      this.wasAbove = false;
      // 4c. Sub-threshold content updates the noise estimate.
      this.npki = 0.125 * env + 0.875 * this.npki;
      this.threshold = this.npki + 0.25 * (this.spki - this.npki);
    }

    return beat;
  }

  /** Largest |filtered| value in the last ~120 ms before the crossing. */
  private refinePeak(absIndex: number): number | null {
    const len = this.filteredHistory.length;
    const searchBack = Math.min(Math.round(0.12 * this.fs), len - 1, absIndex);
    if (searchBack <= 0) return null;

    let bestAbs = absIndex;
    let bestMagnitude = -1;
    for (let back = 0; back <= searchBack; back += 1) {
      const abs = absIndex - back;
      const slot = ((abs % len) + len) % len;
      const magnitude = Math.abs(this.filteredHistory[slot] ?? 0);
      if (magnitude > bestMagnitude) {
        bestMagnitude = magnitude;
        bestAbs = abs;
      }
    }
    return bestAbs;
  }

}
