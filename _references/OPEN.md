# Open items

Things v3 never confirmed, plus questions the rebuild has to answer. Close
each with a dated line and move the ruling to `DECISIONS.md`.

## Closed on the real wire (stage 02 gate, 2026-08-29)

All four closed in one sitting against the real account, as planned. Rulings
promoted to `DECISIONS.md` "Stage 02 gate close"; evidence in
`02_data/output/verification.md`.

- **2026-08-29 — Category colours: CLOSED.** One all-day event created per
  seed category through `state.createEvent`. Google stored colorIds 9, 10, 5
  and 8 exactly as the seed table specifies, and the human confirmed all four
  render as expected in the Google Calendar app (blue-indigo, green,
  yellow-amber, grey). The transcribed hex table stands.
- **2026-08-29 — All-day exclusive-end conversion: CLOSED, both directions.**
  Write: a 3-day event (internal end inclusive) went out as
  `start.date 2026-08-29` / `end.date 2026-09-01`. Read: Google's
  `2026-08-19 → 2026-08-22` came back as Aug 19 → Aug 21 inclusive, and a
  single-day `2026-08-21 → 2026-08-22` came back as one day, not two. The
  failure mode this item warned about — every multi-day event one day short
  or long — does not occur.
- **2026-08-29 — Instance-vs-series edit and delete round trips: CLOSED.**
  An instance-scope edit changed only the Aug 29 occurrence; Sep 5, 12 and 19
  were untouched, and Google recorded the edit as a proper series exception
  (`recurringEventId` and `originalStartTime` retained). A series-scope
  delete, given an INSTANCE id, resolved to `recurringEventId` and removed
  all four occurrences with zero collateral damage.
- **2026-08-29 — A user-chosen colorId arriving in Google's colour: CLOSED**
  by the same evidence as the first item — the colorId written is the
  colorId Google stores, and Google paints it in its own palette.

## Never verified on a device
- Service-worker runtime behaviour (registration, offline open, a deploy
  reaching an installed client without a cache bump).
- Settings sheet with 11 categories on a small phone; native `<select>`
  and `<input type="color">` in an installed iOS PWA (iOS ignores
  `<option>` colouring, hence the colour *names*).
- Arm's-length legibility of a pale user-chosen hue in light mode. No
  guard was added by decision.
- **2026-08-29 — Year view on a phone: CLOSED at the stage-03 gate.** 14
  columns shipped as the phone default (27 rows at 390px, scrolls about one
  row); approved on device. Ruling in `DECISIONS.md` "Stage 03 gate close".
- **`grid-template-columns` interpolation on iOS Safari.** The expansion
  animates the column template, but this stage established that even Chrome
  does not interpolate it uniformly: the first expand interpolates at
  390×844 and snaps at both desktop widths, while the in-row day switch does
  the exact reverse — see SPEC "Scroll engine API" (KNOWN LIMITATION) and
  `04_day/output/verification.md` §3 for the raw widths and the two confirmed
  Chrome engine constraints behind it. iOS Safari itself is still untested —
  Chrome is the only engine this stage ran in. If it snaps on a path where
  Chrome also snaps, that is the recorded degradation, not a surprise, and
  the fallback is to accept the snap and record it. If it snaps on a path
  where Chrome interpolates (or the reverse), that is new information for the
  same open item above, not a second one.
  **2026-08-30 — DEFERRED at the stage-04 gate, by the human's decision, not
  closed.** The Chrome findings above are already recorded as a known,
  partly-delivered limitation in `SPEC.md` "Scroll engine API" and
  `04_day/output/verification.md` §3, so the iOS answer refines a disclosed
  gap rather than gates the stage. Still untested on any Safari engine.

