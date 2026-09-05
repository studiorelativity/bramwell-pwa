# Bramwell — where do I go?

Layer 1. Read on entry, then open exactly one stage contract.

| Task | Stage | Read |
|---|---|---|
| Repo skeleton, types, date core | 01_scaffold | 01_scaffold/CONTEXT.md |
| Auth, Calendar API, categories, cache, writes | 02_data | 02_data/CONTEXT.md |
| Virtualizer, snap, rendering, year view | 03_engine | 03_engine/CONTEXT.md |
| Motion system, inline day, event form | 04_day | 04_day/CONTEXT.md |
| First-run, settings, FAB, PWA, deploy | 05_shell | 05_shell/CONTEXT.md |
| Demo mode, README, licence | 06_demo | 06_demo/CONTEXT.md |
| Habit tracker on Supabase | 07_habits | 07_habits/CONTEXT.md |
| Journal link, legacy note migration | 08_journal | 08_journal/CONTEXT.md |

Held stages (2026-08-30): 07_habits and 08_journal are ON HOLD until
**2026-09-06**, so the calendar can be deployed first. A held stage is skipped
by the entry rule even when its own blockers clear; the hold lifts by date, or
by the human lifting it earlier.

**Parallel iterations (2026-09-05).** Three iteration sessions run beside the
stage table, on worktrees, from one amended spec — the entry rule below does
not apply to them. Open exactly one per session, by name:

| Session | File | Branch |
|---|---|---|
| A — planning layer | `_iteration/planning-layer.md` | `planning-layer` |
| B — demo + beta on-ramp (06 run early) | `_iteration/beta-demo.md` | `demo` |
| C — beta polish | `_iteration/polish.md` | `polish` |

Merge order A, B, C. Their upstream edits are already in `_references/`
(DECISIONS "Planning layer rulings"); an iteration file that asks you to
amend a reference is describing what to record at the end, not a
pre-condition.

Entry rule: find the first stage whose `CONTEXT.md` Status is not CLOSED.
That is the stage. If its Status is BLOCKED, the previous gate has not
been closed by the human — stop and say so; do not start it.

Stage contracts are Inputs / Process / Outputs / Gate. Process is the
same for every stage and lives in `CLAUDE.md` ("How a stage session
runs"); a contract only adds to it.
