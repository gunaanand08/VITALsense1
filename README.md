# CARDIOPULSE

**Portable ECG Monitoring and Heart Rhythm Analysis System**
_Your Heart. In Real Time._

An educational, hardware-ready ECG workstation: a live single-lead ECG, a real signal-processing
chain (baseline removal → low-pass → 50 Hz notch → Pan–Tompkins-style R-peak detection), heart rate
and HRV analysis, a 3D heart that beats with detected R-peaks, session recording with exports, and a
documented ESP32 + AD8232 path from electrode to browser.

> **Educational prototype — not a medical device.** It cannot diagnose, rule out, or monitor any
> cardiac condition. See [`docs/SAFETY_AND_MEDICAL_LIMITATIONS.md`](docs/SAFETY_AND_MEDICAL_LIMITATIONS.md).

## Features

| Area | What exists |
| --- | --- |
| Live monitoring | Canvas-rendered ECG from real sample streams, P-QRS-T morphology, grid, sweep-free scrolling window |
| Simulation | Synthetic ECG generator with BPM, sample rate, noise, baseline wander, 50 Hz hum, amplitude, lead-off and RR irregularity controls, plus five presets |
| Signal processing | 0.5 Hz high-pass, 40 Hz low-pass, 50 Hz notch (biquads), configurable; raw vs filtered view |
| Beat detection | Streaming derivative → square → moving-window integration → adaptive threshold → refractory + peak refinement |
| Metrics | Instantaneous and averaged BPM, min/max, RR series, SDNN, RMSSD, valid NN count, measurement duration |
| Signal quality | Documented technical score (lead-off, flatline, saturation, noise, RR consistency) → Good/Fair/Poor/No signal |
| 3D heart | Anatomical three.js heart model with PBR textures, R-peak-synchronised pulse, five monitoring states, reduced-motion support |
| Recording | IndexedDB persistence, chunked sample storage, history with search/sort/delete, reload-safe |
| Reports | CSV of every sample (index, time, raw, filtered, beat, RR, lead-off) and PDF session reports |
| Device layer | WebSocket bridge with sequence tracking, gap detection, exponential-backoff reconnect, mDNS/manual discovery |
| Firmware | Arduino-ESP32 sketch: timer-driven ADC acquisition, batch framing, lead-off sensing, auto-reconnect |
| Safety | Persistent educational disclaimer, electrode/safety guidance, no diagnostic language |

## Technology stack

- **Frontend:** React 19.3, TypeScript 6.0, Vite 8, Tailwind CSS 4 (CSS-first `@theme` tokens)
- **3D:** three.js 0.187 + @react-three/fiber 9 + drei (anatomical GLB with embedded PBR maps, local Lightformer environment)
- **State / UI:** zustand, motion, lucide-react, custom canvas ECG renderer
- **Backend:** Fastify 5 + @fastify/websocket, `ws`, bonjour-service (mDNS), tsx
- **Storage / reports:** IndexedDB via `idb`, jsPDF
- **Testing:** Vitest, jsdom, React Testing Library, real-browser visual verification

## Prerequisites

- **Node.js 26 LTS or newer** (`^20.19 || >=22.12` is the Vite floor) and npm 11+
- **Python 3.x** — only for the bundled UI/UX Pro Max skill scripts (design tooling, not runtime)
- A modern Chromium/Firefox browser

Windows install (what this repository was developed on):

```powershell
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
winget install --id Python.Python.3.14 -e --accept-package-agreements --accept-source-agreements
```

## Installation

```bash
npm install
```

## Development

```bash
npm run dev        # frontend  → http://localhost:5173
npm run server     # bridge    → http://127.0.0.1:8787  (ws://127.0.0.1:8787/ws)
npm run dev:all    # both together
```

The Vite dev server proxies `/api`, `/health` and `/ws` to the bridge, so the frontend can be used
with or without the backend running. Simulation mode never needs the backend. In **Device Settings**
the endpoint defaults to `ws://<current-host>:8787/ws` — the bridge's own port, which also works for
a static production build where no dev proxy exists.

