# ARCHITECTURAL DECISIONS — CARDIOPULSE

Each entry records the decision, the reason, and the cost. New dependencies require an entry here.

---

## D-01 — Single `EcgBatch` contract with pluggable `DataSource`

**Decision.** Every acquisition path emits `EcgBatch`; `SimulationDataSource` and `Esp32DataSource`
implement one `DataSource` interface. Pages and the engine never know which is active.
**Why.** Switching simulation ↔ hardware without touching the dashboard was a hard requirement, and
it keeps the whole signal path testable without a socket.
**Cost.** One normalization layer; the source must convert its own units before handing data over.

## D-02 — Engine owns all mutable signal state; React receives 4 Hz snapshots

**Decision.** Ring buffers, filter state, detector state and recording live in `EcgEngine`. React gets
a small `TelemetrySnapshot` at 4 Hz plus direct canvas reads inside `requestAnimationFrame`.
**Why.** A 500 Hz stream updates React ~2000×/s if naively wired; that destroys frame rate and battery.
**Cost.** The canvas component bypasses React state, so it must be written carefully (DPR, decimation).

## D-03 — Custom canvas renderer instead of a charting library

**Decision.** Hand-written min/max-decimated canvas ECG renderer.
**Why.** Chart libraries smooth, aggregate or re-render on data change; ECG needs per-column extrema,
exact spike preservation and no framework overhead.
**Cost.** ~200 lines of drawing code to maintain; grid/scale logic is ours.

## D-04 — TypeScript 6.0.3, React pinned to 19.3.1

**Decision.** Stay on the last JS-based TypeScript line and pin React exactly.
**Why.** TypeScript 7 is the new native compiler; tooling (typescript-eslint, Vitest transforms) has
not all caught up, and a deadline is not the moment to debug a compiler swap. `@react-three/fiber`
declares `react >=19 <19.4`, so an unpinned React could silently break the 3D scene.
**Cost.** Missing newer TS performance improvements.

## D-05 — Skips Playwright browser download; uses the built-in browser for visual verification

**Decision.** No `@playwright/test` browser install; verification happens in the real Chromium already
present, plus Vitest/jsdom for logic.
**Why.** ~150 MB download and a second browser toolchain for a one-day build, with no CI to run it in.
**Cost.** No committed E2E specs and no regressions caught by automation; documented in
`docs/KNOWN_LIMITATIONS.md`. Adding Playwright later needs no architectural change.

## D-06 — Design system adapted from UI/UX Pro Max output

**Decision.** Use the skill's structure (dense spacing scale, Fira Sans + Fira Code pairing, hairline
panels, anti-pattern list), but change the accent from status-green to cyan and darken surfaces.
**Why.** Green must remain a *status* colour in a monitoring UI, and the brief calls for a dark
clinical instrument identity with cyan ECG accents.
**Cost.** The generated tokens and `src/styles/tokens.css` diverge by hue; recorded here so the
difference is intentional.

## D-07 — IndexedDB chunked recording, no server persistence

**Decision.** Store raw samples as `Int16Array` chunks of 5000 in IndexedDB; re-derive filtered
signals and beats on read.
**Why.** Offline-first, no infrastructure, and raw samples are the only data that cannot be
reconstructed. Storing derived data would double size and could disagree with the live view.
**Cost.** Exports and replay re-run the pipeline (fast enough: ~30k samples/s in JS).

## D-08 — JSON wire protocol, batched samples

**Decision.** UTF-8 JSON frames of 25 samples, versioned with `protocol_version`.
**Why.** Inspectable with any WebSocket tool, trivial to implement on Arduino without a JSON library
(the firmware formats frames with `snprintf`), and small enough at ~6 kB/s.
**Cost.** Bytes ≈ 4× larger than binary; acceptable at these rates, revisit for > 4 channels.

## D-09 — Bridge validates but does not process

**Decision.** The Fastify bridge validates frames, tracks sequence gaps and rebroadcasts; all DSP is
in the browser.
**Why.** One implementation of the algorithm, testable in Node, no duplicated C++/TS DSP.
**Cost.** The browser does the work; a future headless recorder would need to port the pipeline.

## D-10 — Detector warm-up skips the filter settling transient

**Decision.** Ignore the first 0.5 s of envelope, then seed `spki`/`npki` from p90/p50 of the next 2 s.
**Why.** The first implementation seeded from the start-up transient and set a threshold above every
real beat — measured as zero detections in tests. Robust percentiles after settling fix it.
**Cost.** ~2.5 s before the first beat is reported (the UI shows "acquiring" during that window).

