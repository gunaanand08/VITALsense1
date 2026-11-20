import { useEffect, useMemo, useState } from 'react';
import { Activity, Pause, Play, SlidersHorizontal, ZoomIn } from 'lucide-react';
import { EcgCanvas } from '../../components/ecg/EcgCanvas';
import { Badge, Button, Panel, PanelHeader, Stat } from '../../components/ui/primitives';
import { SegmentedControl, Select, Slider, Toggle } from '../../components/ui/controls';
import { ecgEngine } from '../../engine/ecgEngine';
import { useAppStore } from '../../state/store';
import type { BeatEvent } from '../../types/ecg';
import { formatNumber } from '../../utils/format';

const WINDOWS = [2, 4, 6, 10, 20] as const;

function RrStrip() {
  const [beats, setBeats] = useState<BeatEvent[]>([]);

  useEffect(
    () =>
      ecgEngine.subscribeBeats((beat) => {
        setBeats((previous) => [...previous.slice(-39), beat]);
      }),
    [],
  );

  const intervals = beats.filter((beat) => beat.rrMs !== null);
  const max = Math.max(1200, ...intervals.map((beat) => beat.rrMs ?? 0));

  return (
    <div className="flex h-14 items-end gap-[2px] px-3 pb-2" aria-hidden>
      {Array.from({ length: 40 }).map((_, index) => {
        const beat = intervals[intervals.length - 40 + index];
        const rr = beat?.rrMs ?? null;
        const height = rr === null ? 2 : Math.max(4, Math.round((rr / max) * 44));
        return (
          <div
            key={index}
            title={rr === null ? 'no interval' : `${rr.toFixed(0)} ms`}
            className={
              rr === null
                ? 'flex-1 rounded-none bg-border'
                : beat?.valid
                  ? 'flex-1 rounded-none bg-accent/60'
                  : 'flex-1 rounded-none bg-warn/70'
            }
            style={{ height }}
          />
        );
      })}
    </div>
  );
}

