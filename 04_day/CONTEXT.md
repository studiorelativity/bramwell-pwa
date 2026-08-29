# Stage 04 — Inline day, motion system, event form

**Status: BLOCKED** until 03's gate is closed.

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
