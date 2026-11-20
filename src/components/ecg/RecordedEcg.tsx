import { useEffect, useRef } from 'react';
import { robustPeak } from '../../services/analyze';

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export interface RecordedEcgProps {
  filtered: Float32Array;
  leadOff: Uint8Array | null;
  sampleRateHz: number;
  windowSeconds: number;
  offsetSeconds: number;
  height?: number;
  label: string;
}

/**
 * Draws a stored recording window. Unlike the live canvas this is static: a
 * single draw per parameter change, min/max decimated per pixel column.
 */
export function RecordedEcg({
  filtered,
  leadOff,
  sampleRateHz,
  windowSeconds,
  offsetSeconds,
  height = 220,
  label,
}: RecordedEcgProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const w = width;
    const h = height;
    const trace = cssVar('--color-accent', '#ffffff');
    const frame = cssVar('--color-border', '#262626');
    const dim = cssVar('--color-text-dim', '#8a8a8a');

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = cssVar('--color-surface', '#0b0b0b');
    context.fillRect(0, 0, w, h);

    const startIndex = Math.max(0, Math.round(offsetSeconds * sampleRateHz));
    const endIndex = Math.min(filtered.length, startIndex + Math.round(windowSeconds * sampleRateHz));
    const count = endIndex - startIndex;

    // Grid
    for (let t = 0; t <= windowSeconds * 1000; t += 200) {
      const x = (t / (windowSeconds * 1000)) * w;
      context.strokeStyle = t % 1000 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.045)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, h);
      context.stroke();
    }
    for (let row = 1; row < 6; row += 1) {
      const y = (row / 6) * h;
      context.strokeStyle = 'rgba(255,255,255,0.045)';
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(w, y);
      context.stroke();
    }

    if (count > 1) {
      const peak = robustPeak(filtered, startIndex, endIndex);
      const scale = peak > 0 ? (h * 0.42) / peak : 1;
      const columns = Math.max(1, Math.floor(w));
      const perColumn = count / columns;

      // Lead-off shading first, so the trace sits on top.
      if (leadOff) {
        context.fillStyle = 'rgba(191,91,82,0.16)';
        for (let col = 0; col < columns; col += 1) {
          const from = startIndex + Math.floor(col * perColumn);
          const to = Math.min(endIndex, startIndex + Math.ceil((col + 1) * perColumn));
          let anyOff = false;
          for (let i = from; i < to; i += 1) {
            if (leadOff[i]) {
              anyOff = true;
              break;
            }
          }
          if (anyOff) context.fillRect(col, 0, 1, h);
        }
      }

      context.strokeStyle = trace;
      context.lineWidth = 1.2;
      context.beginPath();
      if (count >= columns * 2) {
        for (let col = 0; col < columns; col += 1) {
          const from = startIndex + Math.floor(col * perColumn);
          const to = Math.min(endIndex, startIndex + Math.ceil((col + 1) * perColumn));
          let lo = Number.POSITIVE_INFINITY;
          let hi = Number.NEGATIVE_INFINITY;
          for (let i = from; i < to; i += 1) {
            const v = filtered[i] ?? 0;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          if (!Number.isFinite(lo)) continue;
          const x = ((col + 0.5) / columns) * w;
          context.moveTo(x, h / 2 - hi * scale);
          context.lineTo(x, h / 2 - lo * scale + 0.6);
        }
      } else {
        for (let i = 0; i < count; i += 1) {
          const x = (i / (count - 1)) * w;
          const y = h / 2 - (filtered[startIndex + i] ?? 0) * scale;
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
      }
      context.stroke();
    } else {
      context.fillStyle = dim;
      context.font = '10px "JetBrains Mono", monospace';
      context.fillText('no samples in this window', 12, h / 2);
    }

    context.strokeStyle = frame;
    context.strokeRect(0.5, 0.5, w - 1, h - 1);
  }, [filtered, leadOff, sampleRateHz, windowSeconds, offsetSeconds, height]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className="block w-full border border-border"
      style={{ height }}
    />
  );
}
