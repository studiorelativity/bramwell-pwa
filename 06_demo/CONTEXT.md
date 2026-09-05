# Stage 06 — Demo mode, README, open-source prep

**Status: CLOSED 2026-09-05.** Built early as iteration B on branch `demo`; the human passed the gate on the dev server (`?demo`) the same day; merged to `main` and deployed. Rulings promoted to DECISIONS "Gate close — the three parallel iterations".

## Inputs
- L3: `SPEC.md` — "Demo mode"; `DECISIONS.md` — demo rulings

## Process
As in `CLAUDE.md` "How a stage session runs". Carry-forward items, if
any, are listed here by the human at the previous gate close — not read
from the previous `verification.md`.

## Outputs
- `enableDemo` / `exitDemo` / `isDemo` in `state.ts`; deterministic seed
  covering every render path; `DemoError` before the optimistic apply;
  demo pill in the avatar slot; `?demo` entry; demo customization in
  memory only; `onDemoExit` re-runs `configure()`.
- `README.md` (product, run, deploy-your-own, build record), `LICENSE`
  (MIT, Studio Relativity).

## Gate (human)
- `/?demo` in a private window: populated, zero googleapis.com requests,
  saves reject with the demo message, Connect exits into real sign-in,
  reload lands on first-run, localStorage untouched after a full demo
  editing session.
- `output/verification.md`.