## D-11 — Simulation is a real signal generator

**Decision.** `EcgSynthesizer` builds P-QRS-T from Gaussian components with a beat schedule, noise,
wander, hum and lead-off, sharing the filter/detector path.
**Why.** The detector and metrics must be exercised by the same path that hardware uses; animating
numbers would prove nothing and could mislead a demonstrator.
**Cost.** Morphology is educational, not a patient model; documented as such.

## D-13 — No React StrictMode wrapper

**Decision.** `src/main.tsx` renders `<App />` without `<StrictMode>`.
**Why.** StrictMode's development double-mount makes `@react-three/fiber` construct a second WebGL
renderer on the same canvas. Chromium rejects it ("Canvas has an existing context of a different
type"), the render loop stops after one frame and the heart scene stays black — verified in the browser
by counting rendered frames and inspecting the scene graph. Removing the wrapper restores continuous
rendering.
**Cost.** Development loses StrictMode's double-invocation checks. Compensated by the lint rules that
flag cascading setState, and by effects that cancel on cleanup.

## D-14 — Simulation generates by elapsed time, not a fixed sample count

**Decision.** `SimulationDataSource` computes how many samples *should* exist since the last tick
(capped at 2 s of catch-up) and emits them as consecutive batches of at most 250 samples.
**Why.** Browsers clamp `setInterval` in occluded/background tabs to roughly 1 Hz. A fixed 20
samples/tick then produced 1/8 of real time: the dashboard showed a plausible 72 bpm but only two
beats per minute of wall clock, which looked like a detection bug. Measured before the fix: 64 batches
in 19 s; after: 11 403 samples in 22 s.
**Cost.** In a throttled tab the trace updates in bursts (up to 0.5 s of data per frame) instead of
smoothly; in a visible window it is unchanged at 25 batches/s.

## D-15 — Bridge never trusts an empty PORT

**Decision.** `server/src/index.ts` parses `PORT` and falls back to 8787 unless it is a valid port
number.
**Why.** A shell with `PORT=0` exported bound the bridge to an ephemeral port (observed as
`listening on http://0.0.0.0:0`), which no client could reach. `??` does not protect against an empty
or zero-valued string.
**Cost.** None; an operator who genuinely wants a random port must now pass a valid one.

## D-16 — Bugatti design language replaces the generated dashboard system

**Decision.** The UI is rebuilt on `design-system/bugatti/DESIGN.md`: pure-black canvas, no accent
colour, Saira Condensed display / EB Garamond body / JetBrains Mono labels, 0 px radius except pill
buttons, hairlines instead of elevation.
**Why.** The owner reviewed the first build and asked for the uploaded system by name. The old cyan
instrument palette read as a generic admin dashboard; the monochrome system puts the ECG trace and
the heart render in charge, which is the right hierarchy for this product.
**Cost.** Status hues are desaturated so they no longer pop; they are now read through labels and
hairline badges rather than filled chips. The three Bugatti typefaces are licensed, so the
open-source substitutes named in the analysis are used. Contrast was re-checked: white 21:1, muted
13.6:1, dim 5.6:1 on black.

## D-17 — Heart is a signed-distance-field mesh, not assembled primitives (*superseded by D-19*)

**Decision.** `src/three/heartGeometry.ts` builds one fused surface from a smooth-union SDF
(ventricles, atria, aorta with arch, pulmonary trunk, venae cavae, pulmonary veins) and polygonises
it with marching tetrahedra; per-vertex occlusion is sampled from the field.
**Why.** The first version glued seven `SphereGeometry` lobes together. At any angle the seams and
the sphere curvature read as balloons, not anatomy. A smooth-union field produces one continuous
organic surface, and the sulci can be carved as shallow creases.
**Cost.** ~330k field samples on first mount (~1–1.5 s, once per page load, cached), ~64k triangles.
Sulci are carved by *adding* distance along a line: subtracting a tube instead punched a hole through
the ventricular wall (found by measuring open mesh edges, which located the crater). The model is
anatomical in silhouette only — not patient-specific, not a diagnostic model.

**Outcome.** The owner rejected the result: at dashboard size the field mesh still read as a smooth
red blob rather than a heart. D-19 replaces it, and `src/three/heartGeometry.ts` was deleted.

## D-19 — Heart is the supplied anatomical model, not generated geometry

**Decision.** The dashboard renders the user-supplied anatomical heart in `3d heart/` (FBX + PBR
maps). `scripts/heart/build-heart-glb.mjs` converts it once to
`public/models/heart/heart.glb` (22 559 triangles, POSITION/NORMAL/TEXCOORD_0, single mesh) with the
base-colour, roughness and normal maps embedded as PNGs, so the page makes one request and
GLTFLoader assigns the correct colour spaces. The normal map is rewritten from 16-bit to 8-bit and
halved to 1024 px (~13 MB → 1.6 MB) by the same script, and UVs are flipped (V = 1 − V) because FBX
stores V up while glTF textures load with `flipY = false` — without that flip the atlas is sampled
mirrored and epicardial fat lands across the ventricle. `HeartScene` recentres the geometry and
rescales it to a fixed 3.3-unit height, which also cancels the asset's ~286× centimetre node scale.
`scripts/heart/build-silhouette.mjs` projects the same geometry through the same camera, pose and
normalisation into `public/models/heart/silhouette.png`, the placeholder shown while the GLB loads.
**Why.** Generated primitives and a coarse SDF could not produce the surface detail that makes a heart
recognisable — atrial appendages, the aortic arch and its branches, coronary vessels running in the
sulci. A sculpted scan has that detail for free, and the maps add capillary-scale relief under a
2k normal map.
**Cost.** One 5.6 MB GLB, loaded on demand and cached. While it is in flight the panel shows that
projected silhouette instead of an empty rectangle; because it is the model's own outline at the
model's own scale, the live render fades in over it without anything moving or resizing.
The asset is third-party art whose licence is not recorded here (see
`docs/KNOWN_LIMITATIONS.md`), and it remains external-surface only — no chambers or valves. State
readability is unchanged: the tissue keeps its crimson maps and only emissive/rim light track the
monitoring state. The supplied roughness map is not used: it is authored for a hero render and, at
panel size, turns the ventricle into a mirror and every pale patch of fat into a bright plate, so the
material uses a uniform 0.62 roughness with a light clearcoat instead.

## D-18 — Fonts bundled offline via @fontsource substitutes

**Decision.** `@fontsource/saira-condensed`, `@fontsource/eb-garamond` and
`@fontsource/jetbrains-mono` (exact 5.3.0) replace the Fira pairing.
**Why.** The Bugatti families are licensed to the brand; the design analysis documents Saira
Condensed / EB Garamond / JetBrains Mono as the closest open substitutes, and the three-family split
matters more than an exact match. Bundling keeps the app offline-first (no runtime font request).
**Cost.** ~100 kB of woff2 in the build. Fira Sans and Fira Code were removed.

## D-12 — ESLint react-hooks rules satisfied by restructuring, not suppression

**Decision.** Loading logic moved out of synchronous effect bodies; `Date.now()` removed from render.
**Why.** The new react-hooks rules encode real cascading-render problems; suppressing them would hide
issues the deadline cannot afford to rediscover later.
**Cost.** Slightly more verbose effects with cancellation flags.

## D-20 — Supabase is the hosted transport; recordings stay browser-local

**Decision.** When `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are present,
`SupabaseEcgDataSource` (`src/data/supabaseSource.ts`) replaces `Esp32DataSource` in hardware mode: it
hydrates the newest 40 rows of `public.ecg_batches`, then follows the table through Supabase Realtime,
normalising every row through the same `parseBatchMessage` validator the bridge uses. Rows are written
by `scripts/cloud-gateway.mjs`, which forwards the local bridge's batches with a server-side secret
key, because the ESP32 firmware speaks the documented WebSocket protocol and cannot hold a secret.
Sessions, settings and exports remain in IndexedDB/localStorage, unchanged.
**Why.** The dashboard had to run on Vercel, where no local Fastify bridge exists. Keeping the batch
contract identical leaves the engine, detector, quality scoring and every page untouched, and a plain
checkout still runs with zero configuration. Read-only RLS matters because the repository is public:
the publishable key ships in the bundle, so it must not be a write path. `vercel.json` adds the SPA
rewrite that deep links need on a static host.
**Cost.** Realtime is a second moving part — its own latency, a project that can be paused, and a
publication that must be added by hand if `schema.sql` is not run. The source therefore treats 3.5 s
of silence as `waiting`, dedupes backlog/realtime overlap by row id, and reconnects with bounded
backoff instead of spinning. Device `sequence` resets on reconnect, so a lower number is accepted as
a new connection rather than dropped — unlike the bridge, whose socket also reconnects. Recordings stay
per browser, so sharing session history between devices would need accounts and a second table,
deliberately out of scope. A 500 Hz stream accumulates in Postgres until `trim_ecg_batches()` is
scheduled.
