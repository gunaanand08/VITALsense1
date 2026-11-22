import type { SupabaseClient } from '@supabase/supabase-js';
import type { SourceStatus } from '../types/ecg';
import type { BatchListener, DataSource, StatusListener } from '../types/source';
import { PROTOCOL_VERSION, parseBatchMessage } from '../types/protocol';

/** Table names are shared with `supabase/schema.sql` and `scripts/cloud-gateway.mjs`. */
export const ECG_BATCHES_TABLE = 'ecg_batches';
export const ECG_DEVICES_TABLE = 'ecg_devices';

export interface SupabaseEcgSourceOptions {
  client: SupabaseClient;
  /** Follow one device only; omit to follow whichever device published last. */
  deviceId?: string | null;
  /** Batches fetched on connect so the trace is not empty while it waits. */
  backlogLimit?: number;
  /** Silence after which the source reports `waiting` again. */
  staleAfterMs?: number;
  maxReconnectAttempts?: number;
}

interface BatchRow {
  id: number;
  device_id: string;
  sequence: number;
  sample_rate_hz: number;
  device_time_ms: number;
  samples: number[];
  lead_off_positive: boolean;
  lead_off_negative: boolean;
}

interface DeviceRow {
  device_id: string;
  firmware_version: string | null;
}

/** 40 batches ≈ 20 s of trace at 500 Hz — enough to draw a full window. */
const BACKLOG_DEFAULT = 40;
const STALE_AFTER_MS = 3500;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const WATCHDOG_INTERVAL_MS = 1000;

const BATCH_COLUMNS =
  'id,device_id,sequence,sample_rate_hz,device_time_ms,samples,lead_off_positive,lead_off_negative';

/**
 * Hardware source backed by Supabase instead of the local bridge.
 *
 * Rows arrive through Realtime, are normalised through the same
 * `parseBatchMessage` validator the bridge uses, and are emitted as ordinary
 * `EcgBatch`es, so the engine cannot tell a cloud batch from a local one.
 *
 * A device that stops publishing leaves the channel quiet rather than broken:
 * the watchdog drops back to `waiting` and the UI keeps its last trace. That is
 * the fallback state — nothing pretends samples are still arriving.
 */
export class SupabaseEcgDataSource implements DataSource {
  readonly kind = 'hardware' as const;

  private client: SupabaseClient;
  private deviceId: string | null;
  private backlogLimit: number;
  private staleAfterMs: number;
  private maxAttempts: number;

  private channel: ReturnType<SupabaseClient['channel']> | null = null;
  private batchListeners = new Set<BatchListener>();
  private statusListeners = new Set<StatusListener>();
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualStop = false;
  private lastRowId = 0;
  private lastSeq: number | null = null;

  private status: SourceStatus;

  constructor(options: SupabaseEcgSourceOptions) {
    this.client = options.client;
    this.deviceId = options.deviceId ?? null;
    this.backlogLimit = options.backlogLimit ?? BACKLOG_DEFAULT;
    this.staleAfterMs = options.staleAfterMs ?? STALE_AFTER_MS;
    this.maxAttempts = options.maxReconnectAttempts ?? 5;
    this.status = {
      kind: 'hardware',
      state: 'disconnected',
      deviceId: null,
      label: 'Supabase cloud',
      sampleRateHz: 0,
      lastPacketAtMs: null,
      stats: { batches: 0, samples: 0, gaps: 0, outOfOrder: 0, lastBatchAtMs: null, lastSequence: null },
      error: null,
      reconnectAttempts: 0,
    };
  }

  getStatus(): SourceStatus {
    return this.status;
  }

  async start(): Promise<void> {
    this.manualStop = false;
    this.patchStatus({ state: 'connecting', error: null });
    this.startWatchdog();
    await this.hydrate();
    this.openChannel();
  }

