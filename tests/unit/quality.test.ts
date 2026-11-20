import { describe, expect, it } from 'vitest';
import { computeQuality } from '../../src/signal/quality';

const FS = 500;

function window(values: number[]): Float32Array {
  const buffer = new Float32Array(values.length);
  buffer.set(values);
  return buffer;
}

function ecgLike(seconds = 2): number[] {
  const out: number[] = [];
  for (let i = 0; i < seconds * FS; i += 1) {
    const t = i / FS;
    const phase = (t * 1.2) % 1;
    out.push(2048 + Math.exp(-((phase - 0.2) ** 2) / 0.001) * 1200 + Math.sin(2 * Math.PI * 0.3 * t) * 40);
  }
  return out;
}

describe('signal quality scoring', () => {
  it('returns "no signal" when either electrode is off', () => {
    const samples = window(ecgLike());
    const report = computeQuality({
      samples,
      count: samples.length,
      sampleRateHz: FS,
      leadOffPos: true,
      leadOffNeg: false,
      recentRr: [900, 910, 905, 900],
    });
    expect(report.score).toBe(0);
    expect(report.category).toBe('none');
  });

  it('detects a flatline', () => {
    const samples = window(new Array(FS).fill(2048));
    const report = computeQuality({
      samples,
      count: samples.length,
      sampleRateHz: FS,
      leadOffPos: false,
      leadOffNeg: false,
      recentRr: [],
    });
    expect(report.category).toBe('none');
    expect(report.reasons[0]).toMatch(/flatline/i);
  });

  it('reports a good score for a clean periodic signal', () => {
    const samples = window(ecgLike());
    const report = computeQuality({
      samples,
      count: samples.length,
      sampleRateHz: FS,
      leadOffPos: false,
      leadOffNeg: false,
      recentRr: [820, 825, 818, 830, 822, 826],
    });
    expect(report.score).toBeGreaterThan(55);
    expect(['good', 'fair']).toContain(report.category);
  });

  it('penalises a noisy trace relative to a clean one', () => {
    const clean = window(ecgLike());
    const noisy = window(ecgLike().map((v) => v + (Math.random() - 0.5) * 900));
    const base = {
      sampleRateHz: FS,
      leadOffPos: false,
      leadOffNeg: false,
      recentRr: [820, 825, 818, 830, 822, 826],
    };
    const cleanReport = computeQuality({ ...base, samples: clean, count: clean.length });
    const noisyReport = computeQuality({ ...base, samples: noisy, count: noisy.length });
    expect(noisyReport.score).toBeLessThan(cleanReport.score);
  });

  it('never claims a category without data', () => {
    const samples = window([2048, 2049, 2048]);
    const report = computeQuality({
      samples,
      count: 3,
      sampleRateHz: FS,
      leadOffPos: false,
      leadOffNeg: false,
      recentRr: [],
    });
    expect(report.category).toBe('none');
  });
});