export function EcgAnalysisPage() {
  const telemetry = useAppStore((state) => state.telemetry);
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const updateFilters = useAppStore((state) => state.updateFilters);

  const [freezeAt, setFreezeAt] = useState<number | null>(null);
  const [panSeconds, setPanSeconds] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [readout, setReadout] = useState<{ index: number; value: number; timeMs: number } | null>(null);

  const sampleRate = telemetry.sampleRateHz || settings.sim.sampleRateHz;
  const paused = freezeAt !== null;

  const frozenRange = useMemo(() => {
    if (freezeAt === null) return null;
    const to = Math.max(1, freezeAt - Math.round(panSeconds * sampleRate));
    const from = Math.max(0, to - Math.round(settings.windowSeconds * sampleRate));
    return { from, to };
  }, [freezeAt, panSeconds, sampleRate, settings.windowSeconds]);

  const togglePause = () => {
    if (paused) {
      setFreezeAt(null);
      setPanSeconds(0);
    } else {
      setFreezeAt(ecgEngine.getLastIndex());
      setPanSeconds(0);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="display text-[30px]">ECG Analysis</h1>
            <Badge tone={telemetry.sourceKind === 'simulation' ? 'idle' : 'accent'}>
              {telemetry.sourceKind === 'simulation' ? 'Simulation' : 'Hardware'}
            </Badge>
            {paused && <Badge tone="warn">Frozen</Badge>}
          </div>
          <p className="mt-1.5 max-w-2xl text-[12px] text-text-muted">
            Raw versus filtered signal, R-peak markers, and the processing chain that produces them.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            label="Time window"
            value={String(settings.windowSeconds)}
            onChange={(value) => updateSettings({ windowSeconds: Number(value) })}
            options={WINDOWS.map((seconds) => ({ value: String(seconds), label: `${seconds}s` }))}
          />
          <SegmentedControl
            label="Signal path"
            value={settings.showRaw ? 'raw' : 'filtered'}
            onChange={(value) => updateSettings({ showRaw: value === 'raw' })}
            options={[
              { value: 'filtered', label: 'Filtered' },
              { value: 'raw', label: 'Raw' },
            ]}
          />
          <Button
            size="sm"
            icon={paused ? <Play size={13} aria-hidden /> : <Pause size={13} aria-hidden />}
            onClick={togglePause}
            aria-pressed={paused}
          >
            {paused ? 'Resume' : 'Freeze'}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_312px]">
        <div className="min-w-0 space-y-6">
          <Panel>
            <PanelHeader
              title="Filtered ECG"
              subtitle="0.5–40 Hz band-pass with 50 Hz notch, R-peaks marked"
              icon={<Activity size={14} aria-hidden />}
              actions={<Badge tone="accent">lead I</Badge>}
            />
            <div className="p-2">
              <EcgCanvas
                mode="filtered"
                windowSeconds={settings.windowSeconds}
                amplitudeScale={zoom}
                frozenRange={frozenRange}
                onReadout={setReadout}
                height={230}
                label={`Filtered ECG trace over ${settings.windowSeconds} seconds with detected R-peak markers.`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-border px-3 py-2 sm:grid-cols-4">
              <Stat label="Cursor" value={readout ? readout.value.toFixed(0) : '—'} unit="counts" size="sm" />
              <Stat label="At" value={readout ? `${(readout.timeMs / 1000).toFixed(2)}` : '—'} unit="s" size="sm" />
              <Stat label="Beats" value={telemetry.heartRate.beatCount} size="sm" />
              <Stat label="Artifacts" value={telemetry.artifacts} size="sm" />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Raw signal" subtitle="Unfiltered ADC output — baseline and mains noise included" />
            <div className="p-2">
              <EcgCanvas
                mode="raw"
                windowSeconds={settings.windowSeconds}
                amplitudeScale={zoom}
                frozenRange={frozenRange}
                showPeaks={false}
                height={150}
                label="Raw unfiltered ECG signal."
              />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="RR intervals" subtitle="Last 40 detected intervals; amber bars are rejected artifacts" />
            <RrStrip />
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Inspection" icon={<ZoomIn size={14} aria-hidden />} />
            <div className="space-y-6 p-3">
              <Slider
                label="Amplitude zoom"
                min={0.4}
                max={4}
                step={0.1}
                value={zoom}
                onChange={setZoom}
                format={(value) => `${value.toFixed(1)}×`}
              />
              <Slider
                label="Pan backwards"
                min={0}
                max={40}
                step={0.5}
                value={panSeconds}
                onChange={setPanSeconds}
                format={(value) => `${value.toFixed(1)} s`}
                disabled={!paused}
              />
              <p className="text-[10.5px] leading-relaxed text-text-dim">
                {paused
                  ? 'Frozen frame — resume to return to the live edge of the buffer.'
                  : 'Freeze the display to pan back through the last minute of samples.'}
              </p>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Processing" icon={<SlidersHorizontal size={14} aria-hidden />} />
            <div className="space-y-6 p-3">
              <Toggle
                label="Enable filter chain"
                description="Disabling shows the same path the raw panel uses."
                checked={settings.filters.enabled}
                onChange={(enabled) => updateFilters({ enabled })}
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="hp" className="text-[10px] uppercase tracking-[0.09em] text-text-dim">
                    High-pass
                  </label>
                  <Select
                    id="hp"
                    value={String(settings.filters.highPassHz)}
                    onChange={(event) => updateFilters({ highPassHz: Number(event.target.value) })}
                    className="mt-1 h-8"
                  >
                    <option value="0">Off</option>
                    <option value="0.5">0.5 Hz</option>
                    <option value="1">1 Hz</option>
                    <option value="2">2 Hz</option>
                  </Select>
                </div>
                <div>
                  <label htmlFor="lp" className="text-[10px] uppercase tracking-[0.09em] text-text-dim">
                    Low-pass
                  </label>
                  <Select
                    id="lp"
                    value={String(settings.filters.lowPassHz)}
                    onChange={(event) => updateFilters({ lowPassHz: Number(event.target.value) })}
                    className="mt-1 h-8"
                  >
                    <option value="0">Off</option>
                    <option value="20">20 Hz</option>
                    <option value="40">40 Hz</option>
                    <option value="100">100 Hz</option>
                  </Select>
                </div>
              </div>
              <div>
                <label htmlFor="notch" className="text-[10px] uppercase tracking-[0.09em] text-text-dim">
                  Mains notch
                </label>
                <Select
                  id="notch"
                  value={String(settings.filters.notchHz)}
                  onChange={(event) => updateFilters({ notchHz: Number(event.target.value) })}
                  className="mt-1 h-8"
                >
                  <option value="0">Off</option>
                  <option value="50">50 Hz</option>
                  <option value="60">60 Hz</option>
                </Select>
              </div>
              <p className="text-[10.5px] leading-relaxed text-text-dim">
                Second-order RBJ biquads, re-derived for {sampleRate} Hz. Aggressive cut-offs distort QRS morphology —
                compare with the raw panel before trusting a shape.
              </p>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Electrodes" />
            <div className="space-y-2 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-text-muted">LO+</span>
                <Badge tone={telemetry.quality.leadOffPos ? 'danger' : 'good'} dot>
                  {telemetry.quality.leadOffPos ? 'off' : 'ok'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-text-muted">LO−</span>
                <Badge tone={telemetry.quality.leadOffNeg ? 'danger' : 'good'} dot>
                  {telemetry.quality.leadOffNeg ? 'off' : 'ok'}
                </Badge>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2">
                <span className="text-[12px] text-text-muted">Sample rate</span>
                <span className="font-mono text-[12px] tnum text-text">{sampleRate} Hz</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-text-muted">Buffered</span>
                <span className="font-mono text-[12px] tnum text-text">
                  {formatNumber((ecgEngine.getLastIndex() - ecgEngine.getOldestIndex() + 1) / sampleRate, 1)} s
                </span>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
