import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_CONFIG, EcgSynthesizer, morphologyAt } from '../../src/data/ecgSynthesizer';

const clean = { ...DEFAULT_SIM_CONFIG, noise: 0, wander: 0, hum: 0, irregularity: 0 };

describe('ECG morphology', () => {
  it('has a dominant R peak with Q before and S after', () => {
    // R dominates; neighbouring Q/S lobes subtract a fraction of a percent.
    expect(morphologyAt(0)).toBeGreaterThan(0.95);
    expect(morphologyAt(-0.028)).toBeLessThan(0);
    expect(morphologyAt(0.03)).toBeLessThan(0);
  });

  it('places the T wave after the QRS', () => {
    const tWave = morphologyAt(0.26);
    expect(tWave).toBeGreaterThan(0.05);
    expect(tWave).toBeLessThan(morphologyAt(0));
  });

  it('has a P wave before the QRS', () => {
    expect(morphologyAt(-0.16)).toBeGreaterThan(0.02);
  });
});

describe('EcgSynthesizer', () => {
  it('emits the requested number of samples in ADC range', () => {
    const synth = new EcgSynthesizer({ ...clean, sampleRateHz: 500 });
    const samples = synth.generate(500);
    expect(samples.length).toBe(500);
    for (const value of samples) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(4095);
    }
  });

  it('produces the requested heart rate', () => {
    const synth = new EcgSynthesizer({ ...clean, bpm: 80, sampleRateHz: 500 });
    synth.generate(500 * 20);
    const times = synth.beatTimes;
    expect(times.length).toBeGreaterThan(24);
    const intervals = times.slice(1).map((t, i) => t - (times[i] ?? 0));
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    expect(60000 / (mean * 1000)).toBeGreaterThan(76);
    expect(60000 / (mean * 1000)).toBeLessThan(84);
  });

  it('increases interval spread with irregularity', () => {
    const steady = new EcgSynthesizer({ ...clean, bpm: 70, irregularity: 0, sampleRateHz: 500 });
    steady.generate(500 * 30);
    const wide = new EcgSynthesizer({ ...clean, bpm: 70, irregularity: 0.9, sampleRateHz: 500 });
    wide.generate(500 * 30);

    const spread = (times: number[]) => {
      const intervals = times.slice(1).map((t, i) => t - (times[i] ?? 0));
      const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      return Math.sqrt(intervals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / intervals.length);
    };

    expect(spread(wide.beatTimes)).toBeGreaterThan(spread(steady.beatTimes));
  });

  it('rails the output when the electrodes are disconnected', () => {
    const synth = new EcgSynthesizer({ ...clean, leadOff: true, sampleRateHz: 500 });
    const samples = synth.generate(250);
    for (const value of samples) expect(value).toBeGreaterThan(4000);
  });

  it('supports different sample rates without changing the rate', () => {
    const synth = new EcgSynthesizer({ ...clean, bpm: 60, sampleRateHz: 250 });
    synth.generate(250 * 10);
    const samples = synth.generate(250);
    expect(samples.length).toBe(250);
    expect(synth.beatTimes.length).toBeGreaterThan(7);
  });
});
