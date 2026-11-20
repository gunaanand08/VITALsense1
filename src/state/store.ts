import { create } from 'zustand';
import { DEFAULT_SIM_CONFIG } from '../data/ecgSynthesizer';
import { Esp32DataSource } from '../data/esp32Source';
import { SimulationDataSource } from '../data/simulationSource';
import { ecgEngine } from '../engine/ecgEngine';
import { DEFAULT_FILTERS, type FilterOptions } from '../signal/filterChain';
import { newSessionId, saveSession } from '../storage/db';
import type { TelemetrySnapshot } from '../types/ecg';
import type { DataSource, SimulationConfig } from '../types/source';

export type Mode = 'simulation' | 'hardware';

export interface Settings {
  filters: FilterOptions;
  windowSeconds: number;
  showRaw: boolean;
  heart3d: boolean;
  bridgeUrl: string;
  sim: SimulationConfig;
}

export interface Toast {
  id: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
  title: string;
  message?: string;
}

interface AppState {
  mode: Mode;
  telemetry: TelemetrySnapshot;
  settings: Settings;
  toasts: Toast[];
  recording: boolean;
  sessionLabel: string | null;
  busy: boolean;

  setMode: (mode: Mode) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => void;
  updateFilters: (patch: Partial<FilterOptions>) => void;
  updateSim: (patch: Partial<SimulationConfig>) => void;
  startSession: () => void;
  stopSession: () => Promise<void>;
  pushToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  reconnect: () => Promise<void>;
}

const STORAGE_KEY = 'cardiopulse.settings.v1';

function defaultBridgeUrl(): string {
  if (typeof window === 'undefined') return 'ws://127.0.0.1:8787/ws';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // The bridge listens on its own port. The dev origin only works while Vite's
  // proxy is running, so a production build must address the bridge directly.
  const host = window.location.hostname || '127.0.0.1';
  return `${protocol}//${host}:8787/ws`;
}

const DEFAULT_SETTINGS: Settings = {
  filters: { ...DEFAULT_FILTERS },
  windowSeconds: 6,
  showRaw: false,
  heart3d: true,
  bridgeUrl: defaultBridgeUrl(),
  sim: { ...DEFAULT_SIM_CONFIG },
};

