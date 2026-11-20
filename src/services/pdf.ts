import { jsPDF } from 'jspdf';
import type { SessionMeta } from '../storage/db';
import { analyzeSamples, concatChunks, robustPeak } from './analyze';

export interface PdfOptions {
  meta: SessionMeta;
  chunks: Array<{ samples: Int16Array; leadOff?: Uint8Array }>;
  quality: { score: number | null; category: string };
  electrode: { positive: boolean; negative: boolean } | null;
}

const INK = [230, 238, 245] as const;
const MUTED = [143, 163, 181] as const;
const ACCENT = [34, 211, 238] as const;
const DARK = [7, 11, 17] as const;

function fmt(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  return value.toFixed(digits);
}

/**
 * Builds the session PDF: identity, metadata, rate/HRV table, an ECG plot drawn
 * as vectors from the stored samples, quality/electrode summary and the
 * educational disclaimer.
 */
export function buildPdf({ meta, chunks, quality, electrode }: PdfOptions): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  const { samples } = concatChunks(chunks);
  const analysis = analyzeSamples(samples, meta.sampleRateHz || 500);

  // Header band
  doc.setFillColor(DARK[0], DARK[1], DARK[2]);
  doc.rect(0, 0, pageWidth, 92, 'F');
  doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.text('CARDIOPULSE', margin, 40);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Portable ECG monitoring and heart rhythm analysis', margin, 57);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.setFontSize(8);
  doc.text('Educational prototype - not a medical device', margin, 72);
  doc.text(`Session ${meta.id.slice(0, 18)}`, pageWidth - margin, 40, { align: 'right' });

  let y = 120;
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Session identification', margin, y);
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const rows: Array<[string, string]> = [
    ['Recorded', new Date(meta.startedAt).toLocaleString()],
    ['Ended', new Date(meta.endedAt).toLocaleString()],
    ['Duration', `${(meta.durationMs / 1000).toFixed(1)} s`],
    ['Data source', meta.source === 'simulation' ? 'Simulation (synthetic signal)' : 'Hardware (ESP32 + AD8232)'],
    ['Device', meta.deviceId ?? 'n/a'],
    ['Sample rate', `${meta.sampleRateHz} Hz`],
    ['Samples stored', `${meta.sampleCount.toLocaleString()}`],
    ['Chunks', `${meta.chunkCount}`],
  ];
  rows.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = margin + column * 250;
    const ry = y + row * 14;
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(`${label}`, x, ry);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(value, x + 92, ry);
  });
  y += Math.ceil(rows.length / 2) * 14 + 22;

  // Rate table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Heart rate and variability', margin, y);
  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const metrics: Array<[string, string]> = [
    ['Average heart rate', `${fmt(meta.avgBpm)} bpm`],
    ['Minimum heart rate', `${fmt(meta.minBpm)} bpm`],
    ['Maximum heart rate', `${fmt(meta.maxBpm)} bpm`],
    ['SDNN', meta.sdnnMs === null ? 'insufficient intervals' : `${fmt(meta.sdnnMs, 1)} ms`],
    ['RMSSD', meta.rmssdMs === null ? 'insufficient intervals' : `${fmt(meta.rmssdMs, 1)} ms`],
    ['Valid NN intervals', `${meta.nnCount}`],
    ['Beats detected', `${analysis.beats.length}`],
    ['Mean signal quality', quality.score === null ? 'n/a' : `${quality.score}/100 (${quality.category})`],
  ];
  metrics.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = margin + column * 250;
    const ry = y + row * 14;
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(label, x, ry);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(value, x + 120, ry);
  });
  y += Math.ceil(metrics.length / 2) * 14 + 22;

  // Waveform plot
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('ECG waveform', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text('Filtered 0.5-40 Hz with 50 Hz notch - R-peaks marked', margin, y + 11);
  y += 20;

  const plotWidth = pageWidth - margin * 2;
  const plotHeight = 150;
  doc.setDrawColor(30, 42, 56);
  doc.setFillColor(12, 18, 27);
  doc.rect(margin, y, plotWidth, plotHeight, 'FD');

  const minSamples = 2;
  if (analysis.filtered.length >= minSamples) {
    // Downsample by min/max per column, preserving spikes in the print.
    const columns = 900;
    const perColumn = analysis.filtered.length / columns;
    doc.setDrawColor(ACCENT[0], ACCENT[1], ACCENT[2]);
    doc.setLineWidth(0.5);
    const peak = robustPeak(analysis.filtered);
    const scale = peak > 0 ? (plotHeight * 0.42) / peak : 1;
    const midY = y + plotHeight / 2;
    for (let col = 0; col < columns; col += 1) {
      const from = Math.floor(col * perColumn);
      const to = Math.min(analysis.filtered.length, Math.ceil((col + 1) * perColumn));
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (let i = from; i < to; i += 1) {
        const v = analysis.filtered[i] ?? 0;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (!Number.isFinite(lo)) continue;
      const x = margin + (col / columns) * plotWidth;
      doc.line(x, midY - hi * scale, x, midY - lo * scale);
    }

    // Beat ticks along the top of the plot.
    doc.setDrawColor(45, 212, 191);
    for (const beat of analysis.beats) {
      const x = margin + (beat.index / Math.max(1, analysis.filtered.length - 1)) * plotWidth;
      doc.line(x, y + 4, x, y + 12);
    }
  } else {
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text('No samples stored for this session.', margin + 10, y + plotHeight / 2);
  }

  y += plotHeight + 22;

  // Quality + electrodes
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text('Signal quality and electrodes', margin, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(
    `Quality score is a technical measure (saturation, noise, baseline stability, RR consistency), not a clinical confidence value.`,
    margin,
    y,
    { maxWidth: plotWidth },
  );
  y += 20;
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(
    `LO+ : ${electrode ? (electrode.positive ? 'lead-off detected' : 'connected') : 'not recorded'}      LO- : ${
      electrode ? (electrode.negative ? 'lead-off detected' : 'connected') : 'not recorded'
    }`,
    margin,
    y,
  );
  y += 24;

  if (meta.notes.trim()) {
    doc.setFont('helvetica', 'bold');
    doc.text('Operator notes', margin, y);
    y += 13;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(meta.notes.trim(), margin, y, { maxWidth: plotWidth });
    y += 26;
  }

  // Disclaimer footer
  const footerY = doc.internal.pageSize.getHeight() - 72;
  doc.setDrawColor(251, 191, 36);
  doc.setLineWidth(0.8);
  doc.line(margin, footerY - 12, pageWidth - margin, footerY - 12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(251, 191, 36);
  doc.text('EDUCATIONAL USE ONLY - NOT A MEDICAL DEVICE', margin, footerY);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(
    'A single-lead AD8232 acquisition cannot diagnose, exclude or monitor cardiac disease. HRV values from short recordings are not clinically interpretable. Do not use for treatment decisions.',
    margin,
    footerY + 11,
    { maxWidth: plotWidth },
  );

  return doc;
}

export function downloadPdf(doc: jsPDF, filename: string): void {
  doc.save(filename);
}
