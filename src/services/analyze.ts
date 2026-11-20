import { DEFAULT_FILTERS, FilterChain } from '../signal/filterChain';
import { RPeakDetector } from '../signal/detector';

export interface AnalyzedBeat {
  index: number;
  rrMs: number | null;
  valid: boolean;
}

export interface AnalysisResult {
  filtered: Float32Array;
  beats: AnalyzedBeat[];
  beatByIndex: Map<number, number | null>;
}

/**
 * Deterministically re-derives the filtered signal and R-peaks from stored raw
 * samples. Exports and replay use the same chain as the live view, so a CSV or
 * PDF can never disagree with what the operator saw.
 */
export function analyzeSamples(samples: Int16Array, sampleRateHz: number): AnalysisResult {
  const filters = new FilterChain(sampleRateHz, DEFAULT_FILTERS);
  const detector = new RPeakDetector({ sampleRateHz });
  const filtered = new Float32Array(samples.length);
  const beats: AnalyzedBeat[] = [];
  const beatByIndex = new Map<number, number | null>();

  for (let i = 0; i < samples.length; i += 1) {
    const value = filters.process(samples[i] ?? 0);
    filtered[i] = value;
    const beat = detector.push(value);
    if (beat) {
      beats.push({ index: beat.index, rrMs: beat.rrMs, valid: beat.valid });
      beatByIndex.set(beat.index, beat.rrMs);
    }
  }

  return { filtered, beats, beatByIndex };
}

/**
 * Spike-resistant amplitude reference: the 99th percentile of |value|.
 * Scaling a plot to the maximum lets one start-up artifact (the filter chain
 * settling at sample 0) flatten the entire trace, which looks like a broken
 * recording in a report.
 */
export function robustPeak(
  values: Float32Array,
  start = 0,
  end = values.length,
  fraction = 0.99,
): number {
  const length = Math.max(0, end - start);
  if (length === 0) return 0;
  const sorted = new Float32Array(length);
  for (let i = 0; i < length; i += 1) sorted[i] = Math.abs(values[start + i] ?? 0);
  sorted.sort();
  return sorted[Math.min(length - 1, Math.floor(length * fraction))] ?? 0;
}

export function concatChunks(chunks: Array<{ samples: Int16Array; leadOff?: Uint8Array }>): {
  samples: Int16Array;
  leadOff: Uint8Array | null;
} {
  const total = chunks.reduce((acc, chunk) => acc + chunk.samples.length, 0);
  const samples = new Int16Array(total);
  const hasLead = chunks.some((chunk) => chunk.leadOff && chunk.leadOff.length > 0);
  const leadOff = hasLead ? new Uint8Array(total) : null;
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk.samples, offset);
    if (leadOff && chunk.leadOff && chunk.leadOff.length === chunk.samples.length) {
      leadOff.set(chunk.leadOff, offset);
    }
    offset += chunk.samples.length;
  }
  return { samples, leadOff };
}
