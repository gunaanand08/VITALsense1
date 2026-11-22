# KNOWN LIMITATIONS — CARDIOPULSE

Everything below is true of this repository as delivered. Nothing here is aspirational.

## 1. Hardware is not verified

- **No physical ESP32 or AD8232 was available.** The firmware was written and reviewed but never
  flashed onto a board, and no electrode was ever attached.
- The hardware path was exercised with `scripts/fake-device.mjs`, which speaks the same protocol. That
  proves the bridge, transport, gap detection and UI plumbing — it does **not** prove firmware
  behaviour, ADC noise performance, timing accuracy or lead-off polarity on real hardware.
- GPIO34 in `config.example.h` is an example for classic ESP32 boards. ESP32-S3/C3 route ADC1 to
  different pins; the default will not work unmodified there.
- Real-world sample-rate accuracy depends on the board's timer and Wi-Fi load; the UI displays the rate
  the device reports rather than measuring the crystal.

## 2. Algorithmic limits

- Detection is a simplified, single-lead Pan–Tompkins variant with no search-back stage. It is **not**
  validated against annotated databases (MIT-BIH or similar) and can miss beats in heavy motion
  artefact.
- Amplitude-based thresholding is sensitive to gain changes; a sudden electrode impedance change may
  cause a short run of rejected beats.
- HRV (SDNN/RMSSD/pNN50) is computed over short recordings from one lead. Values are educational and
  are withheld below 10 valid intervals — they are not clinically interpretable.
- Signal quality is a documented technical score, not a measure of diagnostic validity.
- The "rhythm review" state is a simple quality/threshold flag. It is not an arrhythmia detector.

## 3. Simulation fidelity

- The synthesizer generates a plausible P-QRS-T morphology from Gaussian components. It is not a
  patient model, does not include realistic beat-to-beat morphology changes, and its "irregularity" is
  respiratory-sinus-arrhythmia-like noise rather than any specific rhythm.
- Simulation values are always labelled `SIMULATION`; they must never be presented as a measurement.

## 4. Test coverage gaps

- No Playwright/end-to-end suite (deliberately skipped: no CI, large browser download). Browser
  verification was done interactively in the real Chromium pane.
- No cross-browser matrix (Chromium only) and no physical mobile device testing.
- No long-running soak test (multi-hour session) and no IndexedDB quota-exhaustion test.
- React components have no rendering tests beyond type-checking; logic is covered at the module level.
- Firmware has no unit tests (Arduino toolchain not installed here).

## 5. Functional limits

- One active data source at a time; the engine models a single device.
- Browser-side LAN discovery is impossible by design; discovery goes through the bridge (mDNS +
  connected-device registry). If the device advertises nothing and is not yet connected, the operator
  must type the endpoint.
- mDNS discovery of the ESP32 is not implemented in the firmware, so the discovery list is usually
  populated from already-connected devices.
- No authentication on the bridge — it is a localhost/LAN development helper. Do not expose it.
- In hosted mode the ECG batches are **world-readable**. `supabase/schema.sql` grants the publishable
  key `SELECT` on `ecg_devices` and `ecg_batches` and defines no write policy, so anyone holding the
  project URL can read whatever a device published. That suits a public educational demo, not
  private traces; put the project behind auth before publishing anything sensitive.
- The Supabase transport adds latency the bridge path does not have (Realtime delivery, plus the
  backlog query on connect). No compensation is attempted: sample timing still comes from the device
  clock, and `received_at` is a transport metric only.
- `npm run gateway` must run on a machine that can reach the bridge and the internet. If it stops, the
  dashboard returns to `waiting` after 3.5 s of silence and keeps its last trace.
- Sessions are per browser profile in both transports, so a Vercel deployment cannot show another
  visitor's recordings.
- Recordings live in one browser profile; there is no sync, backup or export-all.
- CSV export of a very long session produces a large file (≈70 bytes/sample); it is not chunked.
- The 3D heart is a user-supplied **artist's anatomical scan** (`3d heart/`, converted to
  `public/models/heart/heart.glb`). It has realistic external surface detail — atrial appendages, the
  aortic arch with its three branches, pulmonary trunk, venae cavae and epicardial coronary vessels —
  but it is a single closed surface: no chambers, valves or interior anatomy, and nothing about it is
  patient-specific or derived from the recording.
- **Provenance and licence of that model are not recorded in this repository.** It was supplied by the
  project owner as a third-party asset; confirm its licence before any public release, and replace it
  if redistribution is not permitted.
- The heart asset is heavy for a web page: one self-contained 5.6 MB GLB (22 559 triangles plus
  embedded 2k base colour, 2k roughness and 1k normal maps). It is a static file served from
  `public/`, so it is not bundled into the JS chunk and is cached by the browser, but the first visit
  shows only the projected silhouette (`public/models/heart/silhouette.png`, 1.7 KB) until it
  arrives — that placeholder is the model's outline, not a live render.
- The model's FBX unit scale (~286×) is baked out at load time by computing its bounding box and
  rescaling to a fixed 3.3-unit height; if the asset is ever replaced, that normalisation keeps the
  framing stable but the model's own proportions will change how it fills the panel.
- The bundle is a single ~1.7 MB chunk (three.js + jsPDF dominate); route-level code splitting was
  deferred.

- The dashboard panel's own canvas cannot be captured by this agent: the preview tab stays
  `visibilityState: 'hidden'`, where `@react-three/fiber` never measures its container and no frame is
  ever painted. The scene was instead rendered at the panel's exact 1020 × 440 size through R3F's
  imperative root and stepped manually (see `docs/TESTING_AND_VERIFICATION.md` §7), which exercises
  the same `HeartSceneContent`. What that does **not** cover: the panel's surrounding chrome, the
  live pulse animation over time, and the state-coloured rim light as the monitoring state changes.

## 6. Documentation accuracy

`docs/ECG_SIGNAL_PROCESSING.md` describes the implemented pipeline, including the warm-up behaviour
(0.5 s settling skip, then percentile seeding) that the code actually performs. If the detector is
changed, that section must change with it.

## 7. What would be needed to call this a product

Certified acquisition hardware, a validated detection algorithm with published performance on annotated
databases, multi-lead capability, a quality management system, clinical evaluation, and regulatory
clearance. None of that is in scope, and none of it is claimed.