function loadSettings(): Settings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      filters: { ...DEFAULT_FILTERS, ...(parsed.filters ?? {}) },
      sim: { ...DEFAULT_SIM_CONFIG, ...(parsed.sim ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persist(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable (private mode); settings simply do not persist.
  }
}

let activeSource: DataSource | null = null;

const INITIAL_TELEMETRY: TelemetrySnapshot = {
  sourceKind: 'simulation',
  deviceId: null,
  connection: {
    kind: 'simulation',
    state: 'disconnected',
    deviceId: null,
    label: 'No source',
    sampleRateHz: 0,
    lastPacketAtMs: null,
    stats: { batches: 0, samples: 0, gaps: 0, outOfOrder: 0, lastBatchAtMs: null, lastSequence: null },
    error: null,
    reconnectAttempts: 0,
  },
  heartRate: { bpm: null, meanBpm: null, minBpm: null, maxBpm: null, lastRrMs: null, beatCount: 0 },
  hrv: { sdnnMs: null, rmssdMs: null, pnn50: null, nnCount: 0, required: 10 },
  quality: { score: 0, category: 'none', reasons: [], leadOffPos: false, leadOffNeg: false },
  elapsedMs: 0,
  sampleAgeMs: Number.POSITIVE_INFINITY,
  sampleCount: 0,
  sampleRateHz: 500,
  range: { min: 0, max: 0 },
  artifacts: 0,
};

const initialSettings = loadSettings();

export const useAppStore = create<AppState>((set, get) => ({
  mode: 'simulation',
  telemetry: INITIAL_TELEMETRY,
  settings: initialSettings,
  toasts: [],
  recording: false,
  sessionLabel: null,
  busy: false,

  setMode: async (mode) => {
    if (get().busy) return;
    set({ busy: true, mode });
    try {
      await ecgEngine.setSource(null);
      activeSource = null;

      if (mode === 'simulation') {
        const source = new SimulationDataSource(get().settings.sim);
        activeSource = source;
      } else {
        const source = new Esp32DataSource({ url: get().settings.bridgeUrl });
        activeSource = source;
      }

      await ecgEngine.setSource(activeSource);
      ecgEngine.setFilters(get().settings.filters);
      get().pushToast({
        tone: 'info',
        title: mode === 'simulation' ? 'Simulation mode active' : 'Connecting to hardware bridge',
        message:
          mode === 'simulation'
            ? 'All readings are synthetic. They are not measurements from a person.'
            : get().settings.bridgeUrl,
      });
    } catch (error) {
      get().pushToast({ tone: 'danger', title: 'Could not start source', message: String(error) });
    } finally {
      set({ busy: false });
    }
  },

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    persist(settings);
  },

  updateFilters: (patch) => {
    const filters = { ...get().settings.filters, ...patch };
    const settings = { ...get().settings, filters };
    set({ settings });
    persist(settings);
    ecgEngine.setFilters(filters);
  },

  updateSim: (patch) => {
    const sim = { ...get().settings.sim, ...patch };
    const settings = { ...get().settings, sim };
    set({ settings });
    persist(settings);
    if (activeSource instanceof SimulationDataSource) activeSource.configure(patch);
  },

  startSession: () => {
    if (get().recording) return;
    ecgEngine.startRecording();
    set({ recording: true, sessionLabel: new Date().toLocaleTimeString() });
    get().pushToast({ tone: 'success', title: 'Recording started', message: 'Samples are stored locally in this browser.' });
  },

  stopSession: async () => {
    if (!get().recording) return;
    set({ busy: true });
    try {
      const result = ecgEngine.stopRecording();
      set({ recording: false, sessionLabel: null });
      if (!result || result.sampleCount === 0) {
        get().pushToast({ tone: 'warning', title: 'Empty session discarded', message: 'No samples were captured.' });
        return;
      }

      const id = newSessionId();
      await saveSession(
        {
          id,
          startedAt: result.startedAt,
          endedAt: result.endedAt,
          durationMs: result.durationMs,
          source: result.sourceKind,
          deviceId: result.deviceId,
          sampleRateHz: result.sampleRateHz,
          sampleCount: result.sampleCount,
          avgBpm: result.avgBpm,
          minBpm: result.minBpm,
          maxBpm: result.maxBpm,
          sdnnMs: result.sdnnMs,
          rmssdMs: result.rmssdMs,
          nnCount: result.nnCount,
          meanQuality: result.meanQuality,
          minQuality: result.minQuality,
          notes: '',
          chunkCount: result.chunks.length,
        },
        result.chunks,
      );

      get().pushToast({
        tone: 'success',
        title: 'Session saved',
        message: `${result.sampleCount.toLocaleString()} samples stored locally.`,
      });
    } catch (error) {
      get().pushToast({
        tone: 'danger',
        title: 'Could not save session',
        message: `IndexedDB write failed: ${String(error)}`,
      });
    } finally {
      set({ busy: false });
    }
  },

  pushToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set({ toasts: [...get().toasts.slice(-3), { ...toast, id }] });
    setTimeout(() => get().dismissToast(id), 5000);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  reconnect: async () => {
    const mode = get().mode;
    await ecgEngine.setSource(null);
    activeSource = null;
    await get().setMode(mode);
  },
}));

// Telemetry is pushed from the engine at ~4 Hz; components subscribe to slices.
ecgEngine.subscribeTelemetry((snapshot) => {
  useAppStore.setState({ telemetry: snapshot });
});

export function getActiveSource(): DataSource | null {
  return activeSource;
}

// Development-only handle for inspecting live engine state from the browser
// console. Never shipped in a production bundle.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__cardiopulse = { engine: ecgEngine, store: useAppStore };
}
