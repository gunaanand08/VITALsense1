import { describe, expect, it } from 'vitest';
import {
  SessionAccumulator,
  computeHeartRate,
  computeHrv,
  isPlausibleInterval,
  medianOf,
  rateFromIntervals,
} from '../../src/signal/metrics';

describe('median and rate helpers', () => {
  it('computes an even-length median', () => {
    expect(medianOf([1000, 900, 1100, 950])).toBe(975);
  });

  it('derives BPM from the median of the last five intervals', () => {
    expect(rateFromIntervals([1000, 1000, 1000, 9000, 1000])).toBeCloseTo(60, 5);
  });

  it('returns null without intervals', () => {
    expect(rateFromIntervals([])).toBeNull();
  });
});

describe('HRV', () => {
  const constant = Array.from({ length: 20 }, () => 1000);

  it('reports zero variability for constant intervals', () => {
    const hrv = computeHrv(constant);
    expect(hrv.sdnnMs).toBeCloseTo(0, 6);
    expect(hrv.rmssdMs).toBeCloseTo(0, 6);
    expect(hrv.pnn50).toBe(0);
  });

  it('withholds metrics below the minimum interval count', () => {
    const hrv = computeHrv([900, 950, 1000]);
    expect(hrv.sdnnMs).toBeNull();
    expect(hrv.rmssdMs).toBeNull();
    expect(hrv.nnCount).toBe(3);
    expect(hrv.required).toBe(10);
  });

  it('matches hand-computed SDNN and RMSSD', () => {
    const nn = [1000, 1040, 980, 1020, 1000, 1060, 940, 1000, 1020, 980];
    const mean = nn.reduce((a, b) => a + b, 0) / nn.length;
    const variance = nn.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (nn.length - 1);
    const diffs = nn.slice(1).map((v, i) => v - (nn[i] ?? 0));
    const rmssd = Math.sqrt(diffs.reduce((acc, d) => acc + d * d, 0) / diffs.length);

    const hrv = computeHrv(nn);
    expect(hrv.sdnnMs).toBeCloseTo(Math.sqrt(variance), 5);
    expect(hrv.rmssdMs).toBeCloseTo(rmssd, 5);
  });
});

describe('heart rate summary', () => {
  it('derives average, min and max from valid intervals', () => {
    const stats = computeHeartRate([1000, 1000, 500, 2000], 4);
    expect(stats.bpm).toBeCloseTo(60, 5);
    expect(stats.meanBpm).toBeGreaterThan(40);
    expect(stats.maxBpm).toBeCloseTo(120, 5);
    expect(stats.minBpm).toBeCloseTo(30, 5);
    expect(stats.beatCount).toBe(4);
  });
});

describe('interval plausibility (artefact rejection)', () => {
  it('accepts physiological intervals', () => {
    expect(isPlausibleInterval(800, [810, 805, 800, 795])).toBe(true);
    expect(isPlausibleInterval(300, [])).toBe(true);
    expect(isPlausibleInterval(2000, [])).toBe(true);
    expect(isPlausibleInterval(null, [])).toBe(true);
  });

  it('rejects intervals outside the 300–2000 ms band', () => {
    expect(isPlausibleInterval(250, [800, 800, 800])).toBe(false);
    expect(isPlausibleInterval(2400, [800, 800, 800])).toBe(false);
  });

  it('rejects intervals far from the running median', () => {
    const recent = [850, 845, 855, 840, 850];
    expect(isPlausibleInterval(420, recent)).toBe(false);
    expect(isPlausibleInterval(1500, recent)).toBe(false);
    expect(isPlausibleInterval(880, recent)).toBe(true);
  });
});

describe('SessionAccumulator', () => {
  it('ignores implausible intervals and reports extremes', () => {
    const acc = new SessionAccumulator();
    acc.addValidInterval(1000);
    acc.addValidInterval(800);
    acc.addValidInterval(1200);
    acc.addValidInterval(120); // too short -> rejected
    acc.addQuality(80);
    acc.addQuality(60);
    const summary = acc.summary();
    expect(summary.validIntervals).toBe(3);
    expect(summary.invalidBeats).toBe(1);
    expect(summary.meanRrMs).toBeCloseTo(1000, 5);
    expect(summary.minBpm).toBeCloseTo(50, 5);
    expect(summary.maxBpm).toBeCloseTo(75, 5);
    expect(summary.meanQuality).toBeCloseTo(70, 5);
  });
});
