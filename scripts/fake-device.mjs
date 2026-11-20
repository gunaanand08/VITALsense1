#!/usr/bin/env node
/**
 * Scripted ESP32 stand-in.
 *
 * Speaks the documented protocol to ws://127.0.0.1:8787/ws/device so the whole
 * hardware path can be exercised without a board. It is honest about being a
 * simulator: the device id is prefixed `fake-`.
 *
 *   node scripts/fake-device.mjs [--url ws://127.0.0.1:8787/ws/device] [--rate 500] [--bpm 70] [--seconds 30]
 */
import WebSocket from 'ws';

const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const URL = argOf('--url', process.env.BRIDGE_URL ?? 'ws://127.0.0.1:8787/ws/device');
const RATE = Number(argOf('--rate', '500'));
const BPM = Number(argOf('--bpm', '70'));
const SECONDS = Number(argOf('--seconds', '30'));
const BATCH = 25;
const PROTOCOL_VERSION = 1;
const DEVICE_ID = 'fake-esp32-01';

let sequence = 0;
let sampleIndex = 0;
let sent = 0;
let stopped = false;

const socket = new WebSocket(URL);
const startedAt = Date.now();

const clamp = (v) => Math.max(0, Math.min(4095, Math.round(v)));

function sampleAt(index) {
  const t = index / RATE;
  const period = 60 / BPM;
  const phase = (t % period) / period;
  // Crude but deterministic P-QRS-T shape: enough for the detector to lock on.
  const r = Math.exp(-Math.pow((phase - 0.18) / 0.012, 2)) * 1100;
  const q = -Math.exp(-Math.pow((phase - 0.165) / 0.008, 2)) * 130;
  const s = -Math.exp(-Math.pow((phase - 0.2) / 0.012, 2)) * 320;
  const p = Math.exp(-Math.pow((phase - 0.06) / 0.03, 2)) * 130;
  const tw = Math.exp(-Math.pow((phase - 0.45) / 0.06, 2)) * 340;
  const wander = Math.sin(2 * Math.PI * 0.22 * t) * 120;
  const noise = (Math.random() - 0.5) * 26;
  return clamp(2048 + r + q + s + p + tw + wander + noise);
}

socket.on('open', () => {
  console.log(`[fake-device] connected to ${URL}`);
  socket.send(
    JSON.stringify({
      type: 'hello',
      protocol_version: PROTOCOL_VERSION,
      device_id: DEVICE_ID,
      firmware_version: 'fake-1.0.0',
      sample_rate_hz: RATE,
      batch_size: BATCH,
      adc_bits: 12,
      adc_pin: 34,
    }),
  );

  const batchIntervalMs = (BATCH / RATE) * 1000;
  const timer = setInterval(() => {
    if (stopped) return;
    if (Date.now() - startedAt > SECONDS * 1000) {
      console.log(`[fake-device] sent ${sent} batches (${sampleIndex} samples) — done`);
      stopped = true;
      clearInterval(timer);
      socket.close();
      return;
    }
    const samples = [];
    for (let i = 0; i < BATCH; i += 1) samples.push(sampleAt(sampleIndex + i));
    const timestamp = (sampleIndex / RATE) * 1000;
    sampleIndex += BATCH;
    sequence += 1;
    socket.send(
      JSON.stringify({
        type: 'ecg_batch',
        protocol_version: PROTOCOL_VERSION,
        device_id: DEVICE_ID,
        sequence,
        sample_rate_hz: RATE,
        timestamp_ms: Math.round(timestamp),
        samples,
        lead_off_positive: false,
        lead_off_negative: false,
      }),
    );
    sent += 1;
  }, batchIntervalMs);
});

socket.on('message', (raw) => {
  try {
    const message = JSON.parse(raw.toString());
    if (message.type === 'hello_ack') console.log(`[fake-device] bridge ack, protocol v${message.protocol_version}`);
    if (message.type === 'error') console.error(`[fake-device] bridge error: ${message.message}`);
  } catch {
    // Ignore.
  }
});

socket.on('error', (error) => console.error(`[fake-device] socket error: ${error.message}`));
socket.on('close', () => {
  stopped = true;
  console.log('[fake-device] closed');
  process.exit(0);
});
