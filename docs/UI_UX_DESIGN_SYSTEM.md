# UI/UX DESIGN SYSTEM — CARDIOPULSE

The interface follows the **Bugatti** design analysis supplied by the project owner
(`design-system/bugatti/DESIGN.md`, extracted from bugatti.com). That document is the source of
truth; this file records how it was applied to a live instrument rather than a marketing page.

Runtime tokens: `src/styles/tokens.css` (Tailwind v4 `@theme`). Nothing in a component may hard-code
a hex value — every colour, family and radius comes from a token.

## 0. What changed and why

The first build used a generated clinical-dashboard system: near-black blue surfaces, a cyan accent,
Fira Sans + Fira Code, and 4–10 px radii. It read as a competent monitoring tool but not as a designed
object. The owner asked for the Bugatti language instead, so the system was rebuilt around it:

| Area | Before | Now |
| --- | --- | --- |
| Canvas | `#070B11` blue-black | `#000000` pure black |
| Accent | cyan `#22D3EE` | **none** — white type is the accent |
| Colour vocabulary | cyan / blue / green / amber / red | monochrome + one ice-blue link token; status hues desaturated |
| Display type | Fira Sans 600, tight tracking | Saira Condensed 400, UPPERCASE, 0.055 em tracking |
| Body type | Fira Sans 400 | EB Garamond 400 (serif) |
| Data / labels | Fira Code | JetBrains Mono 400 |
| Radius | 2–10 px | 0 px everywhere; pills only for buttons |
| Elevation | hairline + soft shadows | hairline only; no shadows, no gradients, no washes |
| Nav | left rail with active tint | top bar, tracked monospace links, hairline indicator |

Recorded as decisions D-16 (design language), D-17 (first heart geometry, superseded by D-19) and
D-18 (typefaces), with D-19 (anatomical heart model) in `docs/DECISIONS.md`.

## 1. Brand

| Element | Spec |
| --- | --- |
| Wordmark | `CARDIOPULSE` — JetBrains Mono 400, 11 px, UPPERCASE, **0.42 em** tracking |
| Tagline | "ECG workstation" — EB Garamond italic, muted (in-page footer carries the full tagline) |
| Voice | Instrument-like and factual. No reassurance, no diagnosis, no exclamation marks |
| Signature | Pure-black canvas, tracked uppercase display, a white ECG trace, and a photoreal heart |

There is no logo mark. Bugatti's system carries no decorative element, and an `Activity` glyph inside
a rounded tile was the most "template" thing on the old screen.

## 2. Colour tokens

| Token | Value | Use |
| --- | --- | --- |
| `base` | `#000000` | App background — the only page floor |
| `surface` | `#0B0B0B` | Panels, barely separated from the canvas |
| `surface-2` | `#141414` | Nested blocks, hover rows |
| `elevated` | `#1F1F1F` | Reserved; dialogs stay black with a hairline |
| `border` | `#262626` | Hairlines: dividers, panel outlines, table rows |
| `border-strong` | `#3A3A3A` | Input underlines, active outlines |
| `text` | `#FFFFFF` | Display and primary values (21:1 on black) |
| `text-muted` | `#CCCCCC` | Running text (13.6:1) |
| `text-dim` | `#8A8A8A` | Labels, captions, metadata (5.6:1 — still AA) |
| `accent` | `#FFFFFF` | Alias kept so emphasis utilities resolve to white |
| `accent-soft` | `#C3D9F3` | The system's only chromatic value: inline links and R-peak ticks |
| `good` / `warn` / `danger` / `idle` | `#5FA657` / `#D4A017` / `#BF5B52` / `#9FB0C2` | Technical status only |

**Semantics are fixed.** Colour appears only where a *state* exists: good technical quality, degraded
signal, no signal/link, waiting. It never encodes a health verdict, and it is never used as brand
decoration. The heart is always anatomical crimson for the same reason — a heart that turns green
when the trace is clean would read as a medical conclusion.

## 3. Typography

Three families, three jobs, never mixed — the split *is* the voice.

| Role | Family | Size / weight | Notes |
| --- | --- | --- | --- |
| Page title (h1) | Saira Condensed | 30 px / 400 | UPPERCASE, 0.055 em tracking |
| Modal title | Saira Condensed | 17 px / 400 | UPPERCASE |
| Panel title (h2) | JetBrains Mono | 10 px / 400 | UPPERCASE, 0.22 em tracking |
| Label | JetBrains Mono | 10 px / 400 | UPPERCASE, 0.18 em (`.label-mono`) |
| Body / explanation | EB Garamond | 13.5–15 px / 400 | Sentence case, 1.55 line height |
| Data values | JetBrains Mono | 17 / 26 / 42 / 58 px, 400 | Tabular numerals, mandatory |
| Nav, buttons, badges | JetBrains Mono | 9–11 px / 400 | UPPERCASE, 0.16–0.24 em |

