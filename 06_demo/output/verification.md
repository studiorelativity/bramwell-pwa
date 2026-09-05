# Stage 06 — verification (run early as iteration B, 2026-09-05)

**Status: BUILT.** The gate is the human's; nothing below flips it. Branch
`demo`, rebased on `origin/planning-layer` (session A landed mid-session), six
commits beyond it. `npm run selftest` **65/65** (five demo cases among them);
`npx tsc --noEmit` exit 0; `npm run build` clean, `dist/sw.js` with 8 precached
paths, nothing bumped by hand. 05's gate was not waited for (brief).

Evidence harness: `PORT=<port> npm run shot:demo` (`scripts/shot-demo.mjs`) —
the same CDP driver as `shot.mjs` but with **no localStorage seed script**,
because demo is the cold-profile path and the gate says "in a private window".
A fresh `--user-data-dir` per run is that window. Network is captured from
before the first navigation. Run against the Vite dev server on port 5173
(derived from its own output; 5173 was free this time, 5175 the time before),
Chrome 151 headless, 1440×900 light and dark via `Emulation.setEmulatedMedia`,
then 390×844 dark. The field values below are the evidence, not an exit code.

---

## 1. The gate, verbatim, with results

> `/?demo` in a private window: populated, zero googleapis.com requests, saves
> reject with the demo message, Connect exits into real sign-in, reload lands
> on first-run, localStorage untouched after a full demo editing session.

| Criterion | Result | Evidence (`shot:demo`, run 3, after the rebase) |
|---|---|---|
| Populated | **pass** | 24 `.bar` and 42 `.chip` in the first render window at 1440×900 (23 bars at 390×844); `monthState(this month) === 'ready'`; a month 900 days back stays `absent` (unseeded months are inert, SPEC). Seed: 318 unique events over 17 months, 15–27 per month. |
| Zero googleapis.com requests | **pass** | 124 requests over the whole run; hosts `localhost:5173`, `accounts.google.com` (the GIS `<script>` in `index.html`, and the sign-in attempted at exit), and one `data:`/blank. `googleapis.com`: **0**. |
| Saves reject with the demo message | **pass** | Open a day (pointer sequence), `.dp-add` hit-tests, form opens, `.dp-save` hit-tests, click: `.toast` text and `.dp-err` text both exactly `Demo — connect your Google Calendar to save.`; the form stays open (as any failed save does); `.dp-ev` count unchanged; **no bar or chip carrying the typed title was painted in any of 60 polled frames** — the refusal is before the optimistic apply, observed, not just asserted by the selftest. |
| Connect exits into real sign-in | **pass, as far as headless can go** | `#demo-pill` hit-tests; click → synchronously `isDemo() === false` and storage still empty; pill gone; `#firstrun` visible (cold cache) behind the attempted sign-in; the toast reads `popup_failed_to_open` — GIS's own error, because headless Chrome cannot open the consent popup. `accounts.google.com` was contacted. The popup itself is the human's gate. |
| Reload lands on first-run | **pass** | Navigate `/?demo` (`isDemo` true, `location.search` already `''` — scrubbed at entry), `Page.reload` → `isDemo` false, `#firstrun` visible, `#fr-demo` hit-tests, enabled, reads "Try the demo", the "later release" note is gone. Clicking it enters demo from first-run: 24 bars, pill and FAB hit-test. |
| localStorage untouched after a full demo editing session | **pass, with one attribution to read** | After entry, a refused save, the year view with a refused paint, a mood change in the sheet, and the exit click: `localStorage.length === 0`, keys `[]`, at every sample including the synchronous one at the exit click. **The control:** a plain cold visit to `/` with no demo anywhere writes `bramwell.prefs.v1 = {"lastDockedDay":…}` — the scroller's dock write at boot, stage-03/05 behaviour. So after a *reload* (which is a plain visit) the human will see that one key; it is the app's own baseline, and the demo session wrote nothing. Verified in-process too: the selftest counts `setItem`/`removeItem`/`clear` on a shim through a whole demo session including the forced cache flush — zero. |

### The brief's addition: a paint in demo

> a paint in demo (if A landed) rejects with the demo message and leaves the
> strip unchanged.

**Pass.** A landed; rebased; the strip renders over the demo's in-memory
categories: chips `Work 40 · Personal 29 · Financial 16 · Vacation 12 / 30 ·
Blackout 5 · Other 12 · Erase`. The Vacation chip hit-tests; clicking it sets
`data-mode="paint"`. A drag across two free, on-screen days (20731 → 20732)
highlights 2 cells mid-drag (`data-paint` — a selection, A's feedback, not a
write), and pointer-up is refused: toast `Demo — connect your Google Calendar
to save.`, figure `12 / 30` before and after, `.yrbar` count unchanged, 0
cells still carrying `data-paint`, no Vacation bar ever appeared. A second chip
click leaves paint mode (`data-mode` gone).

---

## 2. What was built, per the brief's build order

