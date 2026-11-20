# Bridge server

Local transport bridge between the ESP32 and the browser.

```
ESP32 ──ws──▶ /ws/device ──▶ registry ──▶ /ws ──▶ CARDIOPULSE UI
```

## Run

```bash
npm run server        # tsx watch, http://127.0.0.1:8787
```

Environment: `PORT` (default 8787), `HOST` (default `0.0.0.0`, so a device on the LAN can reach it).

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness, protocol version, connected devices |
| GET | `/api/devices` | Currently connected devices plus a 2.5 s mDNS browse |
| POST | `/api/bridge` | `{ "url": "ws://device:81/ws" }` — bridge a device that runs its own WS server |
| WS | `/ws` | Browser channel: receives `bridge_hello`, `device_status`, `ecg_batch` |
| WS | `/ws/device` | Device channel: expects `hello` then `ecg_batch` frames |

## Responsibilities (and non-responsibilities)

- Validates every device frame with the shared protocol module; malformed frames are rejected with an `error` reply and never forwarded.
- Tracks per-device sequence gaps and out-of-order frames.
- Broadcasts to all connected browsers; it does **not** process signals and **does not** persist anything.
- No authentication: it is a localhost development bridge. Do not expose it to the internet.

## Testing without hardware

```bash
npm run server
npm run fake:device     # sends 30 s of 500 Hz batches as `fake-esp32-01`
```

Then open the app, switch to Hardware mode, and confirm the device id, sample rate and sequence counters. A gap can be
provoked by killing the script mid-run and restarting it with a higher `--seconds`.
