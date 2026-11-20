import type { EcgBatch } from './ecg';

export const PROTOCOL_VERSION = 1;

export const MAX_BATCH_SAMPLES = 512;
export const MIN_SAMPLE_RATE_HZ = 100;
export const MAX_SAMPLE_RATE_HZ = 2000;

/** device -> bridge */
export interface DeviceHelloMessage {
  type: 'hello';
  protocol_version: number;
  device_id: string;
  firmware_version: string;
  sample_rate_hz: number;
  batch_size: number;
  adc_bits: number;
  adc_pin: number;
}

export interface EcgBatchMessage {
  type: 'ecg_batch';
  protocol_version: number;
  device_id: string;
  sequence: number;
  sample_rate_hz: number;
  timestamp_ms: number;
  samples: number[];
  lead_off_positive: boolean;
  lead_off_negative: boolean;
}

export interface DevicePongMessage {
  type: 'pong';
  t?: number;
}

/** bridge -> browser */
export interface BridgeHelloMessage {
  type: 'bridge_hello';
  protocol_version: number;
  server_time_ms: number;
  bridge_version: string;
}

export interface DeviceStatusMessage {
  type: 'device_status';
  connected: boolean;
  device_id: string | null;
  firmware_version?: string | null;
  sample_rate_hz?: number | null;
  last_packet_at?: number | null;
  reason?: string;
  stats?: {
    batches: number;
    samples: number;
    gaps: number;
    out_of_order: number;
  };
}

export interface BridgeError {
  type: 'error';
  message: string;
}

export type BrowserInbound =
  | BridgeHelloMessage
  | DeviceStatusMessage
  | (EcgBatchMessage & { received_at_ms?: number })
  | BridgeError;

export type DeviceInbound = { type: 'hello_ack'; protocol_version: number } | DeviceStatusMessage | BridgeError;

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate an untrusted wire payload and normalise it into an EcgBatch.
 * Returns null (never throws) so a malformed device cannot crash the bridge or
 * the browser; callers count the rejection instead.
 */
export function parseBatchMessage(raw: unknown, receivedAtMs: number): EcgBatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as Partial<EcgBatchMessage>;
  if (msg.type !== 'ecg_batch') return null;
  if (!Array.isArray(msg.samples) || msg.samples.length === 0 || msg.samples.length > MAX_BATCH_SAMPLES) {
    return null;
  }
  if (!isFiniteNumber(msg.sample_rate_hz) || msg.sample_rate_hz < MIN_SAMPLE_RATE_HZ || msg.sample_rate_hz > MAX_SAMPLE_RATE_HZ) {
    return null;
  }
  if (!isFiniteNumber(msg.sequence) || msg.sequence < 0) return null;
  if (typeof msg.device_id !== 'string' || msg.device_id.length === 0 || msg.device_id.length > 64) return null;

  const samples = new Int16Array(msg.samples.length);
  for (let i = 0; i < msg.samples.length; i += 1) {
    const v = msg.samples[i];
    if (!isFiniteNumber(v)) return null;
    samples[i] = Math.max(0, Math.min(4095, Math.round(v)));
  }

  return {
    deviceId: msg.device_id,
    seq: Math.floor(msg.sequence),
    sampleRateHz: Math.round(msg.sample_rate_hz),
    deviceTimeMs: isFiniteNumber(msg.timestamp_ms) ? msg.timestamp_ms : 0,
    samples,
    leadOffPos: msg.lead_off_positive === true,
    leadOffNeg: msg.lead_off_negative === true,
    receivedAtMs,
    sourceKind: 'hardware',
  };
}

export function isHelloMessage(raw: unknown): raw is DeviceHelloMessage {
  if (!raw || typeof raw !== 'object') return false;
  const m = raw as Partial<DeviceHelloMessage>;
  return (
    m.type === 'hello' &&
    typeof m.device_id === 'string' &&
    m.device_id.length > 0 &&
    isFiniteNumber(m.sample_rate_hz) &&
    (m.sample_rate_hz as number) >= MIN_SAMPLE_RATE_HZ &&
    (m.sample_rate_hz as number) <= MAX_SAMPLE_RATE_HZ
  );
}
