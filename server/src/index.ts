import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { Bonjour } from 'bonjour-service';
import type { WebSocket } from 'ws';
import WebSocketClient from 'ws';
import {
  PROTOCOL_VERSION,
  isHelloMessage,
  parseBatchMessage,
  type DeviceHelloMessage,
  type DeviceStatusMessage,
} from '../../src/types/protocol';

// An empty or non-numeric PORT in the environment must not become port 0.
const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);
const PORT = Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort < 65536 ? parsedPort : 8787;
const HOST = process.env.HOST || '0.0.0.0';
const BRIDGE_VERSION = '1.0.0';

interface DeviceEntry {
  id: string;
  socket: WebSocket | null;
  info: Partial<DeviceHelloMessage>;
  stats: { batches: number; samples: number; gaps: number; outOfOrder: number };
  lastPacketAt: number | null;
  lastSeq: number | null;
  transport: 'inbound' | 'outbound';
}

const devices = new Map<string, DeviceEntry>();
const browsers = new Set<WebSocket>();

function log(...args: unknown[]): void {
  console.log('[bridge]', ...args);
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

function statusMessage(entry: DeviceEntry | null): DeviceStatusMessage {
  if (!entry) {
    return { type: 'device_status', connected: false, device_id: null, reason: 'No device connected to the bridge' };
  }
  return {
    type: 'device_status',
    connected: entry.transport === 'inbound' || entry.socket !== null,
    device_id: entry.id,
    firmware_version: entry.info.firmware_version ?? null,
    sample_rate_hz: entry.info.sample_rate_hz ?? null,
    last_packet_at: entry.lastPacketAt,
    stats: {
      batches: entry.stats.batches,
      samples: entry.stats.samples,
      gaps: entry.stats.gaps,
      out_of_order: entry.stats.outOfOrder,
    },
  };
}

function broadcast(payload: unknown): void {
  for (const socket of browsers) send(socket, payload);
}

function activeDevice(): DeviceEntry | null {
  // Newest streaming device wins; the UI only ever views one device at a time.
  let best: DeviceEntry | null = null;
  for (const entry of devices.values()) {
    if (!best || (entry.lastPacketAt ?? 0) > (best.lastPacketAt ?? 0)) best = entry;
  }
  return best;
}

const app = Fastify({ logger: false });

await app.register(websocket, {
  options: { maxPayload: 1_000_000 },
});

// Permissive CORS: the bridge is a localhost-only helper, and the production
// preview runs on a different port than the API.
app.addHook('onRequest', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Headers', 'content-type');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (request.method === 'OPTIONS') reply.code(204).send();
});

app.get('/health', async () => ({
  ok: true,
  bridge_version: BRIDGE_VERSION,
  protocol_version: PROTOCOL_VERSION,
  uptime_s: Math.round(process.uptime()),
  connected_devices: devices.size,
  browsers: browsers.size,
  devices: [...devices.values()].map((entry) => ({
    deviceId: entry.id,
    firmware: entry.info.firmware_version ?? null,
    sampleRateHz: entry.info.sample_rate_hz ?? null,
    lastSeenMs: entry.lastPacketAt,
    transport: entry.transport,
  })),
}));

app.get('/api/devices', async () => {
  const connected = [...devices.values()].map((entry) => ({
    deviceId: entry.id,
    firmware: entry.info.firmware_version ?? null,
    sampleRateHz: entry.info.sample_rate_hz ?? null,
    lastSeenMs: entry.lastPacketAt,
    source: 'ws-connected',
  }));

  const advertised = await browseMdns();
  return { devices: [...connected, ...advertised], protocol_version: PROTOCOL_VERSION };
});

app.post('/api/bridge', async (request, reply) => {
  const body = request.body as { url?: string } | undefined;
  if (!body?.url || !/^wss?:\/\//.test(body.url)) {
    reply.code(400);
    return { error: 'Body must contain { url: "ws://device-host:port/..." }' };
  }
  try {
    connectOutbound(body.url);
    return { ok: true, message: `Bridging ${body.url}` };
  } catch (error) {
    reply.code(502);
    return { error: String(error) };
  }
});

/** WebSocket handler helper: @fastify/websocket 11 passes the socket directly. */
function socketOf(arg: unknown): WebSocket {
  const maybe = arg as { socket?: WebSocket };
  return (maybe.socket ?? (arg as WebSocket)) as WebSocket;
}

// ---------------------------------------------------------------------------
// Browser channel
// ---------------------------------------------------------------------------
app.get('/ws', { websocket: true }, (connection) => {
  const socket = socketOf(connection);
  browsers.add(socket);
  log(`browser connected (${browsers.size} total)`);

  send(socket, {
    type: 'bridge_hello',
    protocol_version: PROTOCOL_VERSION,
    server_time_ms: Date.now(),
    bridge_version: BRIDGE_VERSION,
  });
  send(socket, statusMessage(activeDevice()));

  socket.on('message', (raw: Buffer) => {
    try {
      const parsed = JSON.parse(raw.toString()) as { type?: string; t?: number };
      if (parsed.type === 'ping') send(socket, { type: 'pong', t: parsed.t ?? Date.now() });
    } catch {
      // Ignore malformed browser frames.
    }
  });

  socket.on('close', () => {
    browsers.delete(socket);
    log(`browser disconnected (${browsers.size} total)`);
  });
});

