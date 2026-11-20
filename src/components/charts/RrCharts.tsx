import { useMemo } from 'react';

const HISTORY_PAD = { left: 34, right: 8, top: 8, bottom: 18 } as const;

/** Line chart of RR intervals over beat index (SVG, no chart dependency). */
export function RrHistoryChart({ intervals }: { intervals: number[] }) {
  const width = 640;
  const height = 150;
  const pad = HISTORY_PAD;

  const { path, min, max } = useMemo(() => {
    if (intervals.length < 2) return { path: '', min: 0, max: 0 };
    const { left, right, top, bottom } = HISTORY_PAD;
    const lo = Math.min(...intervals);
    const hi = Math.max(...intervals);
    const span = Math.max(40, hi - lo);
    const innerW = width - left - right;
    const innerH = height - top - bottom;
    const points = intervals.map((rr, index) => {
      const x = left + (index / (intervals.length - 1)) * innerW;
      const y = top + innerH - ((rr - lo) / span) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { path: `M${points.join(' L')}`, min: lo, max: hi };
  }, [intervals]);

  if (intervals.length < 2) {
    return <p className="px-3 py-6 text-[11px] text-text-dim">Not enough intervals to plot a series yet.</p>;
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`RR interval history, ${intervals.length} intervals from ${Math.round(min)} to ${Math.round(max)} milliseconds`} className="w-full">
      {[0, 0.5, 1].map((ratio) => (
        <line
          key={ratio}
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + ratio * (height - pad.top - pad.bottom)}
          y2={pad.top + ratio * (height - pad.top - pad.bottom)}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={1}
        />
      ))}
      <text x={2} y={pad.top + 4} fill="#8a8a8a" fontSize={9} fontFamily="JetBrains Mono, monospace">
        {Math.round(max)}
      </text>
      <text x={2} y={height - pad.bottom} fill="#8a8a8a" fontSize={9} fontFamily="JetBrains Mono, monospace">
        {Math.round(min)}
      </text>
      <path d={path} fill="none" stroke="#ffffff" strokeWidth={1.2} strokeLinejoin="round" />
      {intervals.map((rr, index) => {
        const x = pad.left + (index / (intervals.length - 1)) * (width - pad.left - pad.right);
        const span = Math.max(40, max - min);
        const y = pad.top + (height - pad.top - pad.bottom) - ((rr - min) / span) * (height - pad.top - pad.bottom);
        return <circle key={`${index}-${rr}`} cx={x} cy={y} r={1.4} fill="#c3d9f3" opacity={0.8} />;
      })}
    </svg>
  );
}

/** 24-bin histogram of RR intervals. */
export function RrHistogram({ intervals }: { intervals: number[] }) {
  const width = 640;
  const height = 150;
  const pad = { left: 28, right: 8, top: 8, bottom: 20 };

  const bins = useMemo(() => {
    if (intervals.length < 3) return [];
    const lo = Math.min(...intervals);
    const hi = Math.max(...intervals);
    const span = Math.max(30, hi - lo);
    const count = 24;
    const out = Array.from({ length: count }, (_, index) => ({
      from: lo + (index / count) * span,
      to: lo + ((index + 1) / count) * span,
      count: 0,
    }));
    for (const rr of intervals) {
      const index = Math.min(count - 1, Math.max(0, Math.floor(((rr - lo) / span) * count)));
      const bin = out[index];
      if (bin) bin.count += 1;
    }
    return out;
  }, [intervals]);

  if (bins.length === 0) {
    return <p className="px-3 py-6 text-[11px] text-text-dim">Not enough intervals for a distribution.</p>;
  }

  const maxCount = Math.max(...bins.map((bin) => bin.count), 1);
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const barWidth = innerW / bins.length;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`RR interval distribution across ${bins.length} bins, peak count ${maxCount}`} className="w-full">
      {bins.map((bin, index) => {
        const barHeight = (bin.count / maxCount) * innerH;
        return (
          <rect
            key={index}
            x={pad.left + index * barWidth}
            y={pad.top + innerH - barHeight}
            width={Math.max(1, barWidth - 1.5)}
            height={barHeight}
            fill="rgba(255,255,255,0.5)"
          />
        );
      })}
      <line x1={pad.left} x2={width - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} stroke="#262626" />
      <text x={pad.left} y={height - 6} fill="#8a8a8a" fontSize={9} fontFamily="JetBrains Mono, monospace">
        {Math.round(bins[0]?.from ?? 0)} ms
      </text>
      <text x={width - pad.right - 40} y={height - 6} fill="#8a8a8a" fontSize={9} fontFamily="JetBrains Mono, monospace">
        {Math.round(bins[bins.length - 1]?.to ?? 0)} ms
      </text>
    </svg>
  );
}

/** Cardiac trend: instantaneous rate over the last intervals. */
export function BpmTrendChart({ intervals }: { intervals: number[] }) {
  const rates = useMemo(() => intervals.map((rr) => (rr > 0 ? 60000 / rr : 0)).filter((v) => v > 0), [intervals]);
  const width = 640;
  const height = 120;
  const pad = { left: 30, right: 8, top: 8, bottom: 16 };

  if (rates.length < 2) {
    return <p className="px-3 py-6 text-[11px] text-text-dim">Trend appears after a few beats.</p>;
  }

  const lo = Math.min(...rates) - 4;
  const hi = Math.max(...rates) + 4;
  const span = Math.max(10, hi - lo);
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const points = rates.map((rate, index) => {
    const x = pad.left + (index / (rates.length - 1)) * innerW;
    const y = pad.top + innerH - ((rate - lo) / span) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Heart rate trend from ${Math.round(lo)} to ${Math.round(hi)} beats per minute`} className="w-full">
      <path d={`M${points.join(' L')}`} fill="none" stroke="#ffffff" strokeWidth={1.2} />
      <text x={2} y={pad.top + 4} fill="#8a8a8a" fontSize={9} fontFamily="JetBrains Mono, monospace">
        {Math.round(hi)}
      </text>
      <text x={2} y={height - pad.bottom} fill="#8a8a8a" fontSize={9} fontFamily="JetBrains Mono, monospace">
        {Math.round(lo)}
      </text>
    </svg>
  );
}
