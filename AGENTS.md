# AGENTS.md — CARDIOPULSE repository instructions

Read this file before touching any code. It is binding for every coding agent and for humans
contributing to this repository.

## 1. What this project is

CARDIOPULSE is an **educational** portable ECG monitoring and heart-rhythm analysis platform.
An AD8232 analog front-end feeds an ESP32, which streams samples over Wi-Fi to a local Node
backend, which relays them to a React dashboard over WebSocket. The same dashboard also runs
without hardware using a signal synthesizer.

It is **not** a medical device. Nothing in this repository may be described as diagnostic,
clinical, or certified.

## 2. Architecture rules

1. **One data contract.** Every data source emits `EcgBatch` (`src/types/ecg.ts`). Nothing
   downstream of a data source may know whether samples came from an ESP32 or the simulator.
2. **Sources are interchangeable.** `SimulationDataSource` and `Esp32DataSource` both implement
   `DataSource` (`src/types/source.ts`). Adding a source must not require editing pages.
3. **The engine owns signal state.** `src/engine/ecgEngine.ts` holds the ring buffers, runs the
   filters and the R-peak detector, and publishes telemetry. React components read from it; they
   never filter or detect beats themselves.
4. **No per-sample React updates.** Samples live in typed arrays outside React. Canvas rendering
   pulls from the ring buffer inside `requestAnimationFrame`. React state updates are throttled to
   ~4 Hz telemetry snapshots.
5. **Processing is pure.** Everything in `src/signal/` is a pure function or a small stateful class
   with no DOM, React, or network dependency, so it is unit-testable in Node.
6. **Simulation is labelled.** Any UI surface showing simulated values must carry a visible
   `SIMULATION` marker. Simulated and hardware data must never be merged, averaged, or persisted
   as if identical.
7. **Recordings are local; the live transport may be cloud.** Sessions and settings stay in
   IndexedDB/localStorage — no accounts, and stored sessions are never uploaded. The live ECG
   transport has two interchangeable implementations behind `DataSource`: the local bridge
   (`server/`) and Supabase (`src/data/supabaseSource.ts`). Only device batches reach Supabase, the
   browser holds a read-only publishable key, and the write key stays with the gateway
   (`scripts/cloud-gateway.mjs`). Nothing downstream may care which transport is in use.
8. **The backend is a bridge, not a brain.** It validates and forwards device batches. It performs
   no signal processing and stores nothing on disk.

## 3. Design rules

- Design tokens live in `src/styles/tokens.css` (Tailwind v4 `@theme`) and are derived from
  `design-system/bugatti/DESIGN.md`. Never hard-code a hex value in a component.
- Language: pure-black canvas, white type, **no accent colour**. Emphasis comes from size, tracking
  and case, never from weight (400 only) or hue. Radius is 0 everywhere except pill buttons. No
  shadows, gradients, glassmorphism, decorative glyphs or emoji.
- Three families, three jobs: Saira Condensed for display headlines, EB Garamond (serif) for body
  copy, JetBrains Mono for labels, buttons, numbers. Never mix the roles.
- Status colours (muted green/amber/red/blue-grey) appear only where a real state exists, never as
  brand decoration.
- Numeric readouts use the monospace family with tabular numerals.
- Icons come from `lucide-react` only.
- Motion conveys state change; it never runs for decoration. Respect `prefers-reduced-motion` and
  the in-app 3D toggle.
- Every interactive control must work. No dead buttons, no placeholder links.
- Colour must never imply a medical verdict. Heart/scene colour encodes *signal and monitoring
  status*, never health.

## 4. Coding conventions

- TypeScript strict mode; no `any` in new code (a lint warning is not permission).
- Functional React components, hooks at the top, no class components.
- Files export named symbols; default exports only for route-level page components if needed.
- Keep modules small: signal processing in `src/signal`, I/O in `src/data` / `src/services`,
  persistence in `src/storage`, presentation in `src/features`.
- Comments explain *why* (units, thresholds, trade-offs), not *what*.
- Physical units belong in names: `sampleRateHz`, `rrMs`, `durationMs`.

## 5. Commands

```bash
npm install          # dependencies
npm run dev          # frontend only (http://localhost:5173)
npm run server       # local bridge (ws://127.0.0.1:8787)
npm run dev:all      # both, via concurrently
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest run
npm run build        # typecheck + production bundle
npm run preview      # serve the production build
npm run fake:device  # scripted ESP32 stand-in for protocol testing
npm run gateway      # forward bridge batches to Supabase (SUPABASE_SECRET_KEY in .env)
```

## 6. Safety requirements

- Battery power only when electrodes are attached to a person; never mains-powered or charging
  during a measurement.
- No diagnosis, no treatment advice, no "normal/abnormal heart" claims anywhere in UI or docs.
- A single AD8232 lead cannot assess structural heart health. HRV values are educational.
- Any new feature that could be read as a clinical conclusion must be rejected or reworded.

## 7. Dependency rules

- Pin exact versions for runtime dependencies; verify a package exists and is maintained before
  adding it.
- No dependency for something the platform already provides (use `Intl`, `Canvas`, `WebSocket`).
- New dependencies require a note in `docs/DECISIONS.md`.

## 8. Definition of done

A change is done when: `npm run typecheck`, `npm run lint`, `npm run test` and `npm run build`
pass; the affected page was opened in a real browser and checked; documentation that describes the
changed behaviour was updated; and no safety claim was weakened.
