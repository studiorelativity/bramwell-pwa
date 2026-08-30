# Stage 05 — Chrome, PWA, deploy

**Status: OPEN.** Stage 04's gate closed 2026-08-30.

## What this stage is
`chrome.ts` (first-run, settings sheet incl. the Colors section and Mood,
FAB, toasts, avatar + reconnect pill), `sw.ts`, manifest and icons to
spec, `public/_headers`, and the first deploy to `bramwell.no.fail`. Deploying
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

### Carry-forward from the stage-04 gate close (2026-08-30)
Read these as part of this stage's contract; do not go digging in stage 04's
`verification.md` for them.

- **`chrome.toast` is built and is `role="alert"`.** `chrome.mount` is still
  a stub. Toasts belong to `chrome.ts` per the file layout; build the rest of
  the shell around the existing toast rather than moving it.
- **`main.ts` still carries the DEV harness** (`#devbar`, `window.bramwell`)
  — this stage deletes it. `window.bramwell` now also exposes `ctl` (the
  scroll controller) and `day`, in addition to `state` and `applyTheme`, so
  check all four before removing anything that reads them.
- **The signed-out refetch loop is now observed on device, not just
  predicted.** iOS Safari over LAN, signed out, with only one month cached:
  every other month in view asks for a token, GIS tries a popup mobile
  Safari blocks without a gesture, the failure repaints, and the cycle
  repeats — dozens of errors per second, self-sustaining while the view
  moves. Stage 05 owns connection state and decides whether `error` becomes
  sticky while signed out; see `OPEN.md` "Signed-out refetch pressure" for
  the full trace. It also blocked the stage-04 phone 60fps measurement, so
  seed the cache across the whole visible window before trusting any
  on-device timing.
- **`day.openAdd(day)` exists for the FAB and only opens a form for the
  already-shown day.** It is not itself the FAB — this stage builds that —
  and its doc comment currently overstates what "Whole series" does in the
  form (the date/time and all-day fields stay editable there even though
  `state.ts` silently drops them from a series write; see `OPEN.md`,
  "final fix wave").
- **Two stage-04 gate rows were deferred, not passed, and are this stage's
  to pick up:** 60fps on a mid phone (blocked by the refetch loop above, not
  measured), and `grid-template-columns` interpolation on iOS Safari (Chrome
  findings are a recorded limitation in `SPEC.md` "Scroll engine API"; iOS
  itself is untested on any Safari engine). Both are dated 2026-08-30 in
  `OPEN.md`.

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
