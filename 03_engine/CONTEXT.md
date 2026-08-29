# Stage 03 — Scroll engine, rendering, year view

**Status: BLOCKED** until 02's gate is closed.

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

## Outputs
- Virtualizer with 14 recycled rows, transform placement, half-month
  anchors at `SNAP_ALIGN 0.5`, 15/30/45 modulus, the tuned constants at
  the top of `scroll.ts`, the iOS double-tap suppression set.
- Lane packing (longest-first, wrapping bars, title once, continuations),
  timed chips, month badges, "+N", header range label with cross-fade,
  Today button.
- Year view: 28/14/7 columns, first-row indent, 3 bars per cell, hover
  panel that survives repaints, tap-driven on touch, year steppers.
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
