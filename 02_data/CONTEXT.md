# Stage 02 — Data layer

**Status: OPEN.** Gate 1 closed 2026-08-29; .env.local present.

## What this stage is
`auth.ts`, `gcal.ts`, `categories.ts`, and the cache/persistence/write
orchestration in `state.ts`. No DOM anywhere in these four files.

## Inputs
- L3: `SPEC.md` — "Auth", "Calendar API", "Write orchestration",
  "Categories and customization" (resolution and `sanitize()`, not the
  Settings UI), "Perpetual scroll mechanics" (lazy month loading only)
- L3: `CONVENTIONS.md`; `DECISIONS.md` — "auth and wire", "categories"

## Process
As in `CLAUDE.md` "How a stage session runs". Carry-forward items, if
any, are listed here by the human at the previous gate close — not read
from the previous `verification.md`.

## Outputs
- `auth.ts`: exactly `getToken(forceRefresh?)`, `signIn`, `signOut`,
  `isSignedIn`.
- `gcal.ts`: `listMonth`, `createEvent`, `updateEvent`, `deleteEvent`;
  inclusive/exclusive conversion at this boundary; pagination; one retry
  on 403/5xx.
- `categories.ts`: prefs-backed resolution, `configure()`, `sanitize()`,
  Google colour table, moods, `themeCss()`, `brighten()`, seed twins.
- `state.ts`: `ensureMonthsFor`, `eventsForWeek`, `monthState`,
  `onCacheChange`, prefs, optimistic create/update/delete with rollback.
- A `fetch`-stubbed test for `gcal.ts` (the v3 12-case list: inclusive
  spans, exclusive wire end, round-trip identity, colorId both ways,
  cancelled dropped, timed mapping, pagination, query params, instance
  vs series delete).

## Gate (human, real account)
- Sign in; reload; token renews quietly with no popup.
- A month fetch returns real events; pagination proven by lowering
  `MAX_RESULTS`, then restored.
- **Close the four wire items in `OPEN.md`** here, from the console, not
  later: create one event per seed category and open each in the Google
  Calendar app; create a 3-day all-day event and confirm its end date in
  the app; edit one occurrence of a recurring event; delete a series.
- `output/verification.md`.