## Production build

```bash
npm run build      # tsc --noEmit && vite build  → dist/
npm run preview    # serve dist/ on port 4173
```

## Testing

```bash
npm run typecheck
npm run lint
npm run test
```

`tests/unit` covers filters, detector accuracy on synthetic signals with known beat times, HR/HRV
maths, quality scoring, the synthesizer, CSV export and protocol validation. `tests/integration`
drives the engine with a simulated device stream.

## Using simulation mode

1. Open **Overview**, confirm the banner reads `SIMULATION MODE`.
2. Press **Start session**; a waveform, BPM, RR and quality appear within a few seconds.
3. Open **ECG Analysis** to inspect raw vs filtered, adjust the window, zoom, pan and pause.
4. **Heart Rate & HRV** fills in once ≥10 valid intervals exist (nothing is fabricated before that).
5. **Device Settings → Simulation** changes BPM, noise, wander, 50 Hz hum, amplitude, lead-off and
   irregularity, or applies a preset.
6. **Session History** then **Reports** to inspect and export the recording.

## Hardware integration overview

```
AD8232 (single lead) → ESP32 ADC (timer-sampled) → Wi-Fi → local bridge → WebSocket → browser
```

1. Flash `firmware/cardiopulse-esp32/` (copy `config.example.h` → `config.h`, set Wi-Fi + bridge host).
2. Run `npm run server`; the sketch connects to `ws://<bridge-host>:8787/ws/device`.
3. Open **Device Settings**, pick the discovered device or type the bridge/device endpoint, and
   connect. Overview switches from `SIMULATION MODE` to `HARDWARE` with the device ID and packet
   statistics.

Full protocol: [`docs/ESP32_COMMUNICATION_PROTOCOL.md`](docs/ESP32_COMMUNICATION_PROTOCOL.md).
Wiring, ADC limits and safety: [`docs/HARDWARE_INTEGRATION.md`](docs/HARDWARE_INTEGRATION.md).

## Documentation

`AGENTS.md` (repository rules) · [`docs/PRODUCT_SPECIFICATION.md`](docs/PRODUCT_SPECIFICATION.md) ·
[`docs/SYSTEM_ARCHITECTURE.md`](docs/SYSTEM_ARCHITECTURE.md) ·
[`docs/UI_UX_DESIGN_SYSTEM.md`](docs/UI_UX_DESIGN_SYSTEM.md) ·
[`docs/ECG_SIGNAL_PROCESSING.md`](docs/ECG_SIGNAL_PROCESSING.md) ·
[`docs/ESP32_COMMUNICATION_PROTOCOL.md`](docs/ESP32_COMMUNICATION_PROTOCOL.md) ·
[`docs/HARDWARE_INTEGRATION.md`](docs/HARDWARE_INTEGRATION.md) ·
[`docs/DATA_STORAGE_AND_REPORTS.md`](docs/DATA_STORAGE_AND_REPORTS.md) ·
[`docs/SAFETY_AND_MEDICAL_LIMITATIONS.md`](docs/SAFETY_AND_MEDICAL_LIMITATIONS.md) ·
[`docs/TESTING_AND_VERIFICATION.md`](docs/TESTING_AND_VERIFICATION.md) ·
[`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) ·
[`docs/DECISIONS.md`](docs/DECISIONS.md) ·
[`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md)

## Known limitations

Summarised here, detailed in [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md):

- No physical ESP32/AD8232 was available during development, so hardware mode is implemented and
  protocol-tested with a scripted device but **not verified against real hardware**.
- Single lead, low ADC resolution, and a hobby front-end: no rhythm diagnosis, no ST analysis.
- HRV is computed over short recordings and is educational only.
- Browser LAN discovery is not possible; discovery goes through the local backend (mDNS/UDP) with a
  manual endpoint fallback.
- The 3D heart is an artist's anatomical model (external surface only, supplied as a third-party
  asset), not a patient-specific reconstruction.
