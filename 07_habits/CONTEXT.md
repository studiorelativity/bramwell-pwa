# Stage 07 — Habits (Supabase)

**Status: BLOCKED** until 06's gate is closed and the Supabase manual
setup in `HABITS.md` is done.

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
