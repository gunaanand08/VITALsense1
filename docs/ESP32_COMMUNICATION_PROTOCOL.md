# ESP32 COMMUNICATION PROTOCOL — CARDIOPULSE v1

Version: **1** (`PROTOCOL_VERSION` in `src/types/protocol.ts`, mirrored in firmware `config.h`).
Transport: **WebSocket**, UTF-8 JSON text frames. No binary protocol in v1 — frames are inspectable and
small (~300 bytes for 25 samples).

## 1. Topology

```
ESP32 (WS client) ──▶ ws://<bridge>:8787/ws/device ──▶ bridge ──▶ ws://<bridge>:8787/ws ──▶ browser
```

The device initiates the connection so it can sit behind NAT and reconnect independently of the UI.
The bridge also supports the inverse case (`POST /api/bridge {url}`) when a device runs its own
server, in which case the bridge acts as the WebSocket client.

## 2. Frames

### 2.1 `hello` (device → bridge, once after connect)

```json
{
  "type": "hello",
  "protocol_version": 1,
  "device_id": "cardiopulse-esp32-01",
  "firmware_version": "1.0.0",
  "sample_rate_hz": 500,
  "batch_size": 25,
  "adc_bits": 12,
  "adc_pin": 34
}
```

`sample_rate_hz` is the *measured/reported* acquisition rate. Nothing downstream assumes 500 Hz.
Bridge replies `{"type":"hello_ack","protocol_version":1}`.

### 2.2 `ecg_batch` (device → bridge → browser)

```json
{
  "type": "ecg_batch",
  "protocol_version": 1,
  "device_id": "cardiopulse-esp32-01",
  "sequence": 125,
  "sample_rate_hz": 500,
  "timestamp_ms": 6250,
  "lead_off_positive": false,
  "lead_off_negative": false,
  "samples": [2048, 2050, 2058, 2071]
}
```

| Field | Type | Rules |
| --- | --- | --- |
| `sequence` | integer ≥ 0 | +1 per frame; gaps are data loss |
| `sample_rate_hz` | 100–2000 | validated, else frame rejected |
| `timestamp_ms` | integer | device clock at the **first** sample of the batch |
| `samples` | 1–512 integers | 12-bit ADC counts; clamped to 0–4095 on ingest |
| `lead_off_*` | boolean | AD8232 LO+/LO− state at transmission time |

The bridge adds `received_at_ms` (bridge clock) before broadcasting. Device time and receive time are
never mixed: the difference is transport latency, the device clock is the signal clock.

### 2.3 `device_status` (bridge → browser)

Sent on browser connect, on device connect/disconnect, and every 100 batches:

```json
{ "type": "device_status", "connected": true, "device_id": "cardiopulse-esp32-01",
  "firmware_version": "1.0.0", "sample_rate_hz": 500, "last_packet_at": 1730000000000,
  "stats": { "batches": 1200, "samples": 30000, "gaps": 0, "out_of_order": 0 } }
```

### 2.4 `error` (bridge → device or browser)

`{"type":"error","message":"..."}` — malformed JSON, failed validation, or an unsupported action.
Errors never close the socket; the peer decides whether to retry.

### 2.5 `ping` / `pong`

Browser sends `{"type":"ping","t":<epoch ms>}` every 5 s; the bridge replies `{"type":"pong","t":...}`.
The firmware uses the WebSocket-level heartbeat from arduinoWebSockets instead (15 s / 3 s / 2 tries).

## 3. Ordering, gaps and duplicates

- The device increments `sequence` monotonically per connection; it resets to 0 on reconnect.
- Browser and bridge both track the last sequence:
  - `seq > last + 1` → `gaps += seq - last - 1`
  - `seq <= last` → `outOfOrder += 1`, frame dropped (never appended twice)
- Gap counts are shown in Device Settings and lower the quality score; samples are never
  interpolated or back-filled.
- A reconnect starts a new engine buffer epoch, so timestamps do not have to remain comparable across
  sessions.

## 4. Reconnection

| Side | Policy |
| --- | --- |
| Firmware | `setReconnectInterval(2000)` — retries forever, sampling continues, transmission resumes when the link returns |
| Browser | exponential backoff 500 ms → 8 s with ±20 % jitter, **max 10 attempts**, then `error` state with a manual Reconnect button |
| Bridge | no retry; it is the server. Devices re-register on reconnect |

No uncontrolled reconnect loops: the browser stops after the attempt budget and surfaces the reason.

## 5. Validation and rejection

Every `ecg_batch` passes `parseBatchMessage()` (`src/types/protocol.ts`) before it reaches the engine:

- `type` must be `ecg_batch`
- `device_id` non-empty, ≤ 64 chars
- `sample_rate_hz` in [100, 2000]
- `samples` array length 1–512, all finite numbers
- `sequence` finite and ≥ 0

Rejected frames are counted and exposed as `error` frames to the device; the UI shows a transport
error instead of silently rendering nothing.

## 6. Versioning

- `protocol_version` is sent in `hello` and every batch.
- A v1 implementation that receives an unknown version should keep working for unknown fields
  (additive changes) and reject frames whose version it cannot interpret.
- Breaking changes increment the version and are documented here with a migration note.
- Payload size cap: 1 MB per frame (bridge `maxPayload`), far above any legal batch.

## 7. Testing without hardware

```bash
npm run server
npm run fake:device            # 30 s of 500 Hz batches as `fake-esp32-01`
```

`scripts/fake-device.mjs` implements the same frames; it is the reference for firmware authors.
Verify: device appears in `/health`, the UI switches to Hardware mode, sequence counters rise, and
killing the script produces a `device_status` with `connected: false`.