Rules: no bold anywhere (400 only); emphasis comes from size, tracking and case; body copy is never
set in mono; buttons and labels are never set in the display face.

The three Bugatti typefaces are licensed and unavailable, so the documented open-source substitutes
are used, bundled offline with `@fontsource` (no runtime font request):

- Bugatti Display → **Saira Condensed**
- Bugatti Text Regular → **EB Garamond**
- Bugatti Monospace → **JetBrains Mono**

## 4. Space, radius, elevation

- Spacing: 4, 8, 12, 16, 24, 40, 64 px. Page rhythm is `space-y-6` (24 px) with `gap-6` between
  panels; panel headers carry 16/12 px padding.
- Radius: **0 px** for panels, inputs, cards, tables, dialogs, badges, toggles. `9999px` for buttons
  and icon buttons only. The hierarchy is binary by design.
- Elevation: none. No shadow, no blur, no gradient, no glow. Depth comes from the heart render, the
  ECG trace and the hairline grid.
- Panels are `surface` on `base` with a 1 px `border` — a 4 % luminance step, not a card.

## 5. Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ CARDIOPULSE   OVERVIEW ECG HRV SESSIONS REPORTS SETTINGS   STATE 0:00 │ 56 px
├──────────────────────────────────────────────────────────────────────┤
│ Main canvas, max 1680 px, 20–32 px gutters, panels in 1–2 columns     │
│                                                                       │
│ Footer: disclaimer left · context right · wordmark centred            │
└──────────────────────────────────────────────────────────────────────┘
```

≥1024 px: full top nav + two-column workspace · 768–1023 px: nav collapses to short labels ·
<768 px: bottom tab bar (mono, 8 px), single column, heart 340 px tall, ECG 188 px.

## 6. Components

| Component | Rule |
| --- | --- |
| Button | Pill, **transparent fill**, 1 px white outline, mono UPPERCASE 9.5–10.5 px, 0.2 em tracking, 32/40 px tall. Primary inverts to white-on-black on hover; danger uses the muted red outline |
| IconButton | 32 px circle, transparent, hairline only when active |
| Panel | `surface` + 1 px `border`, 0 radius, no shadow, header hairline |
| Stat | `.label-mono` label above, mono value, optional unit; value size 17 / 26 / 42 px |
| Badge | 19 px pill, hairline border, mono 9 px, optional 4 px status dot. No fill, no tint |
| Toggle | 40×16 px square track, square knob; checked = white track, black knob |
| SegmentedControl | Hairline box, square cells, selected cell gets a 1 px white underline |
| Input | Underline only (1 px `border-strong` bottom); focus thickens to white. No box, no fill |
| Modal | Black panel, 1 px strong hairline, no shadow, 0 radius, Escape closes, `role=dialog` |
| Toast | Black, hairline in the status hue, mono title + serif body, `aria-live=polite` |
| Empty state | Icon + display-face title + one serif sentence + one pill action |

## 7. Data visualization rules

- **ECG trace**: white 1.25 px on `#0B0B0B`. Grid 40 ms / 0.5 mV at 4.5 % white, 200 ms / 1 mV at
  12 %. R-peak ticks in ice-blue `#C3D9F3`. Lead-off spans shaded muted red at 16 %.
- **Charts** (RR history, histogram, BPM trend): white series 1.2 px, ice-blue dots, white bars at
  50 %, `#262626` axes, JetBrains Mono 9 px labels.
- Axes never imply a normal range; no bands, no reference lines that could read as clinical.
- Every chart is `role="img"` with a summary label carrying the actual numbers.
- Decimation is min/max per pixel column so a one-sample spike is never lost.

## 8. Motion

- 120–140 ms state changes; 250 ms fade for overlays.
- Heart: 60 ms attack, 300 ms decay, phase-locked to detected R-peaks — never a fixed loop. The
  ventricle squeezes (slight y compression) rather than inflating uniformly.
- `prefers-reduced-motion: reduce` collapses transitions and stops the pulse; the 3D scene can be
  switched off entirely in Settings.

## 9. Accessibility checklist

- Text contrast: white 21:1, muted 13.6:1, dim 5.6:1 on black — all above 4.5:1.
- Non-text contrast: hairline `#262626` is decorative; functional borders use `#3A3A3A` or white.
- Focus: 1 px white outline at 3 px offset, never removed.
- Icon buttons carry `aria-label`; switches expose `aria-checked`; segmented controls `aria-pressed`.
- Waveform is `role="img"` with a text alternative including BPM and quality.
- Toasts `aria-live="polite"`; errors `role="alert"`; skip-to-content link present.
- Every control keyboard reachable; Escape closes dialogs; no keyboard traps.

## 10. Enforced anti-patterns

No accent colour · no bold type · filled primary buttons · rounded cards · drop shadows ·
glassmorphism · gradients · decorative glyphs or emoji · placeholder links · colour-only status ·
non-tabular changing numbers · motion without meaning · medical verdict language.
