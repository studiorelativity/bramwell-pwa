# Stage 02 — verification

**Status: code complete, awaiting the human gate.** Rulings 9 and 10 were
resolved by human ruling on 2026-08-29 and are already written upstream; the
remaining rulings still await gate close. Everything below the
"Gate" heading is the human's to run against a real Google account; those
rows are unfilled by design.

Branch `stage-02-data`, 14 commits from `266b80b`. Suite grew 9 → 42 cases.

## Automated criteria (agent-run, evidence inline)

| Criterion | Result | Evidence |
|---|---|---|
| `npm run selftest` | PASS | `42/42`, exit 0 |
| `npx tsc --noEmit` | PASS | `TSC_CLEAN`, no diagnostics |
| `npm run build` | PASS | `✓ built in 121ms`; chunks `index`, `state`, `selftest`, plus css |
| Time-zone independence | PASS | 42/42 under `UTC`, `America/New_York` (−05:00), `Asia/Kolkata` (+05:30), `America/St_Johns` (−03:30), `Pacific/Chatham` (+12:45), `Australia/Lord_Howe` (+10:30). Two half-hour and one quarter-hour offset, so `rfc3339Local`'s offset formatting is proven by execution, not by inspection. |
| Suite is order-independent | PASS | Re-reviewer ran `[...cases].reverse()` → `42/42`, then restored. Every anchor-pinning case now saves and restores the anchor in `finally`. |
| `/?selftest` in a real browser | PASS | headless Chrome `--dump-dom` → `data-selftest="pass"`, dumped `<pre>` carries all PASS lines and the count |
| DEV harness absent from production | PASS | `grep -rc 'harness-connect' dist/assets/*.js` → `index:0 state:0 selftest:0`. `import.meta.env.DEV` is statically false in a build, so Vite drops the branch. |
| Connect button is reachable (`elementFromPoint`) | PASS | Same-origin iframe, `document.elementFromPoint()` at the button's centre resolves to `#harness-connect` → `HIT connect`, in **both** colour schemes. See ruling 9 on how dark was driven. |

### The 12-case wire suite (contract requirement)
All twelve behaviours are covered by 13 `gcal:` cases: inclusive spans on read;
exclusive wire end on write; round-trip identity; colorId both ways; cancelled
dropped; timed mapping including a midnight crossing; pagination with a page
cap; query params with a local-offset window and the December year-roll;
instance vs series delete; and the retry policy.

## Rulings the spec left open (promote to `DECISIONS.md` at gate close)

1. `gcal.ts` returns `StoredEvent`, never `CalendarEvent`; category resolution
   is `state.ts`'s alone. Resolving in `gcal` would make it import
   `categories.ts` and depend on `configure()` having run.
2. `WriteScope` does not reach the wire; `state.ts` picks the id.
   `gcal.updateEvent` keeps an explicit `colorId` argument, because
   `EventDraft.category` is a *name* and `gcal.ts` may not resolve it.
3. 429 joins the retry set; a 403 is retried only on a rate-limit reason.
   `listMonth` caps the `nextPageToken` loop at 20 pages.
4. `selfTest()` is async and covers `gcal.ts` under a stubbed `fetch` — one
   surface, run by both `npm run selftest` and `/?selftest`.
5. Cache staleness is 5 minutes; `saveCache` is debounced 250ms; no eviction
   (quota swallowed, per the existing decision). A failed refresh sets `error`
   but keeps the prior events.
6. A timed event's span is its start day only, even when it crosses midnight.
7. `auth.ts` reads `globalThis.google` — the same binding as `window.google` —
   so a node test can install a fake without clobbering `window`.
8. `state.ts` rolls back and **rethrows but does not toast**. SPEC's prose says
   "roll back, toast, rethrow", but `chrome.toast` is DOM-bearing and
   `state.ts` runs under node in the selftest. The caller raises the toast;
   stage 04 wires it.
9. **RESOLVED by human ruling 2026-08-29 — `CONVENTIONS.md` amended.**
   CONVENTIONS mandated headless Chrome under both
   `--blink-settings=preferredColorScheme=1` and `=2`, but `=2` crashes this
   machine's Chrome 151.0.7922.175 renderer (`VALIDATION_ERROR_UNKNOWN_ENUM_VALUE`,
   mojo `bad_message` reason 123), reproducibly, and the process then hangs.
   Reproduced independently by two agents. **Resolution:** CDP
   `Emulation.setEmulatedMedia` is now the PRIMARY method for driving dark mode
   in headless verification; the `=2` flag is no longer sanctioned. Written into
   `CONVENTIONS.md` "Verification". Nothing further to promote at gate close.
