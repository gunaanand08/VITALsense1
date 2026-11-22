#!/usr/bin/env node
/**
 * Cloud gateway: local bridge -> Supabase.
 *
 * The ESP32 firmware speaks the WebSocket protocol in docs/ESP32_COMMUNICATION_
 * PROTOCOL.md and cannot hold a Supabase secret, so this script sits where the
 * board already talks (the bridge on :8787) and forwards each validated batch
 * into Postgres. The hosted dashboard then reads it through Realtime and needs
 * no local server at all.
 *
 * Requires the secret key, which must never reach the browser:
 *   SUPABASE_URL=https://<ref>.supabase.co
 *   SUPABASE_SECRET_KEY=sb_secret_...        (or SUPABASE_SERVICE_ROLE_KEY)
 *
 * Usage:
 *   npm run gateway
 *   node scripts/cloud-gateway.mjs --url ws://127.0.0.1:8787/ws --device cardiopulse-esp32-01
 *
 * Reads .env from the working directory when present. Best effort by design:
 * this is an educational dashboard, not a recorder — if the network stalls the
 * queue drops its oldest rows and keeps going.
 */
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

const BATCH_TABLE = 'ecg_batches';
const DEVICE_TABLE = 'ecg_devices';
const MAX_QUEUE = 400;
const INSERT_CHUNK = 20;
const RECONNECT_MS = 5000;
const SUMMARY_MS = 10_000;

function loadEnvFile(path = '.env') {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      if (line.trimStart().startsWith('#')) continue;
      const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      const key = match[1];
      const value = match[2].replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // No .env file: rely on the shell environment.
  }
}

loadEnvFile();

const args = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
const SECRET = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BRIDGE_URL = argOf('--url', process.env.BRIDGE_URL ?? 'ws://127.0.0.1:8787/ws');
const DEVICE_FILTER = argOf('--device', '');

if (!SUPABASE_URL || !SECRET) {
  console.error('[gateway] Missing SUPABASE_URL and/or SUPABASE_SECRET_KEY.');
  console.error('[gateway] Add both to .env (see .env.example); the secret key must stay server-side.');
  process.exit(1);
}

const queue = [];
let flushing = false;
let forwarded = 0;
let dropped = 0;
let failures = 0;

async function post(table, rows, prefer) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SECRET,
      authorization: `Bearer ${SECRET}`,
      'content-type': 'application/json',
      prefer,
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${await response.text()}`);
}

async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length > 0) {
      const chunk = queue.splice(0, INSERT_CHUNK);
      try {
        await post(BATCH_TABLE, chunk, 'return=minimal');
        forwarded += chunk.length;
      } catch (error) {
        failures += 1;
        console.error(`[gateway] insert failed (${failures}): ${error.message}`);
        // On a schema/RLS error, resending every batch would just log forever.
        if (/HTTP 4\d\d/.test(error.message)) queue.length = 0;
      }
    }
  } finally {
    flushing = false;
  }
}

function enqueue(row) {
  queue.push(row);
  if (queue.length > MAX_QUEUE) {
    queue.shift();
    dropped += 1;
  }
  void flush();
}

async function upsertDevice(status) {
  try {
    await post(
      DEVICE_TABLE,
      [
        {
          device_id: status.device_id,
          firmware_version: status.firmware_version ?? null,
          sample_rate_hz: status.sample_rate_hz ?? null,
          last_seen_at: new Date().toISOString(),
        },
      ],
      'resolution=merge-duplicates,return=minimal',
    );
    console.log(`[gateway] device ${status.device_id} registered`);
  } catch (error) {
    console.error(`[gateway] device upsert failed: ${error.message}`);
  }
}

function connect() {
  const socket = new WebSocket(BRIDGE_URL);
  let announced = false;

  socket.on('open', () => {
    console.log(`[gateway] bridge connected ${BRIDGE_URL} -> ${SUPABASE_URL}`);
  });

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === 'device_status' && message.connected && message.device_id) {
      if (!announced) {
        announced = true;
        void upsertDevice(message);
      }
      return;
    }

    if (message.type !== 'ecg_batch') return;
    if (DEVICE_FILTER && message.device_id !== DEVICE_FILTER) return;

    enqueue({
      device_id: message.device_id,
      sequence: message.sequence,
      sample_rate_hz: message.sample_rate_hz,
      device_time_ms: message.timestamp_ms ?? 0,
      samples: message.samples,
      lead_off_positive: message.lead_off_positive === true,
      lead_off_negative: message.lead_off_negative === true,
    });
  });

  socket.on('error', (error) => console.error(`[gateway] bridge socket error: ${error.message}`));
  socket.on('close', () => {
    console.warn(`[gateway] bridge closed — retrying in ${RECONNECT_MS / 1000} s`);
    setTimeout(connect, RECONNECT_MS);
  });
}

const summary = setInterval(() => {
  console.log(
    `[gateway] forwarded=${forwarded} queued=${queue.length} dropped=${dropped} failures=${failures}`,
  );
}, SUMMARY_MS);
summary.unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    clearInterval(summary);
    console.log(`[gateway] stopping with ${queue.length} queued batch(es)`);
    await flush();
    process.exit(0);
  });
}

connect();
