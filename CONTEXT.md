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

Entry rule: find the first stage whose `CONTEXT.md` Status is not CLOSED.
That is the stage. If its Status is BLOCKED, the previous gate has not
been closed by the human — stop and say so; do not start it.

Stage contracts are Inputs / Process / Outputs / Gate. Process is the
same for every stage and lives in `CLAUDE.md` ("How a stage session
runs"); a contract only adds to it.