10. **RESOLVED by human ruling 2026-08-29 — `SPEC.md` "Auth" amended, and the
    code now implements it.** SPEC said a 401 leads to `getToken(true)` once
    "then clear and surface. Never a dead state", while also requiring `auth.ts`
    to export exactly four names — leaving `withToken` able to retry but not to
    clear, so two consecutive 401s left `isSignedIn()` true and stage 05's
    reconnect pill would never appear. **Resolution:** `auth.ts` now exports
    exactly **five** names, adding `invalidateToken()` — a local-only clear of
    the cached token and expiry, with no revoke and no client reset. Revoke is
    wrong for a merely-rejected token; and unlike `signOut()`, a later quiet
    renewal MAY sign back in — if it succeeds the grant was still good, and if
    it fails `isSignedIn()` stays false so the pill stands. SPEC's 401 sentence
    now reads: any 401 → `getToken(true)` once; if the retry also 401s,
    `invalidateToken()` then rethrow. `state.ts`'s `withToken` implements it,
    and the selftest case asserts `isSignedIn() === false` after two consecutive
    401s (and `true` after a recovered one). The assertion was proven
    non-vacuous by removing the `invalidateToken()` call: `41/42`, failing with
    "two consecutive 401s left isSignedIn() true — the dead state SPEC forbids".
    Nothing further to promote at gate close.
11. `state.ts` gains `_resetForTest`, `_flushForTest`, `_settleForTest`,
    extending stage-01 ruling 2. `auth.ts` gains no test-only export
    (`invalidateToken` is production API, added by ruling 10, not a test hook).
12. `brighten()`'s spec constants (lightness floor 0.62, saturation cap 0.72)
    stand; the *test* tolerance was widened to ±5e-3 because `brighten` emits
    an 8-bit hex and re-measuring it round-trips saturation with quantization
    error of ~1/255.
13. `sanitize()` also validates `name` against `/^[a-z0-9-]{1,32}$/`. `name`
    reaches a `[data-cat="…"]` selector and a `--cat-…` property, so a
    corrupted prefs blob could otherwise break or override the theme sheet.
14. Google's 11 colour hexes are transcribed from memory and **unverified** —
    the gate's "open each in the Google Calendar app" step is what confirms or
    corrects them.
15. Mood values beyond `warm` are deferred to stage 03; the four band tokens
    are not emitted at all. No palette was invented here.

## New open items (add to `OPEN.md` at gate close)

- **GIS response ordering.** `auth.ts` pairs concurrent token requests with
  their responses FIFO, because the GIS callback carries no correlation id.
  If GIS ever resolves two concurrent `requestAccessToken()` calls out of
  request order, the earlier settler receives the wrong response and the later
  one hangs. Demonstrated by probe. It narrows a strictly worse prior design
  (a single settle slot could not survive concurrency at all), so it was not
  treated as a regression — but the assumption is unproven.
- `gcal.ts:99-100`'s comment still says "state.ts passes the whole draft",
  which the final fix wave made false. The invariant holds by other means;
  the stated reason does not. Documentation only.

## Not tested

- **Anything against a real Google account.** Every wire behaviour here is
  proven against a stubbed `fetch` only. That is exactly what the gate closes.
- The 10s GIS load timeout, and `signOut()`'s revoke against the real endpoint.
- Real popup/user-activation behaviour; the harness button exists precisely
  because devtools calls lack activation.
- A month with more than 250 events at the real `MAX_RESULTS`.
- DST-boundary *timed writes* (the DST-safe date stepping is covered; a write
  landing on a spring-forward hour is not).
- Whether the transcribed Google colour hexes match Google's actual palette.
- Verified out of band during review rather than by a suite case, and worth
  knowing: quota-exceeded swallowing (probe with a throwing `setItem` — prefs
  and the debounced cache flush both survive), the offline path
  (`navigator.onLine === false` → rejects with the offline message, **zero**
  network calls, overlay rolled back), and malformed cache blobs (five shapes
  discard correctly; one shape — `events` not an array — yields a `ready`
  month of nulls, unreachable while `state.ts` is the only writer).

## Gate (human, real account) — unfilled

| Criterion | Result | Evidence |
|---|---|---|
| Sign in; reload; token renews quietly, no popup | | |
| A month fetch returns real events | | |
| Pagination proven by lowering `MAX_RESULTS`, then restored | | |
| OPEN #1 — one event per seed category, each opened in the Google app | | |
| OPEN #2 — a 3-day all-day event's end date in the Google app | | |
| OPEN #3 — edit one occurrence of a recurring event | | |
| OPEN #4 — delete a series | | |

### Read this before running the gate

1. **`MAX_RESULTS` cannot be lowered from the console.** `window.bramwell.gcal`
   is an ES module namespace object, so its properties are non-writable and an
   assignment silently no-ops. Edit `src/gcal.ts:8`, let HMR reload, then
   restore. Keep it above `eventsInMonth / 20`, or `MAX_PAGES` throws.
2. **Editing one occurrence: pass `repeat: 'none'` in the draft.** `state.ts`
   now strips `repeat` on every update (per DECISIONS "repeat is disabled when
   editing an existing event"), so this is belt-and-braces — but do not expect
   a recurrence change on an instance to work; Google rejects it.
3. **Do not try a series *edit* as a bonus check.** Series scope deliberately
   sends no dates, so it is safe now, but the contract asks only for a series
   *delete*.
4. `window.bramwell` exposes `auth`, `gcal`, `categories`, `state` and
   `applyTheme`. It does not expose `dates` — build a `DayNumber` with
   `state.today()` / `state.dayAt(0, 0)` arithmetic, and note there is no brand
   check at `state.createEvent`, so a `Date` or ISO string would slip through.
5. If Connect reports a failure on the very first click of a cold load, click
   again before recording anything. That path was fixed this stage; a
   second-click-only success would mean the fix regressed.
