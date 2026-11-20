import { describe, expect, it } from 'vitest';
import { buildCsv } from '../../src/services/csv';

const meta = {
  id: 'session-123',
  startedAt: Date.UTC(2026, 0, 2, 10, 30, 0),
  endedAt: Date.UTC(2026, 0, 2, 10, 31, 0),
  sampleRateHz: 500,
  source: 'simulation' as const,
  deviceId: 'simulator',
  notes: 'seated, "resting"',
};

function makeChunks(count: number, chunkSize: number) {
  const chunks: Array<{ samples: Int16Array; leadOff: Uint8Array }> = [];
  let produced = 0;
  while (produced < count) {
    const size = Math.min(chunkSize, count - produced);
    const samples = new Int16Array(size);
    const leadOff = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) {
      const phase = ((produced + i) % 100) / 100;
      samples[i] = Math.round(2048 + Math.exp(-((phase - 0.2) ** 2) / 0.001) * 900);
      leadOff[i] = (produced + i) % 250 === 0 ? 1 : 0;
    }
    chunks.push({ samples, leadOff });
    produced += size;
  }
  return chunks;
}

describe('CSV export', () => {
  it('writes one row per sample with no downsampling', () => {
    const chunks = makeChunks(1234, 500);
    const csv = buildCsv({ chunks, meta });
    const lines = csv.split('\n');
    const dataLines = lines.filter((line) => /^\d+,/.test(line));
    expect(dataLines).toHaveLength(1234);
    expect(lines[lines.length - 1]?.startsWith('1233,')).toBe(true);
  });

  it('includes the documented columns and metadata header', () => {
    const csv = buildCsv({ chunks: makeChunks(20, 10), meta });
    expect(csv).toContain('index,time_ms,raw_adc,filtered,beat,rr_ms,lead_off');
    expect(csv).toContain('# session_id,session-123');
    expect(csv).toContain('# sample_rate_hz,500');
    expect(csv).toContain('# sample_count,20');
  });

  it('escapes quotes in operator notes', () => {
    const csv = buildCsv({ chunks: makeChunks(5, 5), meta });
    expect(csv).toContain('# notes,"seated, ""resting"""');
  });

  it('preserves lead-off flags', () => {
    const chunks = makeChunks(300, 100);
    const csv = buildCsv({ chunks, meta });
    const row0 = csv.split('\n').find((line) => line.startsWith('0,')) ?? '';
    const row250 = csv.split('\n').find((line) => line.startsWith('250,')) ?? '';
    expect(row0.endsWith(',1')).toBe(true);
    expect(row250.endsWith(',1')).toBe(true);
    const row10 = csv.split('\n').find((line) => line.startsWith('10,')) ?? '';
    expect(row10.endsWith(',0')).toBe(true);
  });
});
