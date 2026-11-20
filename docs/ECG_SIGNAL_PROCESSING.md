# ECG SIGNAL PROCESSING — CARDIOPULSE

All processing is pure TypeScript with no DOM dependency (`src/signal/`) and is unit-tested against
synthetic signals with known beat times.

## 1. Sampling

| Parameter | Value | Rationale |
| --- | --- | --- |
| Default rate | 500 Hz | QRS (~80–120 ms) spans 40–60 samples |
| Supported | 125–1000 Hz | Coefficients derive from the rate actually reported |
| ADC | 12 bit, 0–4095 | ESP32 SAR ADC; kept as raw counts until display scaling |
| Batch | 25–50 samples | 50–100 ms per WebSocket frame |

The rate is never assumed: it comes from the device payload (hardware) or the user setting
(simulation). A rate change resets filter and detector state.

## 2. Filter chain

Order: **high-pass → low-pass → notch**, implemented as second-order RBJ biquads in Direct Form I with
persistent state, so batch boundaries introduce no discontinuity.

| Stage | Default | Purpose |
| --- | --- | --- |
| High-pass | 0.5 Hz, Q = 0.707 | Removes DC offset, electrode drift, respiration wander |
| Low-pass | 40 Hz, Q = 0.707 | Removes EMG and ADC noise above QRS content |
| Notch | 50 Hz, Q = 30 | Suppresses mains interference (60 Hz selectable in Settings) |

Coefficients come from the standard RBJ cookbook formulas, recomputed for `fs`, cutoff and Q — no
hard-coded coefficients. Every stage can be disabled so raw and filtered traces can be compared.

**Documented limitations.** IIR filters introduce phase distortion, which shifts apparent QRS timing
by a few milliseconds — irrelevant for rate estimation, relevant if the student compares raw and
filtered peak positions. A 2nd-order 0.5 Hz high-pass can slightly attenuate the T wave. A 40 Hz
low-pass rounds the QRS apex at low sample rates. Deliberately aggressive settings (e.g. 15 Hz
low-pass) visibly distort morphology and are therefore not the default.

## 3. R-peak detection (Pan–Tompkins-style, simplified)

Streaming pipeline over the filtered signal:

1. **Derivative** `y[n] = x[n] − x[n−2]` — emphasises QRS slope, suppresses slow T waves.
2. **Squaring** `z[n] = y[n]²` — all-positive, amplitude weighted.
3. **Moving-window integration** — 150 ms rectangular window: the QRS energy envelope.
4. **Adaptive threshold** — `thr = npki + 0.25·(spki − npki)`, with `spki = 0.125·peak + 0.875·spki`
   for signal peaks and the same weighting for noise peaks; initialised from the 90th percentile of
   the first 2 s.
5. **Refractory period** — 200 ms (≈300 bpm ceiling); prevents double-counting one QRS.
6. **Peak refinement** — search ±60 ms around the integration maximum on the *filtered* signal and
   report that extremum, so timing tracks the R apex and not the energy envelope.
7. **RR validity** — intervals outside 300–2000 ms, or deviating >50 % from the running median of the
   last 8 NN, are marked `artifact`, excluded from HRV, but still drawn so the user sees why.
8. **Beat emission** — `{index, timeMs, rrMs, valid}` per accepted beat.

State resets on connect, rate change and manual reset.

**Validation** (`tests/unit/detector.test.ts`): 60/90/120 bpm synthetic ECG at 500 Hz with noise,
wander and 50 Hz hum must give the exact beat count (±1) and mean RR within 2 % of the generated
interval; flatline and pure noise must yield zero beats.

**Honest statement:** educational detection, not a clinical QRS detector. No search-back stage, not
validated against MIT-BIH, and it will miss beats under heavy motion artefact.

## 4. Heart rate

```
bpm = 60000 / median(last 5 valid NN intervals)
```

- Shown after ≥2 valid beats; before that the UI displays `—` with "acquiring".
- Median-of-5 removes single-beat jitter without hiding genuine rate changes (no exponential
  smoothing).
- Session avg/min/max use valid NN intervals only and are aggregated incrementally.

## 5. HRV

| Metric | Formula | Guard |
| --- | --- | --- |
| SDNN | `sqrt(Σ(RRᵢ − meanRR)² / (N−1))` | N ≥ 10 valid NN |
| RMSSD | `sqrt(Σ(RRᵢ₊₁ − RRᵢ)² / (N−1))` | N ≥ 10 valid NN |
| pNN50 (display only) | share of successive differences > 50 ms | same guard |

- Only NN-like intervals are used: artefacts (running-median ratio test) and intervals spanning
  detected sequence gaps are excluded.
- Live display window: last 60 valid intervals; stored summaries use the whole session.
- Below the guard the UI states "Insufficient valid intervals (n/10)" — a placeholder number is never
  shown.
- Caveat shown to users: short recordings, single lead and a hobby front-end make these values
  unsuitable for clinical HRV assessment.

## 6. Signal quality

A documented **technical** score, not a clinical confidence value.

| Component | Weight | Definition |
| --- | --- | --- |
| Lead-off | veto | either electrode off → 0, `No signal` |
| Flatline | veto | peak-to-peak < 0.02 mV-equivalent over 2 s → `No signal` |
| Saturation | 20 | share of samples at ADC rails (>4080 or <16) |
| Noise | 35 | RMS of (x − 20 ms moving average) relative to RMS of x |
| Baseline stability | 15 | share of window beyond 3× window RMS after high-pass |
| Beat consistency | 30 | coefficient of variation of the last 8 valid RR |

```
score  = 100·(1 − 0.20·sat' − 0.35·noise' − 0.15·base' − 0.30·rrCv')
Good   = score ≥ 75   Fair = 50–74   Poor = 1–49   No signal = 0
```

Ratios are clamped to [0,1]. The category is always shown as text, so colour is never the only cue.
The UI never labels this "confidence" or "diagnostic quality".

## 7. Time alignment and latency

- `deviceTimeMs` is the device clock at the batch's first sample; per-sample time is
  `t = deviceTimeMs + i·1000/fs`.
- `receivedAtMs` is local arrival time, used only for latency (`receivedAtMs − deviceTimeMs`) when both
  come from the same device clock.
- The renderer draws by sample index, so a transport hiccup shows a visible discontinuity rather than
  a stretched waveform.
- Latencies are measured and reported; no zero-latency claim is made.
