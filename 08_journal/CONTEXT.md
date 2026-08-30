# Stage 08 — Journal link, legacy note migration

**Status: ON HOLD until 2026-09-06 (Sunday).** Held by the human on
2026-08-30 to finish the calendar deployment first. The prior blocker still
stands underneath the hold: 07's gate is not closed.

## Inputs
- L3: `../_references/JOURNAL.md` in full
- L3: `SPEC.md` — "Inline day expansion"; `OPEN.md` journal items

## Process
As in `CLAUDE.md` "How a stage session runs". Carry-forward items, if
any, are listed here by the human at the previous gate close — not read
from the previous `verification.md`.

## Outputs
- `journal.ts`: URI builder from `DayNumber` + prefs (vault name, path
  template); no network, no DOM.
- `day.ts` Journal row with open-in-Obsidian; one-per-session notice when
  the scheme cannot open.
- A vault-side daily-note template matching `JOURNAL.md`.
- Ruling on the presence marker (link-out only vs `journal_days` index),
  and if the index is chosen, the vault-side script and the marker.
- One-off migration script for v3 `daynote` events → vault files, run by
  hand, or a recorded decision to leave them.

## Gate (human)
- `JOURNAL.md` "Definition of done" on the Mac and the iPhone.
- `output/verification.md`. Rebuild complete; remaining items in
  `OPEN.md` are either closed or explicitly deferred with a date.