// ---------------------------------------------------------------------------
// Device channel (ESP32 is the WebSocket client)
// ---------------------------------------------------------------------------
app.get('/ws/device', { websocket: true }, (connection, request) => {
  const socket = socketOf(connection);
  const remote = request.socket.remoteAddress ?? 'unknown';
  let entry: DeviceEntry | null = null;
  log(`device socket opened from ${remote}`);

  socket.on('message', (raw: Buffer) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: 'error', message: 'Malformed JSON' });
      return;
    }

    if (isHelloMessage(parsed)) {
      const hello = parsed;
      entry = {
        id: hello.device_id,
        socket,
        info: hello,
        stats: entry?.stats ?? { batches: 0, samples: 0, gaps: 0, outOfOrder: 0 },
        lastPacketAt: entry?.lastPacketAt ?? null,
        lastSeq: entry?.lastSeq ?? null,
        transport: 'inbound',
      };
      devices.set(hello.device_id, entry);
      send(socket, { type: 'hello_ack', protocol_version: PROTOCOL_VERSION });
      broadcast(statusMessage(entry));
      log(`hello from ${hello.device_id} fw=${hello.firmware_version} fs=${hello.sample_rate_hz}`);
      return;
    }

    const now = Date.now();
    const batch = parseBatchMessage(parsed, now);
    if (!batch) {
      send(socket, { type: 'error', message: 'Rejected batch: failed validation' });
      return;
    }

    if (!entry) {
      // Batch before hello: accept but label with the payload's device id.
      entry = {
        id: batch.deviceId,
        socket,
        info: { sample_rate_hz: batch.sampleRateHz },
        stats: { batches: 0, samples: 0, gaps: 0, outOfOrder: 0 },
        lastPacketAt: null,
        lastSeq: null,
        transport: 'inbound',
      };
      devices.set(batch.deviceId, entry);
    }

    if (entry.lastSeq !== null && batch.seq > entry.lastSeq + 1) {
      entry.stats.gaps += batch.seq - entry.lastSeq - 1;
    }
    if (entry.lastSeq !== null && batch.seq <= entry.lastSeq) {
      entry.stats.outOfOrder += 1;
      return;
    }
    entry.lastSeq = batch.seq;
    entry.stats.batches += 1;
    entry.stats.samples += batch.samples.length;
    entry.lastPacketAt = now;

    if ((parsed as { type?: string }).type === 'ecg_batch') {
      broadcast({ ...(parsed as object), received_at_ms: now });
      if (entry.stats.batches % 100 === 0) broadcast(statusMessage(entry));
    }
  });

  socket.on('close', () => {
    if (entry) {
      devices.delete(entry.id);
      broadcast({ type: 'device_status', connected: false, device_id: entry.id, reason: 'Device disconnected' });
      log(`device ${entry.id} disconnected`);
    }
  });
});

// ---------------------------------------------------------------------------
// Outbound bridge: device runs its own WebSocket server
// ---------------------------------------------------------------------------
function connectOutbound(url: string): void {
  const client = new WebSocketClient(url);
  let id = `outbound-${Date.now().toString(36)}`;

  client.on('open', () => {
    log(`outbound connected to ${url}`);
    client.send(JSON.stringify({ type: 'hello', protocol_version: PROTOCOL_VERSION, client: 'cardiopulse-bridge' }));
  });

  client.on('message', (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (isHelloMessage(parsed)) {
      id = parsed.device_id;
      devices.set(id, {
        id,
        socket: null,
        info: parsed,
        stats: { batches: 0, samples: 0, gaps: 0, outOfOrder: 0 },
        lastPacketAt: null,
        lastSeq: null,
        transport: 'outbound',
      });
      broadcast(statusMessage(devices.get(id) ?? null));
      return;
    }
    const now = Date.now();
    const batch = parseBatchMessage(parsed, now);
    const entry = devices.get(id);
    if (!batch || !entry) return;
    entry.stats.batches += 1;
    entry.stats.samples += batch.samples.length;
    entry.lastPacketAt = now;
    broadcast({ ...(parsed as object), received_at_ms: now });
  });

  client.on('close', () => {
    const entry = devices.get(id);
    if (entry) {
      devices.delete(id);
      broadcast({ type: 'device_status', connected: false, device_id: id, reason: 'Outbound link closed' });
    }
  });

  client.on('error', (error) => log(`outbound error: ${String(error)}`));
}

// ---------------------------------------------------------------------------
// mDNS discovery (best effort; firmware may not advertise)
// ---------------------------------------------------------------------------
function browseMdns(timeoutMs = 2500): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve) => {
    const results: Array<Record<string, unknown>> = [];
    let bonjour: Bonjour | null = null;
    try {
      bonjour = new Bonjour();
      const browser = bonjour.find({ type: 'cardiopulse' });
      browser.on('up', (service) => {
        results.push({
          deviceId: service.name,
          ip: service.addresses?.find((address) => !address.includes(':')) ?? service.host,
          port: service.port,
          source: 'mdns',
        });
      });
      setTimeout(() => {
        try {
          browser.stop();
          bonjour?.destroy();
        } catch {
          // Already stopped.
        }
        resolve(results);
      }, timeoutMs);
    } catch (error) {
      log(`mDNS unavailable: ${String(error)}`);
      bonjour?.destroy();
      resolve([]);
    }
  });
}

await app.listen({ port: PORT, host: HOST });
log(`listening on http://${HOST}:${PORT} (ws://localhost:${PORT}/ws, device endpoint /ws/device)`);
log(`protocol v${PROTOCOL_VERSION} · bridge ${BRIDGE_VERSION}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log('shutting down');
    void app.close().then(() => process.exit(0));
  });
}
