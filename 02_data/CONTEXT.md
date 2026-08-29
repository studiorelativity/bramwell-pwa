# Stage 02 — Data layer

**Status: CLOSED.** Gate 2 passed and closed 2026-08-29 on the real account.
All four `OPEN.md` wire items closed; 16 rulings promoted to `DECISIONS.md`
("Stage 02 gate close") and `SPEC.md`. `output/verification.md` is now a
record, not an input.

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
  `isSignedIn`, `invalidateToken` (five — see SPEC "Auth", amended by human
  ruling 2026-08-29).
- `gcal.ts`: `listMonth`, `createEvent(draft, colorId, token)`,
  `updateEvent(id, changes, colorId, token)`, `deleteEvent(id, token)` —
  no `WriteScope` on the wire; returns
  `StoredEvent`, not `CalendarEvent`; inclusive/exclusive conversion at
  this boundary; pagination; one retry on 403-rate-limit/429/5xx;
  throws `GcalError { status, body }`.
- `categories.ts`: prefs-backed resolution, `configure()`, `sanitize()`,
  Google colour table (exported), moods (**mechanism only — values are
  stage 03**), `themeCss()`, `brighten()`, seed twins.
- `state.ts`: `ensureMonthsFor`, `monthState`, `eventsForMonth`,
  `spansForWeek`, `prefs`/`savePrefs`, `onCacheChange`, optimistic
  create/update/delete with rollback, and the `withToken` 401 retry.
  `loadCache`/`saveCache` are private. See SPEC "State API".
- `main.ts`: an `import.meta.env.DEV`-only harness — a Connect button
  (GIS needs real user activation, which a devtools call lacks) and a
  `window.bramwell` handle, so the gate below can be driven. Stage 05
  replaces it with the real first-run screen.
- A `fetch`-stubbed test for `gcal.ts` (the v3 12-case list: inclusive
  spans, exclusive wire end, round-trip identity, colorId both ways,
  cancelled dropped, timed mapping, pagination, query params, instance
  vs series delete), added to `selftest.ts`, which becomes `async`. One
  surface: `npm run selftest` and `/?selftest` both cover it.

## Gate (human, real account)
- Sign in; reload; token renews quietly with no popup.
- A month fetch returns real events; pagination proven by lowering
  `MAX_RESULTS`, then restored.
- **Close the four wire items in `OPEN.md`** here, from the console, not
  later: create one event per seed category and open each in the Google
  Calendar app; create a 3-day all-day event and confirm its end date in
  the app; edit one occurrence of a recurring event; delete a series.
- `output/verification.md`.
