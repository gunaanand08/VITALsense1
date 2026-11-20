import type { HrvMetrics, HeartRateStats } from '../types/ecg';

export const HRV_MIN_INTERVALS = 10;

export function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Physiological plausibility of an RR interval.
 *
 * Rejects anything outside 300–2000 ms and anything deviating more than
 * `tolerance` (default 50 %) from the running median of recent valid intervals,
 * which is how ectopic beats and artefact detections are kept out of HRV.
 */
export function isPlausibleInterval(
  rrMs: number | null,
  recent: readonly number[],
  tolerance = 0.5,
): boolean {
  if (rrMs === null) return true;
  if (!Number.isFinite(rrMs) || rrMs < 300 || rrMs > 2000) return false;
  const sample = recent.slice(-8);
  if (sample.length < 3) return true;
  const reference = medianOf(sample);
  if (reference <= 0) return true;
  return Math.abs(rrMs - reference) / reference <= tolerance;
}

export function stdDev(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) * (v - m);
  return Math.sqrt(acc / (n - 1));
}

/**
 * Instantaneous rate from the median of the last five valid NN intervals.
 * Using the median (rather than the newest interval) suppresses single-beat
 * jitter without smoothing away real rate changes.
 */
export function rateFromIntervals(nn: readonly number[]): number | null {
  if (nn.length === 0) return null;
  const recent = nn.slice(-5);
  const m = medianOf(recent);
  if (!Number.isFinite(m) || m <= 0) return null;
  return 60000 / m;
}

export function computeHrv(nn: readonly number[]): HrvMetrics {
  const count = nn.length;
  if (count < HRV_MIN_INTERVALS) {
    return {
      sdnnMs: null,
      rmssdMs: null,
      pnn50: null,
      nnCount: count,
      required: HRV_MIN_INTERVALS,
    };
  }

  const diffs: number[] = [];
  for (let i = 1; i < nn.length; i += 1) {
    diffs.push((nn[i] ?? 0) - (nn[i - 1] ?? 0));
  }
  const meanDiffSquares = diffs.reduce((acc, d) => acc + d * d, 0) / Math.max(1, diffs.length);
  const over50 = diffs.filter((d) => Math.abs(d) > 50).length;

  return {
    sdnnMs: stdDev(nn),
    rmssdMs: Math.sqrt(meanDiffSquares),
    pnn50: diffs.length ? over50 / diffs.length : null,
    nnCount: count,
    required: HRV_MIN_INTERVALS,
  };
}

export function computeHeartRate(nn: readonly number[], beatCount: number): HeartRateStats {
  const bpm = rateFromIntervals(nn);
  const bpms = nn.map((rr) => 60000 / rr).filter((v) => Number.isFinite(v) && v > 0 && v < 400);
  return {
    bpm,
    meanBpm: bpms.length ? mean(bpms) : null,
    minBpm: bpms.length ? Math.min(...bpms) : null,
    maxBpm: bpms.length ? Math.max(...bpms) : null,
    lastRrMs: nn.length ? (nn[nn.length - 1] ?? null) : null,
    beatCount,
  };
}

/**
 * Incremental session statistics. Keeps memory constant for long recordings and
 * never folds artefact intervals into the summary.
 */
export class SessionAccumulator {
  private rrSum = 0;
  private rrCount = 0;
  private rrMin = Number.POSITIVE_INFINITY;
  private rrMax = Number.NEGATIVE_INFINITY;
  private qualitySum = 0;
  private qualityCount = 0;
  private qualityMin = Number.POSITIVE_INFINITY;
  private invalidBeats = 0;

  addValidInterval(rrMs: number): void {
    if (!Number.isFinite(rrMs) || rrMs < 300 || rrMs > 2000) {
      this.invalidBeats += 1;
      return;
    }
    this.rrSum += rrMs;
    this.rrCount += 1;
    if (rrMs < this.rrMin) this.rrMin = rrMs;
    if (rrMs > this.rrMax) this.rrMax = rrMs;
  }

  addQuality(score: number): void {
    if (!Number.isFinite(score)) return;
    this.qualitySum += score;
    this.qualityCount += 1;
    if (score < this.qualityMin) this.qualityMin = score;
  }

  get validCount(): number {
    return this.rrCount;
  }

  summary(): {
    validIntervals: number;
    meanRrMs: number | null;
    minBpm: number | null;
    maxBpm: number | null;
    meanQuality: number | null;
    minQuality: number | null;
    invalidBeats: number;
  } {
    return {
      validIntervals: this.rrCount,
      meanRrMs: this.rrCount ? this.rrSum / this.rrCount : null,
      minBpm: this.rrCount ? 60000 / this.rrMax : null,
      maxBpm: this.rrCount ? 60000 / this.rrMin : null,
      meanQuality: this.qualityCount ? this.qualitySum / this.qualityCount : null,
      minQuality: this.qualityCount ? this.qualityMin : null,
      invalidBeats: this.invalidBeats,
    };
  }
}