## Opened at the stage-03 gate close
- **Signed-out refetch pressure.** Stage 02's rule refetches an `error`
  month on every `ensureMonthsFor` call; stage 03 limits that to once per
  range move, but a long signed-out scroll still makes a token attempt per
  month per move. Stage 05 owns connection state and decides whether
  `error` becomes sticky while signed out.
  **2026-08-30 — OBSERVED on device, still open.** iOS Safari over LAN, signed
  out, cache seeded for one month only: every other month in the +/-8-week
  window was `absent`, each asked for a token, and GIS tried to open a popup
  that mobile Safari blocks without a user gesture. The failure notifies, the
  repaint re-runs the range, and the cycle repeats — dozens of
  `[GSI_LOGGER] Failed to open popup window` errors per second, with the stack
  showing `onRangeChange` -> token attempt -> failure -> repaint. It is
  self-sustaining while the view moves and settles when it stops, so it is
  noise and battery rather than a hang. Two consequences for stage 05: the
  popup path is unreachable on mobile without a gesture, so a signed-out phone
  cannot recover by itself; and the loop makes any on-device performance
  measurement worthless until the cache is seeded across the whole visible
  window. Predicted at the stage-03 gate close; this is the first time it has
  been seen rather than reasoned about.
- **The 15/45 snap steps in a browser.** `nearestAnchor` is unit-tested for
  all three moduli, but only 30 is wired; the step control is stage 05's
  Settings, and the device check happens at that gate.

## Never verified on the real wire (opened at the stage-02 gate close)
- **GIS response ordering.** `auth.ts` pairs concurrent token requests with
  their responses FIFO, because the GIS callback carries no correlation id.
  If GIS ever resolves two concurrent `requestAccessToken()` calls out of
  request order, the earlier settler receives the wrong response and the
  later one hangs. Shown by probe to be non-self-correcting. It narrows a
  strictly worse prior design (a single settler slot could not survive
  concurrency at all), so it was accepted rather than blocked. Serialising
  the two paths would reintroduce the swallowed-gesture bug, so any fix
  needs a different idea.
- **Offline write rollback on a real device.** Verified out of band with a
  stubbed `navigator` (rejects with the offline message, zero network calls,
  overlay rolled back), never on a device with the network actually killed.
  Stage 05's PWA gate is the right place.

## Rebuild questions
- **2026-08-29 — Phone expansion: CLOSED at the stage-04 plan.** Inline full
  width: the six neighbours go to `0fr` and the column gap to zero, so it is the
  desktop mechanism with different numbers rather than a second shell. The sheet
  was already in `DECISIONS.md` "Rejected — do not retry" and no new reason was
  found to retry it. Ruling in `DECISIONS.md` "Stage 04 rulings".
- **2026-08-29 — Variable-height row without an overlay: CLOSED with
  evidence at the stage-03 gate.** The pure maths take `expanded` and the
  round-trip test fails at exactly the expanded row when `posOf` is broken;
  the synthetic scroller makes it one O(1) conditional offset. Stage 04 sets
  `expanded` and animates `delta`. `DECISIONS.md` "Stage 03 gate close".
- Whether v3's cached `daynote` events (in the user's Google Calendar
  from stage 07) should be migrated into the vault by a one-off script or
  left as ordinary all-day events. See `JOURNAL.md`.
- Journal presence marker in the day cell: link-out only, or a Supabase
  `journal_days` index maintained from the vault. See `JOURNAL.md`.
- Habit streak semantics across the local-day boundary and time zones.
  See `HABITS.md`.

## Opened at the stage-04 final fix wave (2026-08-30)
- **`npm run shot` is a regression printer, not a regression detector, and its
  exit code carries no claim.** It exits non-zero only when a probe *throws*;
  every reported boolean could be false on all nine rows and the run would
  still exit 0. That is why `04_day/output/verification.md` cites field
  values rather than the exit code as evidence. Encoding real expectations
  (an assertion the harness fails on) is deliberately not done this stage —
  several probes' expectations are still in flux (see the column-interpolation
  item above) — but stage 05 should make the harness fail on a failed
  assertion for whichever probes have settled. Until then, a green
  `npm run shot` re-run proves nothing on its own.
