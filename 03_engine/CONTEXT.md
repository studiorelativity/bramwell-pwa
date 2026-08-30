# Stage 03 — Scroll engine, rendering, year view

**Status: CLOSED 2026-08-29.** Gate 3 passed on device; rulings promoted. See output/verification.md.

## What this stage is
`scroll.ts`, `render.ts`, `year.ts`, the calendar and year styles in
`style.css`, wiring in `main.ts`. No day expansion yet — a click on a day
is a no-op this stage.

## Inputs
- L3: `SPEC.md` — "The core interaction", "Year view", "Layout details",
  "Visual direction — Night Depth" (tiles, bands via surface value, today
  ring, bars and chips; NOT hover or expansion), "Perpetual scroll
  mechanics", "Categories" (rendering consumers only)
- L3: `CONVENTIONS.md`; `DECISIONS.md` — "scroll and render", "Rejected"

## Process
As in `CLAUDE.md` "How a stage session runs". Carry-forward items, if
any, are listed here by the human at the previous gate close — not read
from the previous `verification.md`.

### Carry-forward from the stage-02 gate close (2026-08-29)
Read these as part of this stage's contract; do not go digging in stage 02's
`verification.md` for them.

- **The mood palette is yours.** `categories.themeCss()` ships the mechanism
  with a `MOODS` table holding `warm` only — the other four ids resolve to
  it — and the four band tokens are not emitted at all. Their values live in
  the design canvas that SPEC "Visual direction" defers to and which is not
  in the repo. Fill `MOODS` and emit the band tokens here. Stage 02
  deliberately invented no palette; do not inherit one by guesswork.
- **`main.ts` holds a DEV-only harness** (a Connect button, a Sign out
  button, a status line and a `window.bramwell` handle, all behind
  `import.meta.env.DEV`). It is stage 05's to delete when it builds the real
  first-run screen. Leave it alone; it is what makes a gate runnable.
- **`main.ts` calls `categories.configure()` at bootstrap only.** SPEC says
  "and again on any prefs change", which is not achievable yet: `state.ts`
  exposes no prefs-change subscription and there is no Settings UI until
  stage 05. If this stage adds a prefs writer, wire the re-`configure()` and
  re-emit the theme `<style>` with it.
- **`ensureMonthsFor(weeks)` exists and works; deciding WHEN to call it is
  yours.** SPEC "Perpetual scroll mechanics" wants months loaded as weeks
  come within ~8 weeks of the viewport, both directions. Stage 02 owns only
  the rule: fetch when `absent`, `error`, or `ready` and older than 5
  minutes; skip `loading`; concurrent callers coalesce.
- **`monthState(key)` is the render-facing load state** (`absent | loading |
  ready | error`). A failed refresh keeps the prior events, so an `error`
  month may still have content to draw.
- **`spansForWeek(week)` returns `EventSpan[]` already deduped and clipped**,
  with `continuesBefore`/`continuesAfter` computed against the unclipped
  event. Lane packing is this stage's, on its own `PackedSpan`. A timed
  event's span is its start day only, even when it crosses midnight.
- **Verification: drive colour scheme with CDP `Emulation.setEmulatedMedia`.**
  `--blink-settings=preferredColorScheme=2` crashes Chrome 151's renderer
  reproducibly and is no longer sanctioned — see `CONVENTIONS.md`.
- **A finding worth reusing:** `gcal.ts` calls bare `fetch(...)` and never
  captures it at module scope, which let the gate count real API requests by
  installing a `window.fetch` wrapper from the console. The same trick works
  for anything this stage needs to count at runtime.

## Outputs
- Virtualizer with 14 recycled rows, transform placement, half-month
  anchors at `SNAP_ALIGN 0.5`, 15/30/45 modulus, the tuned constants at
  the top of `scroll.ts`, the iOS double-tap suppression set.
- `render.renderWeek(node, week, spans)` — FILLS a recycled node (supersedes
  the stage-01 stub's `renderWeek(week, spans): HTMLElement`). Lane packing
  (longest-first, deterministic, wrapping bars, title once, continuations),
  timed chips, month badges, "+N", header range label with cross-fade,
  Today button, reserved avatar slot for stage 05.
- Year view: 28/14/7 columns (**phone defaults to 14, not 7** — puts
  `OPEN.md`'s "7 columns is a long scroll" question on this stage's gate),
  first-row indent, 3 bars per cell, hover panel that survives repaints,
  tap-driven on touch, year steppers.
- Headless-Chrome evidence at 390×844, 1440×900, 1920×1200: row spacing
  equals row height; boundary y equals content centre; a 21-day event
  wraps three rows with one title; bands split mid-row at a month start.

## Gate (human, on device)
- Flick three months: settles softly on a centred anchor; header updates.
- Double-tap never zooms on the phone.
- 15/30/45 each land on valid anchors.
- No day number clipped at any window width.
- Year view: 365 days without scrolling on the desktop; hover panel keeps
  up and flips at edges; tap flow on the phone.
- `.week` count stays 14 after scrolling a year back.
- `output/verification.md`, including the tuned-by-feel table.
