# Stage 04 — Inline day, motion system, event form

**Status: CLOSED 2026-08-30.** Gate 4 passed on device; rulings promoted. See
`output/verification.md`. Two gate rows were deferred by the human's
decision, not failed: 60fps on a mid phone (row 2, blocked by the
signed-out-refetch loop), and `grid-template-columns` interpolation on iOS
Safari (row 9, a disclosed Chrome-only limitation — see `SPEC.md` "Scroll
engine API").

## What this stage is
The primitive first, then its consumer: `motion.css` (tokens, three
elevation levels, the enter/exit utility, reduced-motion), then hover
lift on cells, then `day.ts` — inline day expansion carrying the event
list and the add/edit form. Habit and journal rows are stubs with a
reserved slot; their stages fill them.

## The crux
`scroll.ts` must support exactly one variable-height row with an animated
delta. If the plan cannot do it cleanly, stop and revise this contract —
do not fake it with an overlay.

## Inputs
- L3: `SPEC.md` — "Inline day expansion", "Motion", "Visual direction —
  Night Depth" (hover, elevation), "Event form", "Write orchestration"
- L3: `CONVENTIONS.md` (hit-test rule, transient-UI rule);
  `DECISIONS.md` — "redesign", "Rejected" (drawer, row scaling)

## Process
As in `CLAUDE.md` "How a stage session runs". Carry-forward items, if
any, are listed here by the human at the previous gate close — not read
from the previous `verification.md`.

### Carry-forward from the stage-03 gate close (2026-08-29)
Read these as part of this stage's contract; do not go digging in stage 03's
`verification.md` for them.

- **`motion.css` already exists** with the tokens, three elevation levels,
  the `.enter[data-in]` utility and the reduced-motion collapse; hover lift
  on cells is built and compositor-only. This stage's "primitive first" is
  therefore mostly done — extend `motion.css` (expand/collapse durations,
  stagger) rather than rewriting it, and keep the grep clean.
- **`scroll.ts` has `expanded: Expanded = null` as a local const in
  `mount`**, and every position goes through `posOf`/`heightOf`/`weekAtY`,
  which already take it. The maths are proven under node. What this stage
  adds is a `ScrollController` setter (SPEC "Scroll engine API" needs the
  signature first) and the animated `delta`; whichever mechanism drives that
  animation (rAF or CSS) decides whether its duration lives in `scroll.ts`
  or `motion.css` (SPEC "Motion", stage-04 note).
- **`render.renderWeek(node, week, spans, rowH)` fills a recycled node** and
  is the seam: `main.ts`'s `fillRow` calls it, and the expanded row is
  substituted there without `scroll.ts` or `render.ts` knowing about
  `day.ts`.
- **Day clicks are a no-op today** and `main.ts` keeps the DEV harness
  (`#devbar`, `window.bramwell`) — stage 05 deletes it. `window.bramwell`
  exposes `state` and `applyTheme` but not the scroll controller.
- **`state.ts` rethrows but does not toast** (stage-02 ruling); the toast is
  this stage's to raise, and `chrome.toast` is still a stub until stage 05 —
  decide where the interim error surface lives.
- **Cache-change repaints are coalesced per frame in `main.ts`** and
  `ensureMonthsFor` runs only on a range move; an open form must survive
  both (CONVENTIONS transient-UI rule: `refresh()` no-op while a form is
  open).
- **`scripts/shot.mjs` is the evidence harness**: seeded `localStorage`,
  CDP, `PORT=` env, `npm run shot`. Extend it for the expand/collapse
  claims rather than writing a second one.

## Outputs
- `motion.css`; no transition/animation literal anywhere else (grep-proven).
- `scroll.ts` expanded-week support; `render.ts` expanded-row rendering.
- `day.ts`: event rows (category label, not name), form with validation,
  category chips from the live list, scope picker for recurring, series
  delete confirm, error surfacing in form + toast; `refresh()` no-op
  while the form is open; `openAdd(day)` for the FAB.
- `main.ts` wiring: one day open, Escape collapses, scroll does not.
- Ruling recorded: phone ≤560px inline-full-width or sheet.

## Gate (human)
- 60fps expand/collapse on the MacBook and a mid phone.
- Reduced-motion path verified.
- Every form control passes `elementFromPoint()` at its centre.
- Create / edit-occurrence / delete-series round trips through the form
  against the real account.
- Type in the form, wait past a background refresh, text survives.
- `output/verification.md`.
