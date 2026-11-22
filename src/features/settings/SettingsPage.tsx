import { useCallback, useEffect, useState } from 'react';
import { Cable, Cloud, Cpu, Gauge, PlugZap, Radar, RefreshCw, Save, Trash2, Waves } from 'lucide-react';
import { Badge, Button, IconButton, InlineCode, Panel, PanelHeader, Stat } from '../../components/ui/primitives';
import { NumberInput, Select, Slider, TextInput, Toggle } from '../../components/ui/controls';
import { SIMULATION_PRESETS } from '../../data/simulationSource';
import { ECG_DEVICES_TABLE } from '../../data/supabaseSource';
import { isSupabaseConfigured, supabase, supabaseProjectUrl } from '../../lib/supabase';
import { useAppStore } from '../../state/store';
import { storageEstimate } from '../../storage/db';
import { formatBytes, formatNumber } from '../../utils/format';

interface DiscoveredDevice {
  deviceId: string;
  ip?: string;
  port?: number;
  firmware?: string | null;
  sampleRateHz?: number | null;
  source?: string;
  lastSeenMs?: number | null;
}

const DEVICE_KEY = 'cardiopulse.known-devices.v1';

function loadKnownDevices(): DiscoveredDevice[] {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    return raw ? (JSON.parse(raw) as DiscoveredDevice[]) : [];
  } catch {
    return [];
  }
}

function saveKnownDevices(devices: DiscoveredDevice[]): void {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(devices.slice(0, 12)));
  } catch {
    // Ignore: settings still work for this session.
  }
}

