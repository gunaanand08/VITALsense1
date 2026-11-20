# PRODUCT SPECIFICATION — CARDIOPULSE

## 1. Purpose

CARDIOPULSE is an educational instrumentation project: a portable single-lead ECG acquisition and
rhythm-analysis platform built from an AD8232 analog front-end, an ESP32, a local Node bridge and a
React workstation UI. It demonstrates the full chain — electrodes, ADC sampling, transport, filtering,
QRS detection, metrics, visualization and reporting — and remains fully usable without hardware
through a synthetic signal generator.

**Non-goal:** diagnosis. The system cannot detect, exclude or grade any cardiac condition.

## 2. Users and contexts

| User | Need |
| --- | --- |
| Biomedical/electronics student | Learn acquisition, filtering and QRS detection on real and synthetic signals |
| Project evaluator / faculty | See a defensible architecture, measured behaviour and honest limitations |
| Researcher (exploratory) | Record sessions and export raw samples for offline analysis |
| Demonstrator | Show a working portable ECG without exposing anyone to risk |

## 3. Operating modes

1. **Simulation mode** — no hardware. A synthetic ECG generator produces realistic P-QRS-T morphology
   with configurable rate, variability and artefacts. Every surface is marked `SIMULATION`.
2. **Hardware mode** — samples arrive from an ESP32 through the local bridge over WebSocket. Device
   ID, packet statistics and lead-off state are displayed; no value is invented when the device stops
   sending.

Both modes feed the identical `EcgBatch` contract, engine, processing chain and renderer.

## 4. Functional requirements

### 4.1 Overview
- 3D heart with state-driven colour and R-peak-synchronised pulse.
- Data-source indicator (SIMULATION / HARDWARE), connection status, session timer, recording state.
- Live ECG strip (last 6 s default), current BPM, latest RR, SDNN, RMSSD, signal quality, electrode
  state.
- Start/stop session controls; recent-measurement summary.
- Educational disclaimer always visible.

### 4.2 ECG Analysis
- Live waveform of raw and filtered signal, R-peak markers, RR interval strip.
- Time-window selector (2/4/6/10/20 s), amplitude zoom, horizontal pan when paused, pause/resume,
  freeze-frame inspection with a sample readout.
- Filter controls (high-pass, low-pass, notch, cut-offs) applied live.
- Lead-off indicator per electrode.

### 4.3 Heart Rate & HRV
- Instantaneous BPM, rolling average, min/max, valid NN count, measurement duration.
- RR history plot and RR distribution histogram.
- SDNN and RMSSD with explicit "insufficient data" states (no fabrication below 10 valid intervals).
- Per-metric explanations and the single-lead/short-recording caveat.

### 4.4 Session History
- Persistent recordings (IndexedDB): id, timestamps, duration, source, sample rate, sample count,
  avg/min/max BPM, SDNN/RMSSD when valid, quality summary, notes.
- Detail view that replays the recorded ECG from stored samples.
- Delete with confirmation, CSV/PDF export, search and sort.

### 4.5 Reports
- PDF: identity, session metadata, HR table, HRV block, ECG plot, quality/electrode summary,
  educational disclaimer.
- CSV: every sample — `index, time_ms, raw_adc, filtered, beat, rr_ms, lead_off`. No downsampling.

### 4.6 Device Settings
- Discovery via the bridge (mDNS with UDP fallback), known-device list, manual endpoint entry,
  connection test, connect/disconnect, reconnect policy.
- Sampling rate, batch size and filter settings; ADC and firmware information; packet statistics
  (received, gaps, last packet age); explicit separation of browser-side and firmware-side settings.

## 5. Metric definitions shown to users

| Metric | Definition | Display rule |
| --- | --- | --- |
| BPM | `60000 / RR` using the median of the last 5 valid RR intervals | Hidden until 2 valid beats |
| RR | Interval between consecutive refined R-peaks | ms, one decimal |
| SDNN | Standard deviation of valid NN intervals | Only with ≥10 valid intervals |
| RMSSD | Root mean square of successive NN differences | Only with ≥10 valid intervals |
| Quality | Technical score 0–100 (lead-off, flatline, saturation, noise, RR consistency) | Category + score; never "confidence" |
| Electrodes | AD8232 LO+/LO− digital state (hardware) or simulated lead-off | Connected / Disconnected per electrode |

## 6. Quality attributes

- **Performance:** 500 Hz stream rendered at ≥50 fps on a laptop; no React render per sample; bounded
  memory (fixed ring buffer, configurable window).
- **Reliability:** no unbounded reconnection loops, no silent data loss (sequence gaps surfaced), no
  lost samples on export.
- **Privacy:** local-only; no network calls beyond the operator's own bridge.
- **Accessibility:** keyboard reachable controls, visible focus, labelled icon buttons, ≥4.5:1 text
  contrast, reduced-motion honoured.
- **Honesty:** simulated vs hardware always distinguishable; unverified hardware path documented.

## 7. Acceptance criteria

Navigation between all six pages works; simulation produces a live filtered ECG with plausible BPM
detection; HRV appears only with sufficient valid beats; sessions survive reload and export
correctly; the bridge starts, accepts scripted device batches and reports gap statistics; typecheck,
lint, unit/integration tests and the production build pass; and the UI was inspected in a real browser
at desktop and narrow widths.
