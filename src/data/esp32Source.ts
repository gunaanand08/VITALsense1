import type { SourceStatus } from '../types/ecg';
import type { BatchListener, DataSource, StatusListener } from '../types/source';
import { parseBatchMessage, type BrowserInbound, type DeviceStatusMessage } from '../types/protocol';

export interface Esp32SourceOptions {
  /** ws:// URL of the bridge's browser endpoint, e.g. ws://127.0.0.1:8787/ws */
  url: string;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
}

const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 8000;

/**
 * Hardware source. Connects to the local bridge, which relays device batches.
 *
 * Reconnection is bounded (max attempts, exponential backoff with jitter) so a
 * missing device can never spin the browser into an uncontrolled loop.
 */
export class Esp32DataSource implements DataSource {
  readonly kind = 'hardware' as const;

  private url: string;
  private maxAttempts: number;
  private heartbeatMs: number;

  private socket: WebSocket | null = null;
  private batchListeners = new Set<BatchListener>();
  private statusListeners = new Set<StatusListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private manualStop = false;
  private lastSeq: number | null = null;
  private lastDeviceId: string | null = null;

  private status: SourceStatus;

  constructor(options: Esp32SourceOptions) {
    this.url = options.url;
    this.maxAttempts = options.maxReconnectAttempts ?? 10;
    this.heartbeatMs = options.heartbeatIntervalMs ?? 5000;
    this.status = {
      kind: 'hardware',
      state: 'disconnected',
      deviceId: null,
      label: 'ESP32 bridge',
      sampleRateHz: 0,
      lastPacketAtMs: null,
      stats: { batches: 0, samples: 0, gaps: 0, outOfOrder: 0, lastBatchAtMs: null, lastSequence: null },
      error: null,
      reconnectAttempts: 0,
    };
  }

  setUrl(url: string): void {
    this.url = url;
  }

  getStatus(): SourceStatus {
    return this.status;
  }

  async start(): Promise<void> {
    this.manualStop = false;
    this.openSocket();
  }

  stop(): void {
    this.manualStop = true;
    this.clearTimers();
    this.closeSocket();
    this.patchStatus({ state: 'disconnected', reconnectAttempts: 0 });
  }

  subscribeBatches(listener: BatchListener): () => void {
    this.batchListeners.add(listener);
    return () => this.batchListeners.delete(listener);
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private openSocket(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.patchStatus({ state: 'connecting', error: null });

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (error) {
      this.patchStatus({ state: 'error', error: `Invalid endpoint: ${String(error)}` });
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.patchStatus({ state: 'waiting', error: null, reconnectAttempts: 0 });
      this.startHeartbeat();
    };

    socket.onmessage = (event) => this.handleMessage(event.data);

    socket.onerror = () => {
      // The close handler performs the retry; a message here would be misleading.
      this.patchStatus({ error: 'Connection error — is the local bridge running?' });
    };

    socket.onclose = () => {
      this.stopHeartbeat();
      this.socket = null;
      if (this.manualStop) return;
      this.scheduleReconnect();
    };
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    const message = parsed as BrowserInbound;
    if (!message || typeof message !== 'object') return;

    if (message.type === 'device_status') {
      this.applyDeviceStatus(message);
      return;
    }

    if (message.type === 'error') {
      this.patchStatus({ error: message.message, state: 'error' });
      return;
    }

    if (message.type === 'ecg_batch') {
      const now = performance.now();
      const batch = parseBatchMessage(message, now);
      if (!batch) return;
      this.lastDeviceId = batch.deviceId;

      // Sequence integrity: gap = missing batches, out-of-order = duplicates/late.
      const stats = { ...this.status.stats };
      if (this.lastSeq !== null) {
        if (batch.seq > this.lastSeq + 1) stats.gaps += batch.seq - this.lastSeq - 1;
        else if (batch.seq <= this.lastSeq) {
          stats.outOfOrder += 1;
          return;
        }
      }
      this.lastSeq = batch.seq;

      this.patchStatus({
        state: 'streaming',
        deviceId: batch.deviceId,
        sampleRateHz: batch.sampleRateHz,
        lastPacketAtMs: now,
        error: null,
        stats: {
          ...stats,
          batches: stats.batches + 1,
          samples: stats.samples + batch.samples.length,
          lastBatchAtMs: now,
          lastSequence: batch.seq,
        },
      });

      for (const listener of this.batchListeners) listener(batch);
    }
  }

  private applyDeviceStatus(message: DeviceStatusMessage): void {
    this.patchStatus({
      state: message.connected ? (this.status.stats.batches > 0 ? 'streaming' : 'waiting') : 'waiting',
      deviceId: message.device_id ?? this.lastDeviceId,
      sampleRateHz: message.sample_rate_hz ?? this.status.sampleRateHz,
      lastPacketAtMs: message.last_packet_at ?? this.status.lastPacketAtMs,
      error: message.connected ? null : (message.reason ?? 'No device connected to the bridge'),
    });
  }

  private scheduleReconnect(): void {
    const attempts = this.status.reconnectAttempts + 1;
    if (attempts > this.maxAttempts) {
      this.patchStatus({
        state: 'error',
        reconnectAttempts: attempts,
        error: `Gave up after ${this.maxAttempts} attempts. Check the bridge and endpoint, then reconnect manually.`,
      });
      return;
    }

    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1));
    const jittered = delay * (0.8 + Math.random() * 0.4);
    this.patchStatus({
      state: 'connecting',
      reconnectAttempts: attempts,
      error: `Reconnecting (attempt ${attempts}/${this.maxAttempts}) in ${Math.round(jittered)} ms`,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manualStop) this.openSocket();
    }, jittered);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'ping', t: Date.now() }));
      }
    }, this.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
  }

  private closeSocket(): void {
    if (!this.socket) return;
    this.socket.onclose = null;
    this.socket.onerror = null;
    this.socket.onmessage = null;
    try {
      this.socket.close();
    } catch {
      // Already closing.
    }
    this.socket = null;
    this.lastSeq = null;
  }

  private patchStatus(patch: Partial<SourceStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.statusListeners) listener(this.status);
  }
}
