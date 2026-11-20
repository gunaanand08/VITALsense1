import type { SessionMeta } from '../storage/db';
import { analyzeSamples, concatChunks } from './analyze';

export interface CsvOptions {
  chunks: Array<{ samples: Int16Array; leadOff?: Uint8Array }>;
  meta: Pick<SessionMeta, 'id' | 'startedAt' | 'endedAt' | 'sampleRateHz' | 'source' | 'deviceId' | 'notes'>;
}

const HEADER = 'index,time_ms,raw_adc,filtered,beat,rr_ms,lead_off';

function escape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Full-fidelity CSV: one row per stored sample, no downsampling and no rows
 * dropped. Filtered values and beat markers are re-derived with the same
 * processing chain used live.
 */
export function buildCsv({ chunks, meta }: CsvOptions): string {
  const { samples, leadOff } = concatChunks(chunks);
  const analysis = analyzeSamples(samples, meta.sampleRateHz || 500);

  const lines: string[] = [];
  lines.push('# CARDIOPULSE session export');
  lines.push(`# session_id,${escape(meta.id)}`);
  lines.push(`# started_at,${new Date(meta.startedAt).toISOString()}`);
  lines.push(`# ended_at,${new Date(meta.endedAt).toISOString()}`);
  lines.push(`# source,${meta.source}`);
  lines.push(`# device_id,${escape(meta.deviceId ?? 'n/a')}`);
  lines.push(`# sample_rate_hz,${meta.sampleRateHz}`);
  lines.push(`# sample_count,${samples.length}`);
  lines.push(
    '# columns,index=0-based sample index,time_ms=index/sampleRate,raw_adc=12-bit ADC counts,filtered=0.5-40Hz+notch,beat=1 at detected R-peak,rr_ms=interval ending at this beat,lead_off=1 when electrodes were off',
  );
  if (meta.notes.trim()) lines.push(`# notes,${escape(meta.notes.trim())}`);
  lines.push('# educational prototype - not a medical device');
  lines.push(HEADER);

  const fs = meta.sampleRateHz || 500;
  for (let i = 0; i < samples.length; i += 1) {
    const rr = analysis.beatByIndex.get(i);
    const isBeat = rr !== undefined;
    lines.push(
      `${i},${((i / fs) * 1000).toFixed(2)},${samples[i] ?? 0},${(analysis.filtered[i] ?? 0).toFixed(3)},${
        isBeat ? 1 : ''
      },${rr === null || rr === undefined ? '' : rr.toFixed(1)},${leadOff?.[i] ? 1 : 0}`,
    );
  }

  return lines.join('\n');
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function sessionFilename(meta: SessionMeta, extension: string): string {
  const date = new Date(meta.startedAt);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `cardiopulse_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}_${meta.source}.${extension}`;
}
