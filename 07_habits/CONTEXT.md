# Stage 07 — Habits (Supabase)

**Status: ON HOLD until 2026-09-06 (Sunday).** Held by the human on
2026-08-30 to finish the calendar deployment first. The prior blockers still
stand underneath the hold: 06's gate is not closed and the Supabase manual
setup in `HABITS.md` is not done. Do not start this stage before the hold
lifts, even if those blockers clear first.

## Inputs
- L3: `../_references/HABITS.md` in full
- L3: `SPEC.md` — "Layout details" (marker slots), "Inline day
  expansion", "Settings", "Write orchestration" (pattern to mirror)
- L3: `CONVENTIONS.md`

## Process
As in `CLAUDE.md` "How a stage session runs". Carry-forward items, if
any, are listed here by the human at the previous gate close — not read
from the previous `verification.md`.

## Outputs
- `habits.ts` — the only importer of `@supabase/supabase-js`; session,
  CRUD, DOM-free, no `state.ts` import.
- `state.ts` habit cache (`bramwell.habits.v1`), optimistic toggle with
  rollback, `onCacheChange` carrying habit months.
- `render.ts` per-day completion indicator bottom-right; `day.ts`
  checklist; `chrome.ts` Habits section; demo seed; first-run Connect
  chaining both sign-ins with graceful degradation.
- Pure streak/weekly-count functions with tests across a month boundary
  and a DST change.

## Gate (human)
- Everything under `HABITS.md` "Definition of done", on the deployed
  origin, phone + desktop.
- `output/verification.md`; ruling recorded on year-view habit rendering.