1. **`DemoError`, the flag, inert I/O.** `enableDemo` / `exitDemo` / `isDemo`
   in `state.ts`. Under the flag: `writeCacheNow` and `saveCache` return (the
   guard is at the writer, so `_flushForTest` is covered); `savePrefs` updates
   memory then returns; `fetchMonth` resolves before touching `withToken`;
   `withToken` itself throws `DemoError` as a backstop; `createEvent` /
   `updateEvent` / `deleteEvent` throw `DemoError` as their first statement —
   before `findEvent`, `pending.set` and `notify`. Selftest: demo create
   notifies **zero** times and leaves no overlay; the same draft offline
   notifies **twice** with the overlay visible in between (apply, then
   rollback) — both orders, one case. Update and delete are refused on an id
   the cache lacks, proving the refusal precedes the lookup.
2. **The seed.** mulberry32 under `0x5EED`, eight months each side of the
   anchor's month. The 21-day Monday-to-Sunday span across three rows, two
   weekly series of timed chips with `recurringEventId` (Tue 09:15, Thu 18:30),
   Rent on every 1st and Quarterly taxes on the 15th of Jan/Apr/Jul/Oct, two
   weekend spans, a day three days out carrying five all-days (the year cell
   shows 3 bars, the panel lists 7 — five plus the Tuesday chip and a filler),
   6–10 filler events a month. Every event is stored in every in-window month
   it touches (the cache invariant `spansForWeek`'s dedupe depends on). The
   seed case was mutation-checked: shortening the span by a day fails it.
3. **Entry and exit.** `?demo` before `scroll.mount` (its first range change
   calls `ensureMonthsFor`, which must already be inert), the URL scrubbed;
   "Try the demo" enabled with its note removed; the `Demo · Connect` pill in
   the avatar slot; `connect()` exits demo first so the pill, first-run
   Connect and Reconnect all leave the same way; `onDemoExit` re-runs
   `configure()` from the real prefs and repaints both views.
4. **After rebasing on A:** the seed carries the frozen seed colorIds directly
   (Vacation 7, Blackout 11); three Vacation runs (5 + 4 + 3 days) and one
   5-day Blackout inside the anchor's year and the window, never overlapping
   each other; `main.ts`'s `enterDemo()` configures the seed, writes
   `budgetDays: 30` onto Vacation with a memory-only `savePrefs`, and applies
   it. The strip reads `12 / 30`.
5. **README and LICENSE.** The wall-calendar paragraph, the demo, the beta
   on-ramp facts (Testing consent, ≤100 test users, the unverified-app
   interstitial, consent expiry, `/?demo` first), run, deploy-your-own with the
   origin rules from SPEC "MANUAL SETUP" and the `sw.js` cache-rule check from
   "DEPLOY", the stage table. MIT, Studio Relativity.

## 3. Hit-test results (every "works" claim, `elementFromPoint` at the centre)

| Control | 1440×900 light | 1440×900 dark | 390×844 dark |
|---|---|---|---|
| `#demo-pill` (Demo · Connect) | hits | hits | hits |
| `#avatar` (Settings, dot-less) | hits | hits | hits |
| `#fab`, enabled | hits, `disabled: false` | hits | hits |
| `.dp-add`, `.dp-save` (demo save) | hits, hits | — | — |
| `#btn-mode`, `.planchip[data-cat="vacation"]` | hits, hits | — | — |
| `[data-mood="dusk"]` in the sheet | hits | — | — |
| `#fr-demo` (after reload, first-run) | hits, enabled | — | — |
| `#reconnect` in demo | absent (correct: demo is not `stale`) | absent | absent |

## 4. Rulings made against the contract (to promote at gate close)

1. **`enableDemo`, not `enterDemo`.** `06_demo/CONTEXT.md` Outputs says
   `enterDemo`; SPEC "State API" and the brief say `enableDemo`, and the stub
   existed under that name. The spec wins; CONTEXT.md needs the one-word fix
   (not made — a contract edit is the human's).
2. **Demo is a fourth connection state in `chrome.ts`, checked before auth.**
   Seeded months are `ready`, so `warmCache()` is true and the existing logic
   read demo as `stale` — a Reconnect pill after 2.5s and a dead FAB. Demo
   shows its pill at once and keeps the FAB live: a refused save is the demo's
   lesson. `n` gates on the same two facts.
3. **The avatar slot in demo holds the pill AND a dot-less avatar.** SPEC says
   customization works in memory, and the avatar is the only door to Settings.
   No dot: `style.css` says the dot "exists only in the connected state". The
   pill reuses `.set-pill` with `data-demo` so C can colour it; today it
   inherits Reconnect's red, which reads as "not connected" — true.
4. **`?demo` is scrubbed from the URL at entry** (`history.replaceState`), so
   "reload lands on first-run" is true from `/?demo` itself.
5. **The quiet token renewal at boot is skipped in demo.** A browser that is
   quietly signed in would otherwise flip to `connected` mid-demo and pull the
   real calendar over the seed. Leaving demo goes through `connect()`, a
   gesture.
6. **`savePrefs` in demo writes memory only** — the dock writes `lastDockedDay`
   and the sheet writes categories and mood; both work, neither persists.
   `exitDemo()` re-reads storage, dropping every demo byte.
7. **The seed hard-codes the frozen seed colorIds** rather than resolving names
   through the configured set. A demo calendar stands in for Google's data,
   which carries colorIds; category is resolved at read time like any other
   event, and `enableDemo()` no longer depends on which prefs happen to be
   loaded. Consistent with SPEC's "Seed (frozen)".
8. **The Vacation budget is written from `main.ts`, in two passes through the
   one writer.** `enableDemo()` empties prefs; `applyTheme()` resolves to the
   seed; a memory-only `savePrefs` maps `budgetDays: 30` onto Vacation;
   `applyTheme()` again. `state.ts` never learns the seed list.
9. **`isConnected()` keeps its meaning.** It stays false in demo; the FAB and
   `n` check demo explicitly rather than lying about auth.

## 5. Not tested, and open

- **The real consent popup from the pill.** Headless cannot open it; the exit
  is verified to the point of GIS's own `popup_failed_to_open`. Human gate.
- **A signed-in browser visiting `/?demo`.** Ruling 5 covers the quiet
  renewal; a token already in memory cannot exist at boot (memory only), so
  the path is closed by construction, not by a probe.
- **iOS Safari, installed PWA.** Nothing here is SW-specific, but the pill and
  avatar side by side at 390px are worth a look on the device.
- **Phone header:** at 390px the pill wraps to "Demo ·/Connect" (screenshot in
  the run). `style.css` is C's; a `white-space: nowrap` on `.set-pill[data-demo]`
  or a shorter label under a phone query is C's call. Recorded, not fixed.
- **The sheet's account row in demo** still reads "Google Calendar · Not
  connected" with a *Sign out* button. SPEC says "Connect anywhere exits
  demo"; the row is C's surface and the brief forbids touching it. Follow-up
  for C: in demo the row should read "Demo" and offer *Connect*, calling the
  same `connect()`. Harmless today: Sign out in demo revokes nothing and
  demo stays demo.
- **The stage-03/05 harness (`npm run shot`)** was re-run against the rebased
  tree as a regression check on the first-run and connection-state changes;
  see the line at the end of this file.

## 6. Upstream amendments this iteration believes are needed (not made)

- `06_demo/CONTEXT.md` Outputs: `enterDemo` → `enableDemo` (ruling 1).
- `DECISIONS.md` "In force — shell and chrome": the demo bullet gains rulings
  2–6 and 8 above; "demo does not seed prefs" narrows, as SPEC already says, to
  "writes no prefs; configures memory".
- `SPEC.md` "Demo mode": the pill "in the avatar's slot" shares the slot with
  a dot-less avatar (ruling 3); `?demo` is scrubbed at entry (ruling 4).
- `OPEN.md`: the sheet's account row in demo (for C); the phone pill wrap.
- `CONVENTIONS.md`, if the human agrees it is the second occurrence: **a
  cold-visit control belongs beside any "storage untouched" claim** — the app
  writes `lastDockedDay` on its own at boot, and without the control that key
  would have been read as a demo leak (it was, for one run).

## 7. The rebase

`origin/planning-layer` had five commits and `src/plan.ts` when step 4 was
reached (the first check, before the session restart, found none — recorded
then as the open item; superseded). `git rebase origin/planning-layer` applied
all six demo commits with no conflicts; 65/65 and tsc clean on the rebased tree
before step 4 was written. The branch is pushed with `--force-with-lease`.

## 8. Regression run of `npm run shot` on the rebased tree

Run once, port 5173, all 9 viewport × scheme × motion rows plus the isolated
probes; exit 0 (which carries no claim — the fields do). **Every shell-chrome
field this iteration's `chrome.ts` changes could touch reads as stage 05
recorded:** `firstRunCold` found, visible, `#fr-connect` hits; over the
harness's warm seeded cache `firstRunAbsentOrHidden: true` on all 9 rows with
`reconnectPresent: false` (sampled before the 2.5s grace, as in 05) and
`avatarPresent: false` (headless cannot be signed in); `heldRepaint` held while
the sheet was open and cleared by a direct invalidate; `fabClears` with
`fabTop === innerHeight - 64` at 780/836/1136 and the last Sunday hitting
`day`; `dayOpenSingleReadout` ok at all three widths with `addReachable: true`;
`addHit`, `typedTextSurvives`, `notesSurvive`, `formClosedByFirstEscape`,
`collapsedByEscape` true on all 9 rows. The `false`s are the engine and motion
probes stage 04's verification already documents as headless instrument
artefacts — `expandedGrew`, `rowHeightInterpolated` (all rows), and
`columnsInterpolated` / `sameWeekSwitchAnimated` on the wide and reduced-motion
rows — with the same values as before. One field has no baseline here:
`yearFitsWithoutScroll: false` on all 9 rows. The year view now carries A's
plan strip above the grid, and this iteration's pre-rebase run died with the
session, so whether the grid fit before the strip was not captured; outside
this surface, recorded for A's and C's gates.
