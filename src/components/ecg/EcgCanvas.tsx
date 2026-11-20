import { useEffect, useRef } from 'react';
import { ecgEngine } from '../../engine/ecgEngine';
import { cx } from '../../utils/format';

export interface EcgCanvasProps {
  mode: 'raw' | 'filtered';
  windowSeconds: number;
  amplitudeScale?: number;
  showPeaks?: boolean;
  /** When set, render this absolute sample range instead of the live window. */
  frozenRange?: { from: number; to: number } | null;
  className?: string;
  height?: number;
  label: string;
  onReadout?: (readout: { index: number; value: number; timeMs: number } | null) => void;
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** 3.3 V reference over 12 bits with the AD8232's ~1000x gain. */
const COUNTS_PER_MV = 1240;

/**
 * Canvas ECG renderer.
 *
 * Pulls samples straight out of the engine's ring buffer inside rAF — no React
 * state per sample, no unbounded arrays, per-column min/max decimation so a
 * one-sample spike is never lost at any zoom level.
 */
export function EcgCanvas({
  mode,
  windowSeconds,
  amplitudeScale = 1,
  showPeaks = true,
  frozenRange = null,
  className,
  height = 200,
  label,
  onReadout,
}: EcgCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufferRef = useRef<Float32Array>(new Float32Array(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let raf = 0;
    let width = 0;
    let heightPx = 0;
    // Monochrome instrument: a white trace on black paper. The only chromatic
    // value is the ice-blue peak marker, the system's single colour token.
    const colors = {
      trace: cssVar('--color-accent', '#ffffff'),
      peak: cssVar('--color-accent-soft', '#c3d9f3'),
      grid: 'rgba(255,255,255,0.045)',
      gridMajor: 'rgba(255,255,255,0.12)',
      surface: cssVar('--color-surface', '#0b0b0b'),
      dim: cssVar('--color-text-dim', '#8a8a8a'),
      frame: cssVar('--color-border', '#262626'),
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return;
      const nextWidth = Math.round(rect.width * dpr);
      const nextHeight = Math.round(height * dpr);
      if (nextWidth !== width || nextHeight !== heightPx) {
        width = nextWidth;
        heightPx = nextHeight;
        canvas.width = width;
        canvas.height = heightPx;
      }

      const w = width / dpr;
      const h = heightPx / dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, w, h);
      context.fillStyle = colors.surface;
      context.fillRect(0, 0, w, h);

      const fs = ecgEngine.getSampleRate();
      const spanCounts = 1500 / Math.max(0.2, amplitudeScale);
      const baseline = mode === 'raw' ? 2048 : 0;
      const upper = baseline + spanCounts / 2;
      const lower = baseline - spanCounts / 2;
      const yOf = (value: number) => h / 2 - ((value - baseline) / spanCounts) * h * 0.9;

      // ---- grid ------------------------------------------------------------
      const minorMs = fs > 0 && windowSeconds <= 6 ? 40 : 200;
      const majorMs = minorMs * 5;
      context.lineWidth = 1;
      for (let t = 0; t <= windowSeconds * 1000; t += minorMs) {
        const x = (t / (windowSeconds * 1000)) * w;
        context.strokeStyle = t % majorMs === 0 ? colors.gridMajor : colors.grid;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, h);
        context.stroke();
      }
      const minorCounts = COUNTS_PER_MV / 2; // 0.5 mV
      for (let v = baseline - Math.floor(spanCounts / 2 / minorCounts) * minorCounts; v <= lower + spanCounts; v += minorCounts) {
        const y = yOf(v);
        if (y < 0 || y > h) continue;
        const major = Math.abs((v - baseline) % COUNTS_PER_MV) < 1;
        context.strokeStyle = major ? colors.gridMajor : colors.grid;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(w, y);
        context.stroke();
      }

      // ---- samples ---------------------------------------------------------
      const needed = Math.min(
        Math.round((frozenRange ? Math.max(1, frozenRange.to - frozenRange.from + 1) : windowSeconds * fs)),
        Math.max(1, Math.round(fs * 60)),
      );
      if (bufferRef.current.length < needed) bufferRef.current = new Float32Array(needed);
      const buffer = bufferRef.current;

      let count = 0;
      let startAbs = 0;
      if (frozenRange) {
        count = ecgEngine.copyRange(frozenRange.from, frozenRange.to, mode, buffer);
        startAbs = frozenRange.from;
      } else {
        count = ecgEngine.copyWindow(windowSeconds, mode, buffer);
        startAbs = ecgEngine.getLastIndex() - count + 1;
      }

      if (count > 1) {
        context.strokeStyle = colors.trace;
        context.lineWidth = 1.25;
        context.lineJoin = 'round';
        context.beginPath();

        const columns = Math.max(1, Math.floor(w));
        if (count >= columns * 2) {
          // Min/max decimation: two points per pixel column preserve spikes.
          const perColumn = count / columns;
          for (let col = 0; col < columns; col += 1) {
            const from = Math.floor(col * perColumn);
            const to = Math.min(count, Math.ceil((col + 1) * perColumn));
            let min = Number.POSITIVE_INFINITY;
            let max = Number.NEGATIVE_INFINITY;
            for (let i = from; i < to; i += 1) {
              const v = buffer[i] ?? 0;
              if (v < min) min = v;
              if (v > max) max = v;
            }
            if (!Number.isFinite(min)) continue;
            const x = ((col + 0.5) / columns) * w;
            context.moveTo(x, yOf(max));
            context.lineTo(x, yOf(min) + 0.6);
          }
        } else {
          for (let i = 0; i < count; i += 1) {
            const x = (i / (count - 1)) * w;
            const y = yOf(buffer[i] ?? 0);
            if (i === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          }
        }
        context.stroke();

        // ---- R-peak markers ------------------------------------------------
        if (showPeaks) {
          const endAbs = startAbs + count - 1;
          context.fillStyle = colors.peak;
          for (const beat of ecgEngine.getBeats()) {
            if (beat.index < startAbs || beat.index > endAbs) continue;
            const x = ((beat.index - startAbs) / Math.max(1, count - 1)) * w;
            context.fillRect(x - 0.75, h * 0.5 - 26, 1.5, 9);
            context.globalAlpha = 0.55;
            context.fillRect(x - 0.5, h * 0.5 + 17, 1, 9);
            context.globalAlpha = 1;
          }
        }
      } else if (count <= 1) {
        context.fillStyle = colors.dim;
        context.font = '10px "JetBrains Mono", monospace';
        context.fillText('waiting for samples', 10, h / 2 - 6);
      }

      // ---- frame -----------------------------------------------------------
      context.strokeStyle = colors.frame;
      context.lineWidth = 1;
      context.strokeRect(0.5, 0.5, w - 1, h - 1);

      void upper;
      void lower;
    };

    // Draw once immediately: in a background tab rAF never fires, and a blank
    // canvas is a worse first impression than a single stale frame.
    draw();
    return () => cancelAnimationFrame(raf);
  }, [mode, windowSeconds, amplitudeScale, showPeaks, frozenRange, height]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className={cx('block w-full border border-border', className)}
      style={{ height }}
      onMouseLeave={() => onReadout?.(null)}
      onMouseMove={(event) => {
        if (!onReadout) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
        const fs = ecgEngine.getSampleRate();
        const total = frozenRange
          ? frozenRange.to - frozenRange.from + 1
          : Math.round(windowSeconds * fs);
        const startAbs = frozenRange ? frozenRange.from : ecgEngine.getLastIndex() - total + 1;
        const index = startAbs + Math.round(ratio * (total - 1));
        const scratch = new Float32Array(1);
        ecgEngine.copyRange(index, index, mode, scratch);
        onReadout({ index, value: scratch[0] ?? 0, timeMs: (index / fs) * 1000 });
      }}
    />
  );
}
