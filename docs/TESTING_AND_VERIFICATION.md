# TESTING AND VERIFICATION — CARDIOPULSE

## 1. Automated checks

```bash
npm run typecheck     # tsc --noEmit, strict, no unused locals
npm run lint          # eslint (flat config, TS + react-hooks rules)
npm run test          # vitest run (jsdom)
npm run build         # typecheck + vite production build
```

## 2. Signal-processing tests (`tests/unit`)

| File | Covers |
| --- | --- |
| `filters.test.ts` | Low-pass passes 10 Hz, notch attenuates 50 Hz, high-pass removes DC, chain keeps a 5 Hz signal while removing a constant offset, stage enable/disable, coefficient recomputation on rate change |
| `detector.test.ts` | Beat counts at 60/90/120 bpm against the synthesizer's known beat schedule; mean RR within 5 %; detection survives noise + wander + hum; flatline yields zero beats; railed lead-off input yields ≤ 3; a 20 Hz impulse train collapses to ≤ 2 detections |
| `metrics.test.ts` | Median/rate maths, SDNN/RMSSD against hand-computed values, the ≥10-interval guard, the 300–2000 ms and running-median plausibility rules, session accumulator extremes |
| `quality.test.ts` | Lead-off veto, flatline detection, good score on a clean periodic trace, noise penalty, no category without data |
| `synthesizer.test.ts` | P/Q/R/S/T morphology ordering and polarity, ADC range, requested BPM accuracy, irregularity increasing RR spread, lead-off railing, alternate sample rates |
| `protocol.test.ts` | Frame normalisation, rejection of wrong type/empty samples/out-of-range rates/non-finite values, ADC clamping, hello validation |
| `csv.test.ts` | One row per sample with no downsampling, documented header, note escaping, lead-off preservation |

## 3. Integration tests (`tests/integration`)

`engine.test.ts` drives a real `EcgEngine` through a fake `DataSource`:

- 16 s of 25-sample batches produce > 8 beats and a plausible BPM;
- recording 7500 samples returns one `RecordingResult` whose chunks sum to the ingested count;
- a sample-rate change resets buffers and the sample counter.

The engine, filters, detector, metrics and quality code are the same modules used by the UI — no
test doubles for the signal path.

## 4. Manual protocol verification (scripted device)

```bash
npm run server         # terminal 1
npm run fake:device    # terminal 2 — 30 s of 500 Hz batches
```

Checks: `/health` lists `fake-esp32-01`; the UI in Hardware mode shows device id, sample rate,
increasing batch/sample counters; closing the device produces `device_status connected:false`; the
browser reconnect path (bounded backoff) can be observed by restarting the bridge.

## 5. Browser verification (what was actually done)

Performed in the real browser pane against the running dev server:

- application loads and the simulation source starts automatically;
- Overview renders a live waveform, BPM, RR, quality and the 3D heart;
- ECG Analysis: filtered/raw panels, window switching, freeze/pan, filter toggles;
- HRV: metrics appear only once ≥ 10 valid intervals exist, charts render;
- Session History: record → stop → session listed → detail waveform → notes saved;
- Reports: CSV and PDF downloads produced from a stored session;
- Device Settings: endpoint editing, bridge connectivity test, simulation presets;
- no uncaught console errors during navigation (see §7 for what was not checked).

### 5b. Defects found by that browser pass (all fixed)

| Symptom seen on screen | Cause | Fix |
| --- | --- | --- |
| Heart panel completely black, one frame rendered | StrictMode double mount made R3F create a second WebGL renderer on the same canvas | removed the StrictMode wrapper (D-13) |
| Live trace was a bare baseline with isolated ticks | `copyWindow`/`copyRange` returned the opposite ring, so the raw panel drew centred values and the filtered panel drew counts | corrected both accessors |
| 64 batches in 19 s instead of ~475; only 2 beats per minute | `setInterval` throttled in an occluded tab with a fixed samples-per-tick count | generate by elapsed time with a bounded catch-up (D-14) |
| Bridge listened on port 0 | empty `PORT` in the environment | validated port parsing with a 8787 fallback (D-15) |
| Stored-session plot flattened by one spike | auto-scale used the maximum, which the filter transient dominates | scale to the 99th percentile (`robustPeak`) |

## 6. Performance checks

- The canvas renderer reads the ring buffer inside `requestAnimationFrame`; React state is limited to
  4 Hz telemetry. No per-sample re-render exists in the codebase.
- Buffer capacity is fixed (60 s at the current rate); memory does not grow with session length.
- Recording writes one chunk per 5000 samples, so the live path never awaits IndexedDB.
- The 3D scene is one mesh in one draw call at dpr ≤ 1.9, and can be disabled in Settings.

## 7. Visual overhaul (Bugatti language + anatomical heart)

- **The heart scene was verified from a real WebGL render at the dashboard's exact canvas size**
  (1020 × 440). The preview tab stays `visibilityState: 'hidden'`, where `requestAnimationFrame`
  never fires and `@react-three/fiber` never measures its container, so the panel itself cannot be
  painted here. The scene was therefore mounted through R3F's imperative root with an explicit
  `size` and stepped with manual `advance()` calls, rendering `HeartSceneContent` — the same lights,
  environment, material and model the dashboard uses. Evidence: `docs/assets/heart-scene-dashboard.png`.