- **The `remeasure` re-entry mechanism**, one item covering two related races
  in how `main.ts`'s `scheduleRemeasure`/`remeasure` and `scroll.ts`'s
  `setExpanded` re-enter each other: (a) `setExpanded` used to cancel any
  in-flight kinetic animation unconditionally, including when the incoming
  `Expanded` was unchanged from the current one — a background repaint's own
  remeasure (`day.ts`'s `refresh()` fires `onHeightChange()` unconditionally
  on every refill of the open row) could therefore abort an unrelated
  animated `goToWeek` mid-glide, leaving `onDock` unfired and the header
  range label / `lastDockedDay` stale until the next interaction. Fixed this
  fix wave: `setExpanded` now cancels only when the expansion actually
  changes (week or delta differs). (b) `scheduleRemeasure`'s closure-captured
  `animate` flag can still be lost when a resize and a tap land in the same
  animation frame — pre-existing, self-corrects on the next interaction,
  deliberately left alone to keep the fix-wave diff to (a) legible. Recorded
  as one item, to be fixed together, because a proper fix likely reworks the
  same re-entry path both races live in.
- **`animMs()`'s comma-list parsing and `shot.mjs`'s `parseFloat` of the same
  computed style are the same latent assumption on both sides of the
  instrument, unverified on either side.** `scroll.ts`'s `animMs` takes the
  MAX across a comma-separated `transitionDuration`/`transitionDelay` list;
  `scripts/shot.mjs`'s probe instead runs a plain `parseFloat`, which reads
  only the FIRST value. Both are correct today because `motion.css` emits
  exactly one duration/delay pair per element. The moment `motion.css` grows
  a per-property duration, the two diverge silently — the app applies the
  max, the harness reports the first — and nothing flags the mismatch.
- **The date/time fields stay editable in the form when "Whole series" is
  selected, even though `state.ts` silently drops them from the write.**
  `updateEvent`'s `scope === 'series'` branch omits `start`/`end`/`startMin`/
  `endMin` from `changes` (Google rejects an RRULE PATCHed against an
  instance id, and a series edit must not also move dates onto the series
  master) — but nothing in the form tells the user that editing those fields
  while "Whole series" is picked has no effect. Also newly noted: `state.ts`
  drops **more** than the dates for a series write — `allDay` is skipped too,
  under the same `if (scope !== 'series')` guard — so toggling all-day on a
  series is silently discarded as well.
