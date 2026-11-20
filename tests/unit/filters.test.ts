import { describe, expect, it } from 'vitest';
import { designHighpass, designLowpass, designNotch } from '../../src/signal/biquad';
import { FilterChain, DEFAULT_FILTERS } from '../../src/signal/filterChain';

/** RMS of a pure sine after filtering, for a given frequency. */
function filteredRms(frequencyHz: number, fs = 500, seconds = 4, cutoff: 'hp' | 'lp' | 'notch' = 'lp'): number {
  const filter =
    cutoff === 'hp' ? designHighpass(fs, 0.5) : cutoff === 'lp' ? designLowpass(fs, 40) : designNotch(fs, 50);
  if (cutoff === 'notch') {
    // Notch needs a warm-up to settle its narrow response.
  }
  let sum = 0;
  let count = 0;
  const n = Math.round(fs * seconds);
  for (let i = 0; i < n; i += 1) {
    const t = i / fs;
    const input = Math.sin(2 * Math.PI * frequencyHz * t);
    const y = filter.process(input);
    if (i > n * 0.25) {
      sum += y * y;
      count += 1;
    }
  }
  return Math.sqrt(sum / Math.max(1, count));
}

describe('biquad stages', () => {
  it('passes ECG band content through the 40 Hz low-pass', () => {
    const rms = filteredRms(10, 500, 4, 'lp');
    expect(rms).toBeGreaterThan(0.55);
  });

  it('attenuates 50 Hz mains with the notch', () => {
    const rms = filteredRms(50, 500, 4, 'notch');
    expect(rms).toBeLessThan(0.25);
  });

  it('removes DC offset with the 0.5 Hz high-pass', () => {
    const filter = designHighpass(500, 0.5);
    let last = 0;
    for (let i = 0; i < 5000; i += 1) last = filter.process(1);
    expect(Math.abs(last)).toBeLessThan(0.01);
  });
});

describe('FilterChain', () => {
  it('removes a constant offset while keeping a 5 Hz signal', () => {
    const chain = new FilterChain(500, DEFAULT_FILTERS);
    const outputs: number[] = [];
    for (let i = 0; i < 2500; i += 1) {
      const t = i / 500;
      outputs.push(chain.process(2048 + Math.sin(2 * Math.PI * 5 * t) * 300));
    }
    const tail = outputs.slice(1500);
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    const peak = Math.max(...tail.map((v) => Math.abs(v - mean)));
    expect(Math.abs(mean)).toBeLessThan(2);
    expect(peak).toBeGreaterThan(100);
  });

  it('reports which stages are active and honours disabled filters', () => {
    const chain = new FilterChain(500, { ...DEFAULT_FILTERS, enabled: false });
    expect(chain.active).toEqual({ highPass: false, lowPass: false, notch: false });
    expect(chain.process(2048)).toBe(2048);
  });

  it('re-derives coefficients when the sample rate changes', () => {
    const chain = new FilterChain(500, DEFAULT_FILTERS);
    chain.configure(250, { ...DEFAULT_FILTERS, lowPassHz: 30 });
    expect(chain.active.lowPass).toBe(true);
    const out = chain.process(2048);
    expect(Number.isFinite(out)).toBe(true);
  });
});
