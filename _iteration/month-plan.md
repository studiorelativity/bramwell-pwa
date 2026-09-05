# Iteration D: Planning layer in the month view (2026-09-05)

**Session type: iteration. Does not open until A has merged to `main`.**
SPEC "Planning layer — Both views" and DECISIONS "The planning layer works in
both views". A built the strip, paint, conflict and erase for the year view
against a host interface (see `_iteration/planning-layer.md` "Build for the
month view without building it"). You mount the same controller on the month
grid.

Run on a worktree: `git worktree add ../bramwell-D -b month-plan` from `main`
after A lands. Your files: `src/render.ts` (month cells as paint hosts),
`src/main.ts` (mount + the strip's home), `src/plan.ts` only if a helper is
genuinely missing, `src/style.css` `.plan*` rules only, a new file for the
lifted controller **after** adding it to SPEC "File layout".

## Brainstorm first (CLAUDE.md process)
- Where the strip lives in the month view: the header row, or a row that
  scrolls with the grid. Phone width decides it; measure, then rule in
  DECISIONS.
- Paint versus scroll: the month view scrolls on drag. `touch-action: none`
  and pointer capture only while a chip is selected, exactly as the year view
  does; exiting mode restores scrolling. Wheel must still scroll in mode.
- The expanded day: paint mode collapses it, or is unavailable while one is
  open. Pick one, record it.

## Verification
Same instrument as A's (paint a run, assert the cache and the strip; paint a
blocked run, assert the toast), driven on the month grid. Hit-test every
control. `_iteration/output/month-plan.verification.md`.