- **Three write-path fixes this stage made have no regression test of any
  kind:** the stale-completion generation guard (`formGen` in `day.ts`'s
  `save()`/`remove()`), the notes-clearing sentinel (`readDraft` always
  setting `notes` rather than omitting it when empty), and event-list
  ordering (`eventsOn`'s all-day-first, then-by-start-time sort). All three
  need a DOM the node selftest does not have — `day.ts`'s own header comment
  says the module is in the selftest graph specifically because it has no
  DOM at module scope — and `scripts/shot.mjs` never opens the form far
  enough to exercise a write. Stage 05 should decide whether that means a
  browser-based test layer or accepting these as hand-verified only.

## Opened at the stage-04 gate close (2026-08-30)
- **60fps on a mid phone: gate row 2, DEFERRED by the human's decision, not
  measured.** Row 1 measured 60.0fps sustained on the MacBook (~1ms of
  headroom, no dropped frames); the phone session was set up but blocked by
  the signed-out-refetch loop above before it produced a result. Not a
  failure and not verified — stage 05 should re-run it once the refetch loop
  is contained, ideally with the cache seeded across the visible window so
  the loop cannot fire mid-measurement.
- **The harness cannot reliably trigger `data-jump`.** The recycling guard's
  positive case (the stamp actually firing and disabling a transition) is
  proven only by an isolated, deterministic repro (`jumpstack` fixture, 150
  events, two weeks out); embedded in the full nine-row `npm run shot`
  session it fired on at most one row per run, a different row each time, and
  the run behind every other figure in `04_day/output/verification.md`
  reproduced zero of nine. The cause is understood (every user-facing path
  that moves scroll clears the gate as its own first statement; only
  `setExpanded`'s `fitY` repositioning can trigger the stamp, and its shift is
  capped at the row's own distance from the viewport top, so timing relative
  to a row boundary is what decides whether it fires at all). Either the
  fixture becomes its own single-purpose run, or the assertion is dropped
  from the harness and the isolated repro is kept as the record.

## Opened at the first deploy (2026-08-30)
- **2026-08-31 — CLOSED. `/sw.js` was served `max-age=14400` through the
  proxied zone, not the `no-cache` `_headers` sets.** Fixed by the human in the
  Cloudflare dashboard: a zone-level Cache Rule on `no.fail` matching hostname
  `bramwell.no.fail` AND URI path `/sw.js`, Browser TTL set to "Respect origin
  TTL", followed by a custom purge of that URL. Verified on the wire —
  `cache-control: no-cache`, `cf-cache-status: REVALIDATED`, with
  `x-content-type-options` and `referrer-policy` still present, so the fix did
  not displace the `/*` block. The mechanism stays documented in `SPEC.md`
  DEPLOY as a live hazard, because the Cache Rule is dashboard state that
  lives outside this repo. Original finding below, kept for the reasoning.
  Probably not breaking today — browsers default `updateViaCache: 'imports'`, so
  the worker script itself bypasses the HTTP cache on an update check, and they
  cap SW script caching at 24h regardless. But the gate row is "a deploy reaches
  an installed client on the **next online open**", and a 4-hour browser cache
  on the worker is exactly the thing that would make that intermittently false
  on the one engine this app cares most about. Fix, then re-run the two-deploy
  gate row rather than reasoning about it.

## Opened at the year-view redesign (2026-08-30)
- **The 14-column stretch factor is unverified on a device.** Event-day cells
  take 2.2fr against 1fr. At 28 columns that reads; at 14 (tablet and phone)
  the cells are already wider, so the same factor may over-stretch a busy row
  and squeeze the ordinary days. Screenshots were taken at 1440 and 390, but
  a screenshot is not arm's-length legibility. Tune at the next device gate —
  do not guess a second number from a headless render.
- **A row where EVERY day has an event gets no stretch at all**, because
  2.2fr against 2.2fr is 1:1. That is inherent to a proportional track, not a
  bug, and it degrades gracefully (a uniformly busy row is uniformly busy).
  Recorded so it is not rediscovered as a defect.
- **2026-08-31 — CLOSED. `.set-avatar-dot` used `var(--today)`**
  (`style.css`), violating SPEC's "the one reserved hue… used for nothing
  else". Introduced in stage 05's chrome work and missed by the whole-branch
  review; found 2026-08-30 while checking the year-view redesign's
  reserved-hue constraint, and deferred then because it was chrome rather than
  the year view. Now `--ink-dim`: the dot already signals connection by
  PRESENCE — it exists only in the connected state, the reconnect pill
  standing in otherwise — so it never needed the accent to say so. The
  reserved-hue rule now holds repo-wide, not only inside the year view.
  Shipped as the payload for the gate-row-10 two-deploy test, which needed a
  real content change to move the asset hashes.

## Opened at the 05 gate on the phone (2026-09-05)
- **One Reconnect tap per phone visit — and, since the landing page (2026-09-05), no calendar at all offline until this is decided.** The token lives in memory (SPEC
  "Auth") and the quiet renewal at launch is blocked by Safari's tracking
  prevention on iPhone, so every fresh load lands on the Reconnect pill and
  a read-only calendar. Desktop never sees it (the tab stays open). Options
  when it is decided: accept it for beta and say so in the first-run copy;
  keep the token in `sessionStorage` for its remaining lifetime (survives a
  reload, not a closed tab; changes a stage-02 ruling); or the code flow with
  a backend, which the store rule rejects. Owner: the human.

## Opened at the gate close of the three iterations (2026-09-05)
- **The year grid bails on a hidden root**, so a category RENAME made from the
  month view reaches the grid's inline titles only on the next repaint; the
  strip is fresh. Pre-existing; the write case was fixed at this gate close
  (DECISIONS), the rename case is cosmetic and waits.
- **SPEC "Event form" says validation errors surface in the form AND as a
  toast; `day.ts` toasts write errors only.** One of them is wrong; C's
  finding, not C's file. Decide at the next day.ts session.
- **Demo header between 390 and 560px with a longer range label** ("Dec 2026
  – Jan 2027"): C measured 389/390 for "Aug – Sep 2026" only.
- **Emulated clicks on header buttons (2026-09-05 line):** CDP mouse and
  touch both fire the full pointerdown → click chain and toggle the view; a
  real trackpad and touch screen are still untested, so this stays open.
- **2026-09-05 — CLOSED: the settings sheet with 11 categories on a small
  phone.** Measured at 390×844, both schemes, with A's Budget/Blocks rows: no
  clipped row, the sheet scrolls inside itself, the last Remove is hittable.
- **2026-09-05 — CLOSED: the year view says nothing about unloaded months.**
  C ticket 3: a `--ink-dim` line under the grid names the absent range.

## Opened at the planning layer (2026-09-05)
- **Blackout painted over an existing plan does not warn.** The conflict
  rule refuses a plan over a block, not the reverse. The strip could count
  "N Vacation days on blocked days"; decide after beta feedback.
- **Split-on-erase.** Erasing one day out of a run deletes the run. A split
  is delete + up to two creates, non-atomic. Revisit if beta testers ask.
- **Budgets are per calendar year and count every day.** No weekday-only
  accounting, no carry-over, no fiscal year. A vacation policy that counts
  only working days will read high here.
- **Holidays.** No holiday calendar is read. A `blocks` category painted by
  hand is the workaround; reading Google's holiday calendar needs the
  broader scope rejected in DECISIONS.
- **2026-09-05 — CLOSED, superseded the same day:** `defaultView` gained `\"last\"` (the default) and `lastView`; C shipped it. Original text follows.
- **`defaultView` for a fresh install stays `cal`.** The year is the
  product now; the month view is the more finished screen. Flip after the
  polish session lands, or leave to the user. Human's call.
  **2026-09-10 — CLOSED.** Absent `lastView` under `"last"` now opens the
  year. Human: ship the year as the first screen, with a paint hint on the
  strip. Returning sessions still follow `lastView`. Ruling in DECISIONS
  "New installs open in the last-used view" (amended) and SPEC "Settings".
- **Pane-emulated clicks on header buttons did not register (2026-09-05).**
  In the Cowork browser pane at 1440×900, synthetic clicks on "Year" and
  "Today" did nothing while `elementFromPoint` resolved to the button and
  `button.click()` toggled the view. Probably the pane's pointer emulation,
  not the app — but unverified, and `scroll.ts`'s pointer capture is the
  one thing in the app that touches pointer sequencing. Check once in a
  real browser with a trackpad and a touch screen before beta.
- **Year view fetch on a signed-out cache.** Opening the year view with only
  some months cached leaves the rest empty with no indication (seen
  2026-09-05). Stage 05's reconnect pill covers auth; the year grid itself
  says nothing about which months are `absent`/`error`. Polish session.

- **2026-09-05 — CLOSED. The 14-column stretch factor** — measured on a 375px
  screenshot: 2.2fr crushed ordinary days in a busy row. Now 1.35fr at 14
  columns. Ruling in `DECISIONS.md` "Planning layer rulings".
