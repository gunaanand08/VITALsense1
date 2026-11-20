# IMPLEMENTATION PLAN — CARDIOPULSE

Delivery target: one working day. Priority order was fixed up front: functional core → polish →
simulation and processing → device layer → persistence/exports → extras. Anything in the last tier was
allowed to slip.

## Phase 0 — Environment (done)

| Task | Status |
| --- | --- |
| Detect OS, Node, Python, Git, browsers | done |
| Install Node 26.13.1, Python 3.14.10, Git 2.56 (winget, system-wide) | done |
| Verify versions in a fresh shell | done |
| Install UI/UX Pro Max skill into `.agents/skills/` | done |
| Generate design system (`--design-system --persist --tokens css`) | done — `design-system/cardiopulse/` |

## Phase 1 — Scaffold (done)

| Task | Depends on | Acceptance |
| --- | --- | --- |
| `package.json`, TS/ESLint/Vite/Vitest configs | Phase 0 | `npm install` succeeds |
| Tailwind v4 `@theme` tokens from the design system | design system | utilities resolve, no hard-coded hex in components |
| App shell: top bar, side nav, mobile tabs, toasts | tokens | navigation reachable by keyboard at 1280 px and 390 px |

## Phase 2 — Signal core (done)

| Task | Acceptance |
| --- | --- |
| RBJ biquads + `FilterChain` | 50 Hz attenuated, DC removed, 10 Hz preserved |
| `SampleRing` | bounded memory, absolute indexing across wraps |
| `RPeakDetector` (derivative → square → integrate → threshold → refractory → refine) | correct beat counts at 60/90/120 bpm; zero on flatline |
| Metrics (BPM, SDNN, RMSSD, pNN50, accumulator) | hand-checked values; ≥10-interval guard |
| Quality scoring | vetoes on lead-off/flatline, penalises noise, documented weights |

## Phase 3 — Acquisition (done)

| Task | Acceptance |
| --- | --- |
| `EcgSynthesizer` (P-QRS-T, noise, wander, hum, irregularity, lead-off) | requested BPM accurate, ADC range respected |
| `SimulationDataSource` | 20 batches/s, identical contract to hardware |
| `Esp32DataSource` | bounded backoff, gap/dup tracking, heartbeat, error surfacing |
| `EcgEngine` | ingest → filter → detect → telemetry → recording |

## Phase 4 — Interface (done)

| Page | Key elements |
| --- | --- |
| Overview | 3D heart + state badge, live strip, BPM/RR/SDNN/RMSSD/quality, electrodes, recent beats, session controls |
| ECG Analysis | filtered + raw canvases, window/zoom/freeze/pan, filter controls, RR strip, cursor readout |
| Heart Rate & HRV | rate summary, RR history, histogram, trend, metric explanations, insufficiency states |
| Session History | search/sort, detail page with replay + notes, delete confirmation, exports |
| Reports | session picker, waveform preview, PDF + full CSV |
| Device Settings | source switch, endpoint, connectivity test, discovery, simulation controls, filters, diagnostics, known devices, storage estimate |

## Phase 5 — Backend and firmware (done)

| Task | Acceptance |
| --- | --- |
| Fastify + `@fastify/websocket` bridge (`/ws`, `/ws/device`, `/api/devices`, `/health`, `/api/bridge`) | accepts scripted device, validates frames, tracks gaps |
| `scripts/fake-device.mjs` | 30 s stream, hello + batches, clean shutdown |
| ESP32 firmware + `config.example.h` + README | timer-driven sampling, batch frames, lead-off pins, reconnect, no blocking delay |

## Phase 6 — Verification (done, with documented gaps)

- `npm run typecheck` → 0 errors
- `npm run lint` → 0 errors, 0 warnings
- `npm run test` → 8 files passing (unit + integration)
- `npm run build` → production bundle built
- Bridge boot + scripted device + `/health` inspection
- Browser walkthrough of all six pages at desktop and narrow widths

## Phase 7 — Dropped or deferred

| Item | Reason |
| --- | --- |
| Playwright E2E suite | no CI, heavy browser download, replaced by real-browser checks |
| UDP broadcast discovery | mDNS + connected-device registry + manual endpoint covers the need |
| Binary protocol | JSON is fast enough at 6 kB/s and much easier to debug |
| Annotated-database validation (MIT-BIH) | no dataset in scope; documented as a limitation |
| Multi-device simultaneous view | engine models one active source by design |

## Critical path that actually mattered

1. Toolchain install (blocked everything).
2. Design tokens (blocked all UI work).
3. Detector correctness — the first implementation seeded its threshold from the filter's start-up
   transient and detected **zero** beats; the unit tests caught it. This was the single riskiest item
   and it is now covered by beat-count assertions at three heart rates.
4. Canvas renderer (blocked Overview/Analysis credibility).
