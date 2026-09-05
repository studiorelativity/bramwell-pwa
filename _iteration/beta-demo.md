# Iteration B: Demo mode + beta on-ramp (2026-09-05)

**Session type: stage 06 run early, as an iteration.** 06_demo is BLOCKED on
05's human gate. The human is running 05's gate checklist on the deployed
origin in parallel with this session; do not wait for it and do not run it.
If 05's gate fails on something you can fix in your files, fix it and note it
in verification; otherwise record it and move on.

Read: `06_demo/CONTEXT.md`, `SPEC.md` "Demo mode" (including the 2026-09-05
planning bullet), "First-run and connection state"; `DECISIONS.md` "shell and
chrome" demo rulings and "Planning layer rulings" (the session split).

Run on a worktree: `git worktree add ../bramwell-B -b demo`. Your files:
`src/state.ts` (demo seed, `enableDemo`/`exitDemo`/`isDemo`, `DemoError`),
`src/gcal.ts` **only if** a demo guard must live at the network boundary
(prefer inert paths in `state.ts`), `src/chrome.ts` **only** the first-run
"Try the demo" button (enable it, remove the "later release" note) and the
"Demo · Connect" pill in the avatar slot, `src/main.ts` for `?demo` entry
and `onDemoExit` → `configure()`, `README.md`, `LICENSE`. Session C owns
first-run copy/layout and the sheet; session A owns categories. Merge order
is A, B, C — rebase on A before you seed the planning categories (step 4);
until then seed events only.

## Build order
1. `DemoError`; `enableDemo()` sets a module flag; `ensureMonthsFor` and
   every fetch path are inert under it; `createEvent`/`updateEvent`/
   `deleteEvent` throw `DemoError` BEFORE the optimistic apply (DECISIONS:
   offline errors fire after it, demo before it). Selftest both orders.
2. Seed: mulberry32, fixed seed, anchored to `today()`, ~17 months, every
   render path listed in SPEC "Demo mode". Write into the in-memory cache
   only; `saveCache` is a no-op in demo. Selftest: zero `localStorage`
   writes across a demo session (stub `storage()`).
3. Entry: `?demo` and the first-run button. Pill in the avatar slot; pill
   click and any Connect exits demo and calls `signIn()`. Reload lands on
   first-run (nothing persisted).
4. **After rebasing on A:** `vacation` (colorId 7) and `blackout` (colorId
   11, blocks) are now IN the seed (amended 2026-09-05); demo `configure()`s
   the seed with `budgetDays: 30` set on `vacation` in memory only, and seeds
   a few Vacation runs and one Blackout block in the current year so the
   strip reads mid-budget. If A has not landed when you get here, ship without
   it and record it in verification as the one open item.
5. README: what it is (the wall-calendar framing, one paragraph), run,
   deploy-your-own (Cloudflare + the OAuth origin rules from SPEC "MANUAL
   SETUP" and "DEPLOY"), the build record (stage table). LICENSE: MIT,
   Studio Relativity.

## Beta on-ramp facts to put in README (human must act on them)
- The OAuth consent screen is in Testing: every tester's Gmail must be
  added as a test user in Cloud Console (max 100); they will see Google's
  "unverified app" interstitial and must click through. Consent expires
  periodically; re-clicking Connect fixes it.
- Demo is the no-sign-in path. Point testers at `/?demo` first.

## Verification
`06_demo/CONTEXT.md` Gate, verbatim, plus: a paint in demo (if A landed)
rejects with the demo message and leaves the strip unchanged. Write
`06_demo/output/verification.md`. Do not flip 06's Status past BUILT — the
human closes gates.