export function SettingsPage() {
  const settings = useAppStore((state) => state.settings);
  const mode = useAppStore((state) => state.mode);
  const telemetry = useAppStore((state) => state.telemetry);
  const setMode = useAppStore((state) => state.setMode);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const updateFilters = useAppStore((state) => state.updateFilters);
  const updateSim = useAppStore((state) => state.updateSim);
  const reconnect = useAppStore((state) => state.reconnect);
  const pushToast = useAppStore((state) => state.pushToast);

  const [bridgeInput, setBridgeInput] = useState(settings.bridgeUrl);
  const [health, setHealth] = useState<{ ok: boolean; detail: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [known, setKnown] = useState<DiscoveredDevice[]>(() => loadKnownDevices());
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [cloudTesting, setCloudTesting] = useState(false);

  useEffect(() => {
    void storageEstimate().then(setStorage);
  }, []);

  const httpBase = (() => {
    try {
      const url = new URL(settings.bridgeUrl);
      url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
      url.pathname = '';
      return url.toString().replace(/\/$/, '');
    } catch {
      return 'http://127.0.0.1:8787';
    }
  })();

  const testConnection = useCallback(async () => {
    setTesting(true);
    try {
      const response = await fetch(`${httpBase}/health`, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { ok?: boolean; devices?: unknown[]; protocol_version?: number };
      setHealth({
        ok: Boolean(data.ok),
        detail: `Bridge reachable · protocol v${data.protocol_version ?? '?'} · ${data.devices?.length ?? 0} device(s)`,
      });
      pushToast({ tone: 'success', title: 'Bridge reachable', message: httpBase });
    } catch (error) {
      setHealth({ ok: false, detail: `Unreachable: ${String(error)}` });
      pushToast({
        tone: 'danger',
        title: 'Bridge unreachable',
        message: 'Start it with npm run server, then test again.',
      });
    } finally {
      setTesting(false);
    }
  }, [httpBase, pushToast]);

  const testCloud = useCallback(async () => {
    if (!supabase) return;
    setCloudTesting(true);
    try {
      // A head-only count exercises the key, the URL and the RLS policy without
      // pulling any sample data into the browser.
      const { error, count } = await supabase.from(ECG_DEVICES_TABLE).select('device_id', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
      setHealth({ ok: true, detail: `Supabase reachable · ${count ?? 0} known device(s)` });
      pushToast({ tone: 'success', title: 'Supabase reachable', message: supabaseProjectUrl });
    } catch (error) {
      setHealth({ ok: false, detail: `Supabase unreachable: ${String(error)}` });
      pushToast({
        tone: 'danger',
        title: 'Supabase unreachable',
        message: 'Check the project URL, the key, and that supabase/schema.sql has been run.',
      });
    } finally {
      setCloudTesting(false);
    }
  }, [pushToast]);

  const discover = useCallback(async () => {
    setDiscovering(true);
    try {
      const response = await fetch(`${httpBase}/api/devices`, { signal: AbortSignal.timeout(6000) });
      const data = (await response.json()) as { devices?: DiscoveredDevice[] };
      const found = data.devices ?? [];
      setDevices(found);
      if (found.length === 0) {
        pushToast({
          tone: 'warning',
          title: 'No devices found',
          message: 'mDNS found nothing. Enter the device or bridge address manually below.',
        });
      } else {
        const merged = [...found, ...known.filter((k) => !found.some((f) => f.deviceId === k.deviceId))];
        setKnown(merged);
        saveKnownDevices(merged);
        pushToast({ tone: 'success', title: `${found.length} device(s) found` });
      }
    } catch (error) {
      pushToast({ tone: 'danger', title: 'Discovery failed', message: String(error) });
    } finally {
      setDiscovering(false);
    }
  }, [httpBase, known, pushToast]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-[30px]">Device Settings</h1>
        <p className="mt-1.5 max-w-2xl text-[12px] text-text-muted">
          Choose the data source, configure acquisition and inspect transport diagnostics. Settings persist in this
          browser.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Data source" subtitle="Simulation or ESP32 hardware" icon={<PlugZap size={14} aria-hidden />} />
          <div className="space-y-6 p-3">
            <div className="grid grid-cols-2 gap-2">
              {(['simulation', 'hardware'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => void setMode(option)}
                  aria-pressed={mode === option}
                  className={[
                    'rounded-none border px-4 py-3 text-left transition-colors duration-[120ms]',
                    mode === option
                      ? 'border-text bg-text/[0.045] text-text'
                      : 'border-border text-text-muted hover:border-border-strong hover:text-text',
                  ].join(' ')}
                >
                  <span className="block font-mono text-[10px] uppercase tracking-[0.18em]">{option}</span>
                  <span className="mt-0.5 block text-[10.5px] leading-snug text-text-dim">
                    {option === 'simulation'
                      ? 'Synthetic ECG, no hardware needed'
                      : isSupabaseConfigured
                        ? 'ESP32 + AD8232 via Supabase'
                        : 'ESP32 + AD8232 via local bridge'}
                  </span>
                </button>
              ))}
            </div>

            <div className="rounded-none border border-border p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-text-muted">Hardware transport</span>
                <Badge tone={isSupabaseConfigured ? 'good' : 'neutral'} dot>
                  {isSupabaseConfigured ? 'supabase' : 'local bridge'}
                </Badge>
              </div>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-text-dim">
                {isSupabaseConfigured ? (
                  <>
                    Batches stream from <InlineCode>{supabaseProjectUrl}</InlineCode> over Realtime, so a hosted build
                    needs no local server. They appear once a device publishes through{' '}
                    <InlineCode>npm run gateway</InlineCode>; until then the trace waits rather than inventing samples.
                  </>
                ) : (
                  <>
                    No cloud project configured, so hardware mode uses the local bridge below. Add{' '}
                    <InlineCode>VITE_SUPABASE_URL</InlineCode> and <InlineCode>VITE_SUPABASE_PUBLISHABLE_KEY</InlineCode>{' '}
                    to stream from Supabase on a hosted build.
                  </>
                )}
              </p>
              {isSupabaseConfigured && (
                <Button
                  size="sm"
                  className="mt-2"
                  icon={<Cloud size={12} aria-hidden />}
                  onClick={() => void testCloud()}
                  disabled={cloudTesting}
                >
                  {cloudTesting ? 'Testing…' : 'Test cloud connection'}
                </Button>
              )}
            </div>

            <div className="rounded-none border border-border p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-text-muted">Connection</span>
                <Badge
                  tone={
                    telemetry.connection.state === 'streaming'
                      ? 'good'
                      : telemetry.connection.state === 'error'
                        ? 'danger'
                        : 'warn'
                  }
                  dot
                >
                  {telemetry.connection.state}
                </Badge>
              </div>
              <p className="mt-1 font-mono text-[10.5px] text-text-dim">
                {telemetry.connection.deviceId ?? 'no device'} · {telemetry.connection.stats.samples.toLocaleString()} samples
              </p>
              <Button
                size="sm"
                className="mt-2"
                icon={<RefreshCw size={12} aria-hidden />}
                onClick={() => void reconnect()}
              >
                Reconnect source
              </Button>
            </div>

            <div>
              <label htmlFor="bridge" className="text-[10px] label-mono text-text-dim">
                WebSocket endpoint
              </label>
              <div className="mt-1 flex gap-2">
                <TextInput
                  id="bridge"
                  value={bridgeInput}
                  onChange={(event) => setBridgeInput(event.target.value)}
                  className="font-mono text-[12px]"
                />
                <Button
                  icon={<Save size={13} aria-hidden />}
                  onClick={() => {
                    updateSettings({ bridgeUrl: bridgeInput });
                    pushToast({ tone: 'success', title: 'Endpoint saved', message: bridgeInput });
                  }}
                >
                  Save
                </Button>
              </div>
              <p className="mt-1 text-[10.5px] text-text-dim">
                Used only when no cloud project is configured. Default{' '}
                <InlineCode>{`ws://${window.location.host}/ws`}</InlineCode> works through the Vite proxy; a production
                build must point at the bridge directly, e.g. <InlineCode>ws://127.0.0.1:8787/ws</InlineCode>.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void testConnection()} disabled={testing}>
                {testing ? 'Testing…' : 'Test connection'}
              </Button>
              <Button size="sm" icon={<Radar size={12} aria-hidden />} onClick={() => void discover()} disabled={discovering}>
                {discovering ? 'Discovering…' : 'Discover devices'}
              </Button>
              {health && (
                <span className={health.ok ? 'text-[11px] text-good' : 'text-[11px] text-danger'}>{health.detail}</span>
              )}
            </div>

            {devices.length > 0 && (
              <div className="rounded-none border border-border">
                <p className="border-b border-border px-2 py-1 text-[10px] uppercase tracking-[0.09em] text-text-dim">
                  Discovered now
                </p>
                <ul className="divide-y divide-border">
                  {devices.map((device) => (
                    <li key={device.deviceId} className="flex items-center justify-between px-2 py-1.5">
                      <span className="font-mono text-[11px] text-text">{device.deviceId}</span>
                      <span className="font-mono text-[10px] text-text-dim">
                        {device.ip ?? 'via bridge'}
                        {device.sampleRateHz ? ` · ${device.sampleRateHz} Hz` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Simulation" subtitle="Synthetic signal generator" icon={<Waves size={14} aria-hidden />} />
          <div className="space-y-6 p-3">
            <div className="flex flex-wrap gap-1.5">
              {SIMULATION_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  size="sm"
                  onClick={() => {
                    updateSim(preset.config);
                    pushToast({ tone: 'info', title: `${preset.name} applied`, message: preset.description });
                  }}
                >
                  {preset.name}
                </Button>
              ))}
            </div>

            <Slider
              label="Heart rate"
              min={40}
              max={180}
              step={1}
              value={settings.sim.bpm}
              onChange={(bpm) => updateSim({ bpm })}
              format={(value) => `${value} bpm`}
            />
            <Slider
              label="Noise"
              min={0}
              max={1}
              step={0.02}
              value={settings.sim.noise}
              onChange={(noise) => updateSim({ noise })}
              format={(value) => `${Math.round(value * 100)} %`}
            />
            <Slider
              label="Baseline wander"
              min={0}
              max={1}
              step={0.02}
              value={settings.sim.wander}
              onChange={(wander) => updateSim({ wander })}
              format={(value) => `${Math.round(value * 100)} %`}
            />
            <Slider
              label="50 Hz interference"
              min={0}
              max={1}
              step={0.02}
              value={settings.sim.hum}
              onChange={(hum) => updateSim({ hum })}
              format={(value) => `${Math.round(value * 100)} %`}
            />
            <Slider
              label="RR irregularity"
              min={0}
              max={1}
              step={0.02}
              value={settings.sim.irregularity}
              onChange={(irregularity) => updateSim({ irregularity })}
              format={(value) => `${Math.round(value * 100)} %`}
            />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="amp" className="text-[10px] label-mono text-text-dim">
                  Amplitude (counts)
                </label>
                <NumberInput
                  id="amp"
                  value={settings.sim.amplitude}
                  min={200}
                  max={3000}
                  step={50}
                  onValueChange={(amplitude) => updateSim({ amplitude })}
                />
              </div>
              <div>
                <label htmlFor="rate" className="text-[10px] label-mono text-text-dim">
                  Sample rate
                </label>
                <Select
                  id="rate"
                  value={String(settings.sim.sampleRateHz)}
                  onChange={(event) => updateSim({ sampleRateHz: Number(event.target.value) })}
                >
                  {[250, 500, 1000].map((rate) => (
                    <option key={rate} value={rate}>
                      {rate} Hz
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <Toggle
              label="Simulate electrode disconnection"
              description="Rails the input and raises the lead-off flags."
              checked={settings.sim.leadOff}
              onChange={(leadOff) => updateSim({ leadOff })}
            />

            <p className="text-[10.5px] leading-relaxed text-text-dim">
              Simulation never mixes with hardware data. Switching source clears the buffers so traces cannot blend.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Signal processing" subtitle="Applied live to both sources" icon={<Gauge size={14} aria-hidden />} />
          <div className="space-y-6 p-3">
            <Toggle
              label="Filter chain enabled"
              description="High-pass, low-pass and notch stages."
              checked={settings.filters.enabled}
              onChange={(enabled) => updateFilters({ enabled })}
            />
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label htmlFor="s-hp" className="text-[10px] label-mono text-text-dim">
                  High-pass
                </label>
                <Select
                  id="s-hp"
                  value={String(settings.filters.highPassHz)}
                  onChange={(event) => updateFilters({ highPassHz: Number(event.target.value) })}
                >
                  <option value="0">Off</option>
                  <option value="0.5">0.5</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                </Select>
              </div>
              <div>
                <label htmlFor="s-lp" className="text-[10px] label-mono text-text-dim">
                  Low-pass
                </label>
                <Select
                  id="s-lp"
                  value={String(settings.filters.lowPassHz)}
                  onChange={(event) => updateFilters({ lowPassHz: Number(event.target.value) })}
                >
                  <option value="0">Off</option>
                  <option value="20">20</option>
                  <option value="40">40</option>
                  <option value="100">100</option>
                </Select>
              </div>
              <div>
                <label htmlFor="s-notch" className="text-[10px] label-mono text-text-dim">
                  Notch
                </label>
                <Select
                  id="s-notch"
                  value={String(settings.filters.notchHz)}
                  onChange={(event) => updateFilters({ notchHz: Number(event.target.value) })}
                >
                  <option value="0">Off</option>
                  <option value="50">50</option>
                  <option value="60">60</option>
                </Select>
              </div>
            </div>
            <p className="text-[10.5px] leading-relaxed text-text-dim">
              Firmware-side settings (ADC pin, attenuation, batch size) require re-flashing the ESP32 — see{' '}
              <InlineCode>firmware/cardiopulse-esp32/config.example.h</InlineCode>.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Display & motion" icon={<Cpu size={14} aria-hidden />} />
          <div className="space-y-2 p-3">
            <Toggle
              label="3D heart animation"
              description="Disable on low-power machines; the ECG renderer keeps full frame rate."
              checked={settings.heart3d}
              onChange={(heart3d) => updateSettings({ heart3d })}
            />
            <Toggle
              label="Prefer raw signal on analysis page"
              description="Opens ECG Analysis on the unfiltered trace."
              checked={settings.showRaw}
              onChange={(showRaw) => updateSettings({ showRaw })}
            />
            <div>
              <label htmlFor="win" className="text-[10px] label-mono text-text-dim">
                Default time window
              </label>
              <Select
                id="win"
                value={String(settings.windowSeconds)}
                onChange={(event) => updateSettings({ windowSeconds: Number(event.target.value) })}
              >
                {[2, 4, 6, 10, 20].map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} s
                  </option>
                ))}
              </Select>
            </div>
            <p className="text-[10.5px] leading-relaxed text-text-dim">
              Motion also follows the system <InlineCode>prefers-reduced-motion</InlineCode> setting automatically.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Transport diagnostics" icon={<Cable size={14} aria-hidden />} />
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 p-3">
            <Stat label="Batches" value={telemetry.connection.stats.batches} size="sm" />
            <Stat label="Samples" value={telemetry.connection.stats.samples.toLocaleString()} size="sm" />
            <Stat label="Sequence gaps" value={telemetry.connection.stats.gaps} size="sm" tone={telemetry.connection.stats.gaps > 0 ? 'warn' : 'neutral'} />
            <Stat label="Out of order" value={telemetry.connection.stats.outOfOrder} size="sm" />
            <Stat label="Sample rate" value={telemetry.sampleRateHz} unit="Hz" size="sm" />
            <Stat
              label="Last packet"
              value={
                telemetry.connection.lastPacketAtMs ? `${(telemetry.sampleAgeMs / 1000).toFixed(1)} s ago` : '—'
              }
              size="sm"
            />
            <Stat label="Reconnect attempts" value={telemetry.connection.reconnectAttempts} size="sm" />
            <Stat label="Firmware" value={telemetry.connection.label} size="sm" />
          </div>
          <div className="border-t border-border px-3 py-2">
            <p className="text-[10.5px] leading-relaxed text-text-dim">
              ADC: 12-bit, 3.3 V reference, {formatNumber(1240, 0)} counts ≈ 1 mV at the AFE input (gain 1000). Device
              time and receive time are tracked separately; no latency promise is made.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Known devices"
            subtitle="Saved in this browser"
            actions={
              known.length > 0 ? (
                <IconButton
                  label="Forget all known devices"
                  variant="danger"
                  onClick={() => {
                    setKnown([]);
                    saveKnownDevices([]);
                    pushToast({ tone: 'info', title: 'Known devices cleared' });
                  }}
                >
                  <Trash2 size={13} aria-hidden />
                </IconButton>
              ) : undefined
            }
          />
          {known.length === 0 ? (
            <p className="px-3 py-6 text-[11px] text-text-dim">
              No devices saved yet. Discovery or a successful connection adds entries here.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {known.map((device) => (
                <li key={device.deviceId} className="flex items-center justify-between px-3 py-2">
                  <span className="font-mono text-[11px] text-text">{device.deviceId}</span>
                  <span className="font-mono text-[10px] text-text-dim">
                    {device.ip ?? 'bridge'} {device.firmware ? `· fw ${device.firmware}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border px-3 py-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-text-dim">Browser storage</span>
              <span className="font-mono text-text">
                {storage ? `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}` : 'unavailable'}
              </span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
