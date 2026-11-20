import type { QualityCategory, QualityReport } from '../types/ecg';

export interface QualityInput {
  /** Recent raw samples (newest last). */
  samples: Float32Array;
  /** How many entries of `samples` are valid. */
  count: number;
  sampleRateHz: number;
  leadOffPos: boolean;
  leadOffNeg: boolean;
  /** Recent valid NN intervals in ms. */
  recentRr: readonly number[];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function qualityCategory(score: number): QualityCategory {
  if (score <= 0) return 'none';
  if (score >= 75) return 'good';
  if (score >= 50) return 'fair';
  return 'poor';
}

/**
 * Technical signal-quality score (0..100) — deliberately NOT a clinical
 * confidence value. Documented in docs/ECG_SIGNAL_PROCESSING.md §6.
 */
export function computeQuality(input: QualityInput): QualityReport {
  const { samples, count, sampleRateHz, leadOffPos, leadOffNeg, recentRr } = input;

  if (leadOffPos || leadOffNeg) {
    return {
      score: 0,
      category: 'none',
      reasons: ['Electrode lead-off detected'],
      leadOffPos,
      leadOffNeg,
    };
  }

  const minSamples = Math.max(20, Math.round(sampleRateHz * 0.5));
  if (count < minSamples) {
    return {
      score: 0,
      category: 'none',
      reasons: ['Waiting for enough signal to score'],
      leadOffPos,
      leadOffNeg,
    };
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let rail = 0;
  for (let i = 0; i < count; i += 1) {
    const v = samples[i] ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    if (v > 4080 || v < 16) rail += 1;
  }
  const meanValue = sum / count;
  const peakToPeak = max - min;

  // ~6 ADC counts of swing is below the noise floor of the front-end.
  if (peakToPeak < 6) {
    return {
      score: 0,
      category: 'none',
      reasons: ['Flatline — no detectable cardiac signal'],
      leadOffPos,
      leadOffNeg,
    };
  }

  // Saturation: fraction of samples pinned at the ADC rails.
  const satRatio = clamp01(rail / count);

  // Noise: residual after a 20 ms moving average, relative to overall RMS.
  const avgWindow = Math.max(2, Math.round(sampleRateHz * 0.02));
  let residualEnergy = 0;
  let signalEnergy = 0;
  let running = 0;
  const ring = new Float32Array(avgWindow);
  for (let i = 0; i < count; i += 1) {
    const v = (samples[i] ?? 0) - meanValue;
    running += v;
    const slot = i % avgWindow;
    if (i >= avgWindow) running -= ring[slot] ?? 0;
    ring[slot] = v;
    const localMean = running / Math.min(i + 1, avgWindow);
    residualEnergy += (v - localMean) * (v - localMean);
    signalEnergy += v * v;
  }
  const rms = Math.sqrt(signalEnergy / count);
  const noiseRatio = rms > 0 ? clamp01(Math.sqrt(residualEnergy / count) / rms) : 0;

  // Baseline instability: share of samples far from the local mean.
  let outside = 0;
  const limit = rms * 3;
  for (let i = 0; i < count; i += 1) {
    if (Math.abs((samples[i] ?? 0) - meanValue) > limit) outside += 1;
  }
  const baselineRatio = clamp01(outside / count);

  // Beat consistency: coefficient of variation of recent valid NN intervals.
  let rrCv = 0;
  if (recentRr.length >= 3) {
    const m = recentRr.reduce((a, b) => a + b, 0) / recentRr.length;
    if (m > 0) {
      const variance = recentRr.reduce((acc, v) => acc + (v - m) * (v - m), 0) / recentRr.length;
      rrCv = clamp01(Math.sqrt(variance) / m);
    }
  }

  const score = Math.round(
    100 * (1 - 0.2 * satRatio - 0.35 * noiseRatio - 0.15 * baselineRatio - 0.3 * rrCv),
  );
  const clamped = Math.max(0, Math.min(100, score));

  const reasons: string[] = [];
  if (satRatio > 0.02) reasons.push('ADC saturation');
  if (noiseRatio > 0.45) reasons.push('High-frequency noise');
  if (baselineRatio > 0.2) reasons.push('Unstable baseline');
  if (rrCv > 0.25) reasons.push('Irregular beat detection');
  if (reasons.length === 0) reasons.push('Signal within expected technical limits');

  return {
    score: clamped,
    category: qualityCategory(clamped),
    reasons,
    leadOffPos,
    leadOffNeg,
  };
}