  stop(): void {
    this.manualStop = true;
    this.clearReconnectTimer();
    this.stopWatchdog();
    this.closeChannel();
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

  // ------------------------------------------------------------------ fetching

  private async hydrate(): Promise<void> {
    const query = this.client
      .from(ECG_BATCHES_TABLE)
      .select(BATCH_COLUMNS)
      .order('id', { ascending: false })
      .limit(this.backlogLimit);
    const { data, error } = await (this.deviceId ? query.eq('device_id', this.deviceId) : query);

    if (error) {
      this.patchStatus({ state: 'error', error: `Supabase read failed: ${error.message}` });
      return;
    }

    const rows = (data ?? []) as BatchRow[];
    // Newest first from the query, oldest first into the engine so the ring
    // buffer keeps real order.
    for (const row of rows.reverse()) this.ingestRow(row);

    const device = await this.loadDevice();
    if (device) this.patchStatus({ label: `Supabase · ${device.device_id}` });
    if (this.status.state === 'connecting') {
      this.patchStatus({
        state: this.status.stats.batches > 0 ? 'streaming' : 'waiting',
        error: this.status.stats.batches > 0 ? null : 'Listening for device batches',
      });
    }
  }

  private async loadDevice(): Promise<DeviceRow | null> {
    const query = this.client.from(ECG_DEVICES_TABLE).select('device_id,firmware_version');
    const scoped = this.deviceId ? query.eq('device_id', this.deviceId) : query;
    const { data } = await scoped.order('last_seen_at', { ascending: false }).limit(1);
    const rows = (data ?? []) as DeviceRow[];
    return rows[0] ?? null;
  }

  // ----------------------------------------------------------------- realtime

  private openChannel(): void {
    this.closeChannel();

    const channel = this.client
      .channel(`ecg-batches-${this.deviceId ?? 'any'}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: ECG_BATCHES_TABLE,
          ...(this.deviceId ? { filter: `device_id=eq.${this.deviceId}` } : {}),
        },
        (payload) => this.ingestRow(payload.new as unknown as BatchRow),
      )
      .subscribe((channelStatus, error) => {
        if (this.manualStop) return;
        // String(): the SDK exports this state as an enum, so comparing the
        // value directly against a literal does not typecheck.
        const state = String(channelStatus);

        if (state === 'SUBSCRIBED') {
          this.patchStatus({
            state: this.status.stats.batches > 0 ? 'streaming' : 'waiting',
            error: this.status.stats.batches > 0 ? null : 'Listening for device batches',
            reconnectAttempts: 0,
          });
          return;
        }

        if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
          this.patchStatus({
            state: 'error',
            error: `Realtime ${state.toLowerCase().replace('_', ' ')}${error?.message ? `: ${error.message}` : ''}`,
          });
          this.scheduleReconnect();
        }
      });

    this.channel = channel;
  }

  private closeChannel(): void {
    if (!this.channel) return;
    void this.client.removeChannel(this.channel);
    this.channel = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.manualStop) return;

    const attempts = this.status.reconnectAttempts + 1;
    if (attempts > this.maxAttempts) {
      this.patchStatus({
        state: 'error',
        reconnectAttempts: attempts,
        error: `Gave up on Realtime after ${this.maxAttempts} attempts. Check the project URL, the key and the table's publication, then reconnect.`,
      });
      return;
    }

    // Exponential backoff with jitter: five clients reloading the page after an
    // outage must not resubscribe in lockstep.
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1));
    const jittered = Math.round(delay * (0.8 + Math.random() * 0.4));
    this.patchStatus({
      state: 'connecting',
      reconnectAttempts: attempts,
      error: `Realtime reconnecting (attempt ${attempts}/${this.maxAttempts}) in ${jittered} ms`,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manualStop) this.openChannel();
    }, jittered);
  }

  // ------------------------------------------------------------------- ingest

  private ingestRow(row: BatchRow): void {
    // Backlog and Realtime overlap on reconnect, and a duplicate batch would
    // double-count samples. `id` is monotonic, so it is the cheapest guard.
    if (typeof row?.id === 'number') {
      if (row.id <= this.lastRowId) return;
      this.lastRowId = row.id;
    }

    const now = performance.now();
    const batch = parseBatchMessage(
      {
        type: 'ecg_batch',
        protocol_version: PROTOCOL_VERSION,
        device_id: row.device_id,
        sequence: Number(row.sequence),
        sample_rate_hz: Number(row.sample_rate_hz),
        timestamp_ms: Number(row.device_time_ms),
        samples: row.samples,
        lead_off_positive: row.lead_off_positive === true,
        lead_off_negative: row.lead_off_negative === true,
      },
      now,
    );

    if (!batch) {
      this.patchStatus({ error: 'Rejected an invalid batch from Supabase' });
      return;
    }

    // A device restart resets `sequence`, so a lower number is a new connection
    // rather than a late packet. Dropping it (what the bridge does, safe there
    // because its socket also reconnects) would silence the source until the
    // counter passed the old high-water mark.
    const stats = { ...this.status.stats };
    if (this.lastSeq !== null && batch.seq > this.lastSeq + 1) {
      stats.gaps += batch.seq - this.lastSeq - 1;
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

  // ------------------------------------------------------------------ plumbing

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdog = setInterval(() => {
      if (this.status.state !== 'streaming' || this.status.lastPacketAtMs === null) return;
      if (performance.now() - this.status.lastPacketAtMs < this.staleAfterMs) return;
      this.patchStatus({
        state: 'waiting',
        error: `No batches for ${Math.round(this.staleAfterMs / 1000)} s — the device may be offline`,
      });
    }, WATCHDOG_INTERVAL_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private patchStatus(patch: Partial<SourceStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.statusListeners) listener(this.status);
  }
}
