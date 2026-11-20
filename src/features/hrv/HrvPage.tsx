import { useEffect, useState } from 'react';
import { HeartPulse, Info, TriangleAlert } from 'lucide-react';
import { BpmTrendChart, RrHistogram, RrHistoryChart } from '../../components/charts/RrCharts';
import { Badge, Panel, PanelHeader, Stat } from '../../components/ui/primitives';
import { ecgEngine } from '../../engine/ecgEngine';
import { useAppStore } from '../../state/store';
import { formatBpm, formatNumber } from '../../utils/format';

const EXPLANATIONS: Array<{ term: string; text: string }> = [
  {
    term: 'BPM',
    text: 'Instantaneous rate derived from 60000 / median of the last five valid RR intervals. The median suppresses single-beat jitter.',
  },
  {
    term: 'RR interval',
    text: 'Milliseconds between consecutive detected R-peaks. Intervals outside 300–2000 ms, or far from the running median, are rejected as artefacts.',
  },
  {
    term: 'SDNN',
    text: 'Standard deviation of valid NN intervals over the current window. Requires at least 10 valid intervals, otherwise it is not shown.',
  },
  {
    term: 'RMSSD',
    text: 'Root mean square of successive NN differences — a short-term variability estimate. Also requires at least 10 valid intervals.',
  },
  {
    term: 'pNN50',
    text: 'Share of successive interval differences larger than 50 ms. Displayed for education, not as a clinical marker.',
  },
];

export function HrvPage() {
  const telemetry = useAppStore((state) => state.telemetry);
  const [intervals, setIntervals] = useState<number[]>(() => ecgEngine.getValidRr());

  useEffect(() => {
    const id = setInterval(() => setIntervals(ecgEngine.getValidRr()), 500);
    return () => clearInterval(id);
  }, []);

  const { heartRate, hrv, quality } = telemetry;
  const insufficient = intervals.length < hrv.required;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="display text-[30px]">Heart Rate &amp; HRV</h1>
          <Badge tone={telemetry.sourceKind === 'simulation' ? 'idle' : 'accent'}>
            {telemetry.sourceKind === 'simulation' ? 'Simulation' : 'Hardware'}
          </Badge>
          <Badge tone={insufficient ? 'warn' : 'good'}>{insufficient ? 'acquiring' : 'computable'}</Badge>
        </div>
        <p className="mt-1.5 max-w-2xl text-[12px] text-text-muted">
          Only valid, artefact-free intervals feed these numbers. Values are withheld until there is enough valid data —
          nothing here is interpolated or invented.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_312px]">
        <div className="min-w-0 space-y-6">
          <Panel>
            <PanelHeader title="Rate summary" icon={<HeartPulse size={14} aria-hidden />} />
            <div className="grid grid-cols-2 gap-x-3 gap-y-4 p-3 sm:grid-cols-3 lg:grid-cols-4">
              <Stat label="Current" value={formatBpm(heartRate.bpm)} unit="bpm" tone="accent" size="lg" />
              <Stat label="Average" value={formatBpm(heartRate.meanBpm)} unit="bpm" />
              <Stat label="Minimum" value={formatBpm(heartRate.minBpm)} unit="bpm" />
              <Stat label="Maximum" value={formatBpm(heartRate.maxBpm)} unit="bpm" />
              <Stat label="Latest RR" value={formatNumber(heartRate.lastRrMs, 0)} unit="ms" />
              <Stat label="Valid intervals" value={hrv.nnCount} />
              <Stat label="Artifacts" value={telemetry.artifacts} hint="rejected beats" />
              <Stat label="Quality" value={quality.category === 'none' ? '—' : quality.score} unit="/100" />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="RR interval history" subtitle={`${intervals.length} valid intervals`} />
            <div className="p-2">
              <RrHistoryChart intervals={intervals} />
            </div>
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="RR distribution" subtitle="Interval histogram" />
              <div className="p-2">
                <RrHistogram intervals={intervals} />
              </div>
            </Panel>
            <Panel>
              <PanelHeader title="Heart-rate trend" subtitle="Derived from RR intervals" />
              <div className="p-2">
                <BpmTrendChart intervals={intervals} />
              </div>
            </Panel>
          </div>
        </div>

        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Variability metrics" />
            <div className="space-y-6 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-text-muted">SDNN</span>
                <span className="font-mono text-[18px] tnum text-text">
                  {hrv.sdnnMs === null ? '—' : `${formatNumber(hrv.sdnnMs, 1)} ms`}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-text-muted">RMSSD</span>
                <span className="font-mono text-[18px] tnum text-text">
                  {hrv.rmssdMs === null ? '—' : `${formatNumber(hrv.rmssdMs, 1)} ms`}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-text-muted">pNN50</span>
                <span className="font-mono text-[18px] tnum text-text">
                  {hrv.pnn50 === null ? '—' : `${(hrv.pnn50 * 100).toFixed(1)} %`}
                </span>
              </div>

              {insufficient && (
                <div className="flex items-start gap-2 rounded-none border border-warn/30 bg-warn/[0.06] p-2">
                  <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                  <p className="text-[11px] leading-relaxed text-text-muted">
                    Insufficient valid intervals ({intervals.length}/{hrv.required}). SDNN and RMSSD stay hidden until
                    enough clean beats exist.
                  </p>
                </div>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="What these mean" icon={<Info size={14} aria-hidden />} />
            <dl className="divide-y divide-border">
              {EXPLANATIONS.map((item) => (
                <div key={item.term} className="px-3 py-2">
                  <dt className="text-[11px] label-mono text-text-muted">{item.term}</dt>
                  <dd className="mt-0.5 text-[11px] leading-relaxed text-text-dim">{item.text}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel className="border-warn/30 p-3">
            <p className="text-[11px] leading-relaxed text-text-muted">
              Short recordings, a single lead and a hobby-grade front-end make these HRV values educational only. They
              are not suitable for clinical assessment or comparison against normative tables.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
