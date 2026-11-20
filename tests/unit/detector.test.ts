import { describe, expect, it } from 'vitest';
import { EcgSynthesizer } from '../../src/data/ecgSynthesizer';
import { FilterChain, DEFAULT_FILTERS } from '../../src/signal/filterChain';
import { RPeakDetector } from '../../src/signal/detector';
import type { SimulationConfig } from '../../src/types/source';

const BASE: SimulationConfig = {
  bpm: 72,
  noise: 0,
  wander: 0,
  hum: 0,
  amplitude: 1400,
  irregularity: 0,
  leadOff: false,
  sampleRateHz: 500,
};

function runDetector(overrides: Partial<SimulationConfig>, seconds = 20) {
  const config = { ...BASE, ...overrides };
  const synth = new EcgSynthesizer(config);
  const chain = new FilterChain(config.sampleRateHz, DEFAULT_FILTERS);
  const detector = new RPeakDetector({ sampleRateHz: config.sampleRateHz });

  const total = seconds * config.sampleRateHz;
  let collected = 0;
  const beats: Array<{ rrMs: number | null; valid: boolean }> = [];

  while (collected < total) {
    const samples = synth.generate(250);
    collected += samples.length;
    for (let i = 0; i < samples.length; i += 1) {
      const filtered = chain.process(samples[i] ?? 0);
      const beat = detector.push(filtered);
      if (beat) beats.push({ rrMs: beat.rrMs, valid: beat.valid });
    }
  }

  return { beats, synth, detector };
}

describe('R-peak detection on synthetic ECG', () => {
  it.each([60, 90, 120])('detects beats at %i bpm', (bpm) => {
    const { beats, synth } = runDetector({ bpm }, 20);
    const expected = synth.beatTimes.length;
    // Warm-up consumes the first ~2 s, so the first beats are not reported.
    expect(beats.length).toBeGreaterThanOrEqual(expected - 4);
    expect(beats.length).toBeLessThanOrEqual(expected + 1);

    const validRr = beats.map((beat) => beat.rrMs).filter((rr): rr is number => rr !== null && rr > 0);
    expect(validRr.length).toBeGreaterThan(5);
    const meanRr = validRr.reduce((a, b) => a + b, 0) / validRr.length;
    const expectedRr = 60000 / bpm;
    expect(Math.abs(meanRr - expectedRr) / expectedRr).toBeLessThan(0.05);
  });

  it('keeps detecting through noise and baseline wander', () => {
    const { beats } = runDetector({ bpm: 75, noise: 0.25, wander: 0.6, hum: 0.4 }, 20);
    expect(beats.length).toBeGreaterThan(12);
  });

  it('reports no beats for a flatline', () => {
    const detector = new RPeakDetector({ sampleRateHz: 500 });
    let beats = 0;
    for (let i = 0; i < 500 * 20; i += 1) {
      if (detector.push(0)) beats += 1;
    }
    expect(beats).toBe(0);
  });

  it('does not invent beats when the electrodes are off (railed input)', () => {
    const { beats } = runDetector({ leadOff: true }, 10);
    expect(beats.length).toBeLessThanOrEqual(3);
  });

  it('collapses an unphysiologically fast impulse train', () => {
    const detector = new RPeakDetector({ sampleRateHz: 500 });
    // Impulses every 50 ms (20 Hz) cannot be real beats. The refractory period
    // and the adaptive threshold must combine to reject almost all of them.
    let beats = 0;
    for (let i = 0; i < 500 * 8; i += 1) {
      if (detector.push(i % 25 === 0 ? 900 : 0)) beats += 1;
    }
    expect(detector.isWarmedUp).toBe(true);
    expect(beats).toBeLessThanOrEqual(2);
  });
});