- **The first in-browser render was wrong, and the screenshot is what caught it.** Three defects, all
  found by measuring the pixels rather than trusting the code:
  - *Washed out.* Mean surface pixel was `rgb(140, 89, 84)` — pale flesh — with highlights clipping at
    253/255. Cause: the light budget had accumulated (ambient + hemisphere + key + fill + kicker +
    point + environment) and the clearcoat/sheen stack added a glassy specular on top. Fixed by
    halving the fills, dropping sheen, cutting clearcoat, and keeping emissive down at 0.07 so the
    state tint cannot bleach the tissue. Final mean `rgb(106, 57, 52)`, peak luminance 147, **0 %**
    clipped pixels.
  - *Too small.* The heart covered 315 px of the 440 px panel (72 %). Raised the normalised height to
    3.3 units and moved the camera to z = 6.5: now 369 px (84 %), centred at (510, 215) — the panel
    has no text at that height, so nothing collides.
  - *Flat pale ribbons across the ventricle.* Diagnosed in three steps: a `MeshNormalMaterial` pass
    showed a smooth, continuous surface (so the geometry was fine), a `MeshBasicMaterial` pass still
    showed the ribbons (so it was the base-colour map, not lighting), and re-reading the exporter
    showed why. FBX stores UVs with V up, glTF loads textures with `flipY = false` (V down), and
    `GLTFExporter` passes UVs through untouched — every island was sampling the atlas vertically
    mirrored, so fat painted for the atria landed across the ventricle. `build-heart-glb.mjs` now
    flips V at export; the coronary tree and epicardial fat then sit where they belong.
- The supplied roughness map was dropped in favour of a uniform 0.62. It is authored for a hero
  render: at panel size it turned the ventricle into a mirror and lit every pale patch of fat into a
  bright plate. Clearcoat 0.2 keeps a wet edge without the plastic look.
- **The panel is no longer a black hole while the 5.6 MB GLB arrives.**
  `scripts/heart/build-silhouette.mjs` projects the model's own triangles through the same camera
  (`[0, 0.1, 6.5]`, fov 34), pose (`[0.02, -0.34, 0]`), normalisation (3.3 units) and 1020 × 440
  frame as the scene, rasterises the result, crops to its bounding box and writes
  `public/models/heart/silhouette.png` (249 × 373, 1.7 KB, one dim tone at full alpha). Using the
  model's own outline is the point: the live render fades in at exactly that size and position, so
  nothing jumps. `HeartSilhouette` places it by height and vertical centre alone (`h-[84.8%]`,
  `top-[49%]`, both printed by the generator), which also holds at the 340 px mobile panel. The
  fade starts from an effect inside `HeartModel` — after the GLB *and* its embedded maps have
  decoded — rather than from a loading-manager progress value, and the image is `aria-hidden`,
  `alt=""` and `pointer-events-none`, with the transition dropped under reduced motion.
- Placeholder geometry was checked against measurements, not by eye. In the running app the element
  resolves to 249.1 × 373.1 px, 29 px from the top of the 440 px panel and centred horizontally in
  it, so it covers y 29–402 against the live heart's measured y 30–399 — the few extra pixels are the
  generator's 2 px crop padding.
- The mesh itself was verified offline from its triangle data before any of this: 22 559 triangles,
  67 677 vertices, one connected component (11 281 welded vertices), face winding consistent with the
  vertex normals (22 551 of 22 559 agree), bounding box 2.17 × 3.21 × 1.76 units. The FBX node matrix
  carries a ~286× centimetre scale, which the scene ignores — the geometry is recentred and rescaled
  by its own bounding box.
- The silhouette was rasterised offline from three axes to confirm orientation before choosing the
  camera: apex down, aortic arch on top with three branches, pulmonary trunk crossing anteriorly, both
  venae cavae clear. A second offline pass sampled the embedded base colour through the interpolated
  UVs (`docs/assets/heart-model-anterior.png`, `heart-model-three-quarter.png`).
- The embedded PNGs were extracted from the GLB and re-opened with an independent decoder
  (System.Drawing) to prove the 16-bit → 8-bit normal rewrite is a valid image: 2048² base colour,
  2048² roughness, 1024² normal.
- Typography, navigation, panels, forms and the ECG canvas were verified from real screenshots of
  Overview, ECG Analysis and HRV.
- Layout was also checked programmatically at 1440, 1024 and 430 px: no horizontal overflow on
  Overview, Sessions or Settings, correct font resolution (Saira Condensed / EB Garamond / JetBrains
  Mono for their respective roles), and the nav swapping to the bottom tab bar below 1024 px.

## 8. Not verified (honest gaps)

- **Physical ESP32 + AD8232 hardware was not available.** Firmware compiles conceptually but was not
  flashed; the protocol was verified with `scripts/fake-device.mjs` only.
- No cross-browser matrix (Chromium used); no mobile device testing beyond responsive layout rules.
- No long-duration soak test (hours) or IndexedDB quota-exhaustion scenario.
- Playwright end-to-end specs are not included; browser checks were done interactively.
- Detection was not validated against MIT-BIH or any annotated clinical database.
- The preview browser runs in a **hidden** tab (`visibilityState === 'hidden'`), where Chrome clamps
  timers to ~1.3/s and stops `requestAnimationFrame` entirely. All live numbers were therefore read
  in short bursts while the window was drawable; a long continuous soak was not possible here.
- The placeholder was confirmed in the running app to load and sit at full opacity over the panel
  with the box in §7, but its **cross-fade into the live render was never watched**: this tab cannot
  paint, so nothing advances the 0.7 s opacity transition. The trigger is the model's own ready
  signal (an effect after the GLB and its embedded maps decode), not a timer.

## 9. Definition of done for a change

`typecheck`, `lint`, `test` and `build` pass, the affected page was opened in the browser, and the
documentation describing the changed behaviour was updated.
