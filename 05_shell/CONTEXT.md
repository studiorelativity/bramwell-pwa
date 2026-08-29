# Stage 05 — Chrome, PWA, deploy

**Status: BLOCKED** until 04's gate is closed.

## What this stage is
`chrome.ts` (first-run, settings sheet incl. the Colors section and Mood,
FAB, toasts, avatar + reconnect pill), `sw.ts`, manifest and icons to
spec, `public/_headers`, and the first deploy to `cal.no.fail`. Deploying
is part of this stage's gate, not after it.

## Inputs
- L3: `SPEC.md` — "First-run and connection state", "Settings",
  "Categories and customization" (Settings UI), "PWA", "DEPLOY",
  "MANUAL SETUP"
- L3: `CONVENTIONS.md`; `DECISIONS.md` — "shell and chrome", "categories"

## Process
As in `CLAUDE.md` "How a stage session runs". Carry-forward items, if
any, are listed here by the human at the previous gate close — not read
from the previous `verification.md`.

## Outputs
- `chrome.ts` talking only to `auth.ts` and `state.ts` exports, with
  scroll/view callbacks from `main.ts`.
- Colors section: per-row label/colorId/swatch/delete, add dead at 11
  with the reason, colorId invariant enforced in the UI, Mood selector,
  two-step Remove.
- `sw.ts` with the split strategy (hashed cache-first, else
  network-first), no redirected responses cached, `/` as offline
  fallback, production-only registration.
- Cloudflare project configured; env vars set in the dashboard.

## Gate (human, on the deployed origin, phone + desktop, light + dark)
- Cold start signed out → first-run; Connect lands on today. Stale token
  over a warm cache → read-only calendar + reconnect pill.
- Settings persist across reload; sign-out returns to first-run; the
  sheet survives a background refresh.
- Colour rules: no shared colorId reachable; add dead at 11; delete
  leaves Google untouched; rename keeps the key; display hex vs Google
  colour both visible; every mood readable at arm's length.
- Install as PWA; offline open read-only; a write fails visibly and
  rolls back; a subsequent deploy reaches the installed client on the
  next online open with no cache bump.
- FAB clears the last row's Sunday on the notched phone.
- `output/verification.md`.
