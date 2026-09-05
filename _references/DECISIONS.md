# Decisions

Rulings from the v3 build (stages 01–09, 2026-08-20 → 08-29) that are still
in force, and the approaches that were tried and rejected so they are not
retried. `SPEC.md` already reflects every "in force" line; this file is the
why. New rulings made during the rebuild go at the bottom, dated.

## Rejected — do not retry

- **The lens** (scroll-linked zoom, two full-detail rows, compressed 20px
  rows, two-week detents). Built and tried on device 2026-08-20. Compressed
  rows made the shape of a month *harder* to read, which was their whole
  justification. Replaced by uniform rows and month anchors.
- **Row scaling for "elevation"** (`transform: scale(1.01)` on docked rows).
  Pushed rows ~7px past the edges at 1440px and clipped Monday's day number.
  Night Depth lifts cells with `translateY`, never scales rows.
- **`user-scalable=no` as the double-tap-zoom fix.** iOS Safari has ignored
  it since iOS 10. The working fix is `touch-action` plus `preventDefault`
  on `dblclick` and the Safari gesture events.
- **Today as a solid ink cell with gradients fading into neighbours.**
  Out-shouted every event bar, ramps read as lighting artifacts, marked a
  region instead of a day.
- **Today as a 1.5px inset outline on a near-empty year cell** — parses as
  a form field. (Night Depth's accent inset ring is on a raised tile with
  an accent day number; the form difference is what makes it read.)
- **Today as a filled ink pill + cell wash** — the v3 answer, superseded by
  Night Depth's ring + accent number. Not wrong, just replaced.
- **Overlay day drawer / bottom sheet.** Superseded by inline expansion.
  Its content contract carries over; the shell does not.
- **Mass-PATCHing history when a category's colorId changes.** Partial
  writes, rate limits, irreversible edits to every event — all worse than
  a legend that changed. New writes only.
- **A per-category `isFallback` boolean.** Would need an "exactly one true"
  invariant; a sibling `prefs.fallbackCategory` name is unambiguous by shape.
- **`confirm()` for category delete.** A modal over a sheet for an action
  that touches nothing in Google. Two-step "Remove?" button instead.
- **Serving the shell cache-first.** No deploy could ever reach an
  installed client without a hand-bumped cache name. Hashed assets
  cache-first; everything else network-first.
- **Google Keep for notes.** Its API is enterprise-only.
- **Day notes as Google Calendar events** (stage 07's `daynote` extended
  property). Worked, but the rebuild's definition of done forbids the
  journal living inside the calendar. See `JOURNAL.md`.
- **A shared `dates.ts`** while the file layout lacked it. Rule: add a file
  to the layout first, then create it. The rebuild's layout is the place
  to put one if the plan wants it.

## In force — data and dates

- Two date representations: `DayNumber` for storage, `WeekIndex`/`DayOffset`
  for layout, converted in `state.ts` only. A WeekIndex is anchored to today
  and would shift a stored event by one every midnight.
- Week starts Monday; `DayOffset` 0=Mon … 6=Sun, so Sat/Sun are one block.
- All-day end is inclusive internally; converted at the `gcal.ts` boundary.
- `prefs.lastDockedDay` is a DayNumber, written but not read at launch.
- `today()` is captured at anchor time; a session left open across midnight
  keeps its anchor until reload.
- Timed events carry start and end DayNumbers; render on the start day.
- Cache keys `bramwell.cache.v1` / `bramwell.prefs.v1`, versioned, discarded
  on mismatch; quota failures swallowed — the cache is never truth.
- `MonthLoadState` = `absent | loading | ready | error`, visible to render.

## In force — auth and wire

- `getToken(forceRefresh)` is how a 401 invalidates a token still unexpired
  by its own clock. **Superseded in part at the stage-02 gate close:** a
  fifth export, `invalidateToken()`, was needed after all — see "Stage 02
  gate close" below and SPEC "Auth".
- A failed quiet renewal does not auto-escalate to a popup (browsers block
  it outside a gesture); it surfaces the reconnect pill instead.
- The GIS `<script>` lives in `index.html`; `auth.ts` polls for GIS. **Read
  through `globalThis.google`** (the same binding as `window.google` in a
  browser) so a node test can install a fake — stage-02 gate close.
- `signOut` must revoke, not just clear.
- No profile scope: the account row names the connection, not the person.
- Write orchestration lives in `state.ts`; the day module never touches
  `gcal.ts`. Offline check inside the try, after the optimistic apply.
- Reconciliation refetches touched months; a series write marks every
  resident month stale.
- `repeat` is disabled when editing an existing event.
- Scope picker only for recurring events; default "this occurrence";
  series delete confirms.

## In force — scroll and render

- `SNAP_ALIGN = 0.5`: boundary centred; one number to change if the
  incoming month should get more room.
- Half-month anchors on real dates (1st and 16th); 15/30/45 = modulus
  1/2/3. Default 30.
- Header names the range ("Aug – Sep 2026") because at rest it straddles.
- Bands key on `month % 2`.
- Row height proportional with clamps.
- Timed events are chips only; bars are all-day/multi-day only — **in a
  calendar week row**. Scoped 2026-08-30: the rule was written unscoped and
  `year.ts` applied it there too, so a day whose only events were timed drew
  nothing and the year read as empty (reported by the human on the deployed
  app). The exclusion is sound where a chip carries the event instead; the year
  grid has no chips, so it just lost the event. `SPEC.md` "Year view" already
  said bars are for "that day's events" — the spec wins the conflict
  (`CLAUDE.md`). In the year grid a timed event is a single-cell bar on its
  start day; all-day events still run to `ev.end`, and `assignLanes` is
  longest-first so multi-day runs still take their lane first.
- Year view: up to 3 per-cell bars longest-first (reads as a run across
  the row); no virtualization; opening a year fetches its months; the
  hover panel survives repaints and `onCacheChange` filters by year.
- Clicking a year-view day returns to the calendar on that day.
- The year panel's date is formatted by **locale**, never a hardcoded order.
  It was `d/m`, which a US reader parses as a nonexistent 30th month
  (2026-08-30). `toLocaleDateString(undefined, ...)` matches what `day.ts`'s
  header and the month badge already do, and needs `timeZone: 'UTC'` because
  `DayNumber` is a UTC civil date.
- Day number top-right, month badge top-left, "+N" bottom-left.
- `render.ts` collects per-day markers during lane packing, not with a
  per-cell lookup (~98 redundant scans per repaint otherwise).
- Hidden-state fix: any selector that sets `display` must re-assert
  `[hidden] { display: none }`.
- Flex-gap trap: text nodes are not flex items; wrap titles in a span.

## Year view redesign (2026-08-30)

Iteration session, not a stage session: this amends closed stage-03
territory. Upstream edits landed before any code.

- **Hairline borders on year cells: considered again for contrast, rejected
  again.** Night Depth's statement stands — cells are "rounded raised tiles
  on a near-black ground, **not** hairline-ruled grid cells" (SPEC "Visual
  direction"), and hairlines are the rejected v3 direction. The flatness
  being reacted to is band contrast, not missing rules; the answer is the
  spine, event-day ink weight and the stretch. No new reason to retry was
  found, so the entry in "Rejected — do not retry" stands unamended.
- **Year-view stretch is static.** Animating `grid-template-columns` is the
  recorded KNOWN LIMITATION (SPEC "Scroll engine API";
  `04_day/output/verification.md` §3 — five fix rounds, cause never
  established). Hover *growth* was rejected for the same reason. The
  template is computed once per `build()`; hover feedback is the existing
  compositor-only lift. This adds no case to the limitation's list and needs
  no `data-cols-anim` machinery.
- **The spine is neutral.** `--today` stays reserved to today's ring and
  number (SPEC: "the one reserved hue… used for nothing else"), so the
  prototype's teal spine edge was not carried over.
- **Superseded same day, after the deploy: the spine is `--ink` on
  `--surface`, with no edge — not `--ink-dim` on `--band-b-end` with a
  `--rule` inset.** The first version was reported unreadable. Measurement
  found the text was not the main fault (5.1-5.9:1, above AA); the spine was
  **1.01:1 against its neighbouring cells** — optically the same colour, so it
  never read as an object. Since the band ladder is intentionally shallow and
  no background gets past ~1.1:1, the label carries it: `--surface` turns the
  spine into a recess in the tile field, and `--ink` puts the name at
  14.9-15.4:1 in every mood and scheme. The `--rule` inset was dropped as
  redundant once the recess defines the edge — and closer to "not
  hairline-ruled grid cells" than the inset was.
- **The month spine replaces the year grid's `.badge`.** Keeping both would
  print the month name twice on the 1st — exactly the duplicate rendering
  CONVENTIONS' stand-down rule exists to stop. Because SPEC asserted
  identical badge treatment across views in two further places, this
  required amending "Layout details" and the Definition of done as well, not
  only "Year view". Those two edits were **not** in the iteration file's own
  amendment list; they were raised as a conflict and authorised before any
  code was written.
- **The year view's column-alignment property is traded for stretch +
  spine**, superseding the stage-03 phrasing. The 14-column phone ruling is
  unchanged. The weekday letter and the per-cell weekend shade carry what
  alignment used to.
- **No webfont.** The draft's serif month label (Newsreader) was dropped: the
  app is system-stack, and a webfont is a Visual-direction amendment plus an
  SW precache concern on a deployed PWA. The spine uses the existing stack at
  weight 620, letter-spaced caps.
- **No new hex.** The draft's `--yv-*` palette was discarded; colours come
  from the mood ladder in `categories.ts` and the existing non-mood tokens.

## Year-to-calendar handoff (2026-08-31)

- **Leaving the calendar for the year view collapses the open day.** Confirmed
  by the human after being flagged as a behaviour change beyond the reported
  defect. The narrow alternative was weighed and rejected: collapsing only
  inside `onPickDay` would also have fixed the bug and preserved the expansion
  across a plain Year-and-back toggle, and it would not have broken anything —
  on that path there is no competing `goToWeek`. It was rejected as a rule that
  is harder to hold in your head, for a state that means little in a view you
  have left. Do not reopen without a new reason.
- **Clicking a year-view day opens that day, not just its week.** "On that day"
  had delivered only the scroll, which is indistinguishable from landing on any
  of its six neighbours.

## In force — shell and chrome

- Service worker registers in production only.
- `vite.config.ts` exists to emit `sw.js` at the site root.
- Refresh is a no-op while a form is open (transient-UI rule). The year
  panel and the settings sheet obey the same rule.
- First-run may flash for a returning user with a cleared cache; the
  reconnect pill waits a 2.5s grace.
- `warmCache` is computed from `monthState` over the render window.
- FAB date: calendar → mid-week day of the docked week; year → today.
- Optional prefs fields (`snapStepDays`, `defaultView`, …) so `state.ts`
  fallbacks keep compiling.
- Demo: `DemoError` before the optimistic apply (offline errors fire
  after it, to prove rollback); the demo pill sits in the avatar's slot;
  demo does not seed prefs; leaving demo re-runs `configure()`.

## In force — categories and colour

- Stored blob is untrusted input; `sanitize()` on load.
- Names minted from the label, never re-derived; uniquified against the
  current set only (delete `travel`, add "Travel" → old events adopt the
  new one — accepted).
- Dark-mode colours: curated twins for the seed, `brighten()` for the rest.
- Label edits do not rebuild the row; colour drag commits on `change`.
- Empty label becomes "Untitled" on blur.
- Moods touch only `--surface` and the four band tokens.
- `themeCss()` emits `--cat-<name>` properties as well as `[data-cat]` rules.

## In force — redesign (approved 2026-08-29, never built)

- Direction: Night Depth (chosen over Paper Almanac and Signal Board).
- Motion tokens, three elevation levels, one enter/exit utility,
  reduced-motion collapse, inline expansion with one variable-height row.
- Open at plan time: phone (≤560px) inline-full-width vs bottom sheet —
  leaning inline. **CLOSED at the stage-04 plan (2026-08-29): inline full
  width. Ruling in "Stage 04 rulings" below; the `0fr`/`minmax(0, ...)`
  amendment is in `04_day/output/verification.md`.** Year-view hover panel
  restyled in the same tokens in a later pass.

## Rebuild rulings (2026-08-29)

- Three stores, one shell: Google Calendar for events, Supabase for
  habits, markdown in the Obsidian vault for the journal. The calendar
  writes nothing but events to Google.
- Superpowers (obra/superpowers) has no journal, note, or markdown
  primitive — it is a software-methodology skill set (brainstorming,
  writing-plans, executing-plans, TDD, systematic-debugging, code review,
  worktrees, subagent-driven development). It drives *how* the rebuild is
  run (see `CLAUDE.md`), not where anything is stored.
- `drawer.ts` is renamed `day.ts`; `motion.css` and `habits.ts` /
  `journal.ts` join the layout. Network boundary becomes two files:
  `gcal.ts` for Google, `habits.ts` for Supabase. Nothing else fetches.

## Rebuild rulings — stage 01 types (2026-08-29)

- `DayNumber`, `WeekIndex`, `DayOffset` are all branded (`unique symbol`
  phantom). Two 0–6 ranges are as confusable as day/week; brand all three.
- The anchorless date core (brands, `civilToDay`, `dayToCivil`,
  `monthKey`) lives in `src/dates.ts`, import-free. Anchored math
  (`today()`, `weekOf`, `dayAt`) stays in `state.ts`. Reason: `gcal.ts`
  and `habits.ts` must brand wire dates and may not import `state.ts`;
  a "pure functions only" exception to that rule is not enforceable.
  Rejected: duplicating the `Date.UTC` math in the leaves.
- `CalendarEvent` is a discriminated union on `allDay`, minutes-of-day for
  timed events. Rejected: flat optional time fields (strict mode gives
  nothing); start+duration (contradicts "start and end DayNumbers").
- `EventDraft` is flat, not a union — it must survive toggling all-day.
  The domain value is built field by field from it.
- `CalendarEvent.category` is derived from `colorId` against current prefs
  and omitted by the serializer; rehydration re-resolves. A deleted
  category's events resolve to the fallback without a refetch.
- The event cache holds server truth only. Pending writes are an overlay
  (`PendingWrite`, keyed by id) merged on read, never serialized; only
  `ready` months persist. Rollback deletes one overlay entry.
- `EventSpan` (week, from/to DayOffset, continuation flags) is built in
  `state.ts`; lane packing stays in `render.ts` on its own `PackedSpan`.
- Habit `cadence.days` uses `DayOffset` numbering (0=Mon), not ISO.
  Rejected: ISO on the wire with conversion (second weekday vocabulary);
  named days (more mapping for no extra safety once there is one vocabulary).
- `Prefs` holds exactly the four fields stage 01 was permitted to read,
  all optional; later prefs are added to `SPEC.md` first.
- Stage 01 execution rulings (2026-08-29):
  - `selftest.ts` added to the file layout; dynamically imported so it is
    not in the main chunk.
  - `_setAnchorForTest` is a test-only export of `state.ts`; the spec's
    "exports exactly" rule applies to `auth.ts` only.
  - `sw.ts` is an empty module, not a throwing stub (an installed
    throwing SW wedges every load).
  - Seed `--surface`/`--ink` in `index.html` are placeholders; stage 03
    replaces them from "Visual direction".
  - `public/_headers` is a two-line placeholder; stage 05 owns it.
  - Stub signatures for scroll/render/year/day/chrome are minimal
    (`mount`, `renderWeek`, `expand`, `toast`); the owning stage adds the
    interface to SPEC.md before widening.
  - `CalendarEvent` all-day arm carries `startMin?: never; endMin?: never`
    so a spread of a flat `EventDraft` cannot smuggle a time into an
    all-day event (excess-property checks only catch literals).
  - `manifest.webmanifest` lives in `public/` (served at
    `/manifest.webmanifest`); a root file never reaches `dist/` under
    Vite. SPEC "File layout" already updated.
  - The selftest does not pin `TZ`: pinning to UTC would neuter the DST
    case. The local-time-constructor guard therefore only bites in a DST
    zone — listed under "Not tested".
  - Selftest case 3's 801-day span crosses one leap day (2024-02-29) and
    three year boundaries, not the two leap days the plan first claimed.
  - `StoredEvent` is the persisted event shape (`CalendarEvent` minus derived
    `category`, both arms written out); `MonthEntry.events` is
    `StoredEvent[]`. A cache read re-resolves `category`. Rejected:
    `Omit<CalendarEvent,'category'>`, which collapses the union.
  - Brand constructors throw `RangeError` on non-finite input, so a
    malformed wire date fails at the boundary, not in the virtualizer.
  - Modules reachable from `selftest.ts` keep browser globals out of module
    scope (CONVENTIONS), so the node runner survives stage 02.
  - `MonthKey` stays a plain `string` alias; `monthKey()` shapes it and
    selftest case 4 guards it.
  - The DST selftest case is made non-vacuous by a second gate run under
    `TZ=America/New_York`; the default run stays unpinned.


## Stage 02 gate close (2026-08-29)

Promoted from `02_data/output/verification.md` after the gate passed on the
real account. That file is now a record, not an input.

### Module boundaries and shapes
- `gcal.ts` returns `StoredEvent`, never `CalendarEvent`. Resolving
  `category` there would make it import `categories.ts` and depend on
  `configure()` having run; a pre-configure read would silently resolve
  every event to the wrong fallback. Resolution lives in `state.ts` alone,
  which makes "category is never serialized" structural rather than
  remembered. Rejected: `gcal.ts` importing `categories.ts`.
- `WriteScope` never reaches the wire. Instance-vs-series is purely a choice
  of which id to send, and only `state.ts` holds the event carrying both
  `id` and `recurringEventId`. `gcal.updateEvent(id, changes, colorId,
  token)` and `gcal.deleteEvent(id, token)` take no scope. `colorId` stays
  an explicit argument because `EventDraft.category` is a *name*.
- `state.ts` rolls back and **rethrows but does not toast**. SPEC's prose
  says "roll back, toast, rethrow", but `chrome.toast` is DOM-bearing and
  `state.ts` is loaded by the node selftest. The caller raises the toast;
  stage 04 wires it.
- `auth.ts` reads `globalThis.google` — the same binding as `window.google`
  in a browser — so a node test can install a fake without clobbering the
  page's real `window` during `/?selftest`.

### Wire behaviour
- Retry is split and neither layer retries the other's case: `gcal.ts` owns
  the transport retry (one retry on 403-rate-limit / 429 / 5xx), `state.ts`
  owns the identity retry (401 → `getToken(true)` once). 429 joins the set;
  a 403 is retried ONLY on reason `rateLimitExceeded`/`userRateLimitExceeded`.
- `listMonth` caps the `nextPageToken` loop at 20 pages, so a server or stub
  returning a fixed token fails loudly instead of hanging.
- `MAX_RESULTS` stays an exported `const`. It cannot be lowered from the
  console — an ES module namespace object's properties are non-writable — so
  a gate lowers it by editing the source and letting HMR reload. Rejected: a
  runtime setter in a production module to serve a test.
- A timed event's span is its start day only, even when its end crosses
  midnight.

### Cache and state
- Cache staleness is 5 minutes; `saveCache` is debounced 250ms; `savePrefs`
  writes immediately. No eviction — quota failures stay swallowed.
- A failed refresh sets `error` but KEEPS the prior events, so a refresh
  failure never blanks a month already on screen.
- `refetch` must FORCE a fetch rather than joining one already in flight.
  Joining it silently discarded a write's result: the running request was
  issued before the write reached Google, and its success handler then reset
  `fetchedAt`, hiding the new event for up to 5 minutes with no error.
- A user gesture must never join an in-flight quiet renewal. `getToken(true)`
  skipping the cache check but not the `pending` dedupe made `signIn()`
  return a non-gesture promise, which GIS cannot escalate to a popup. The
  settler slot is a FIFO queue, not a single slot — two concurrent requests
  through one slot would clobber each other and hang the first.
- `state.updateEvent` builds the changes object explicitly: `repeat` is
  always omitted (DECISIONS "repeat is disabled when editing an existing
  event"), and for `scope === 'series'` the dates are omitted too. Sending
  the whole draft made an instance edit carry `recurrence` against an
  instance id, and made a series edit rewrite the series master's start to
  the edited occurrence's date, destroying earlier occurrences.

### Categories
- `brighten()`'s spec constants stand: lightness floor 0.62, saturation cap
  0.72. A test that measures the emitted 8-bit hex must tolerate ~1/255 of
  quantization error; the tolerance is the thing to widen, never the
  constant. Rejected: lowering the cap to 0.71 to fit a tight tolerance.
- Dark twins are keyed on the LIGHT hex, not on category identity, so they
  survive a rename or a colorId change with no bookkeeping.
- `sanitize()` also validates `name` against `/^[a-z0-9-]{1,32}$/`. `name`
  reaches a `[data-cat="…"]` selector and a `--cat-…` property, so a
  corrupted prefs blob could otherwise break or override the theme sheet.
- The Google colour table is exported from `categories.ts`. **The
  transcribed hexes were confirmed at the gate**: events written with
  colorIds 9/10/5/8 render in the Google Calendar app as blue-indigo, green,
  yellow-amber and grey respectively.
- Mood values beyond `warm` are deferred to stage 03; the four band tokens
  are not emitted at all. No palette was invented in stage 02.

### Testing and verification
- `selfTest()` is async and covers `gcal.ts` under a stubbed `fetch` — one
  surface, run by both `npm run selftest` and `/?selftest`. Rejected: a
  second `wiretest.ts` module and a second runner.
- `state.ts` carries `_resetForTest`, `_flushForTest`, `_settleForTest`,
  extending stage-01 ruling 2. `auth.ts` carries no test-only export.
- Every anchor-pinning selftest case saves and restores the anchor, so the
  suite is order-independent (verified by running it reversed).
- **A criterion is about user-visible behaviour, not mechanism.** "Renews
  quietly with no popup" was unachievable as literally written: GIS's token
  model always opens a popup window, and on the silent path it confirms the
  grant server-side and closes itself. The criterion is "renews WITHOUT USER
  INTERACTION". The `Cross-Origin-Opener-Policy … window.closed` console
  errors that accompany it are GIS's own `client.js` polling the window it
  opened — benign, and not ours.

## Stage 03 rulings (2026-08-29, made at plan time)

- **The virtualizer never writes `w * H` inline.** Every position and height
  goes through `posOf(w, rowH, expanded)` / `heightOf(w, rowH, expanded)`.
  The scroll-offset inverse `weekAtY` keeps the same three-way branch, but it
  derives its expanded-row region boundaries by CALLING `posOf`/`heightOf` —
  never by re-deriving the arithmetic — so a change to either propagates
  automatically. The only exemption is the division that inverts a position
  back to a week; there is no primitive for that direction.
  This is the single thing that, violated quietly, makes stage 04's inline
  expansion impossible and forces the overlay `OPEN.md` warns about. The
  scroller is SYNTHETIC — `y` is a number we own, not a browser-managed
  scroll position — so a variable-height row costs one conditional offset and
  stays O(1): no cumulative scan, no measurement, no layout read. Stage 03
  ships with `expanded = null` throughout, so nothing is paid for a feature
  that is not there yet, but the pure math is proven under node with a
  non-null `expanded` this stage rather than on promise.
- **Motion carve-out.** CSS transition/animation values live only in
  `motion.css`; the scroll engine's per-frame physics constants live at the
  top of `scroll.ts`. Two homes, chosen by what the value drives, and a
  literal at a use site is wrong in either case. Resolves a contradiction
  between SPEC "Motion" ("no animation value outside the token layer") and
  SPEC "Perpetual scroll mechanics" (which mandates those constants in
  `scroll.ts`).
- **`render.renderWeek` fills a recycled node rather than creating one**,
  superseding the stage-01 stub signature per stage-01 ruling 6.
- **Lane packing is deterministic**: sort by span length descending, then
  start day, then event id. Without the id tie-break, a repaint can reshuffle
  lanes under the user.
- **Bars cross the gaps between tiles.** Night Depth makes cells discrete
  rounded tiles, so a multi-day commitment either reads as one run crossing
  the gaps or as separate stubs; SPEC's "title once on the true start,
  continuations drop the spine" only means anything as one run.

## Stage 03 gate close (2026-08-29)

Promoted from `03_engine/output/verification.md` after the gate passed on
device. That file is now a record, not an input. All tuned constants stayed
at their SPEC values; the human approved the palette and the phone's
14-column year view as shipped.

### Colour
- **The palette is code, not canvas**: fifty values in `categories.ts`
  `MOODS`, one fixed lightness ladder (`--band-a-end` +2.5, `--band-a` +4,
  `--band-b-end` +4.5, `--band-b` +6 relative to the ground) over five
  hues. Warm's light ground is `#F2EFEA`, not the seed `#f7f6f3` — 96.1%
  lightness left no headroom for four raised steps. The seed near-black
  `#0f1115` is hue 220 and is Cool's dark ground. Dark grounds are
  near-identical by design; the mood reads through the bands. Asserted in
  both schemes by `categories: the mood ladder holds in both schemes`.
- Four non-mood tokens (`--ink`, `--ink-dim`, `--rule`, `--ring`) live in
  `style.css` `:root` with a dark override and do not vary by mood.
- `--today` is teal (`#0D9488` light / `#2DD4BF` dark) on exactly two marks:
  today's inset ring and today's day number. The hover ring is `--ring`.
- Hover is compositor-only: `translateY(-2px)` plus an `::after` layer
  carrying `--el-hover` and the ring, cross-faded by opacity. Rejected:
  transitioning `box-shadow`; any `scale()`.

### Engine and render
- `render.renderWeek(node, week, spans, rowH)` takes `rowH` so bar capacity
  is derived, never measured. `visibilityFor` is exported so the selftest
  pins the "+N" arithmetic the renderer actually runs.
- `ScrollHost` carries `mondayOf(week)` and `weekOf(day)`; `scroll.ts`
  never imports `state.ts`.
- The header window is centred on the dock: `renderRange(week − 3, week + 3)`.
  `onDock` reports the week at the viewport centre with ~6.5 visible.
- Header order: range, year steppers (year view only), Cal/Year toggle,
  Today, avatar slot.
- `assignLanes` is shared by week rows and the year grid and packs by true
  interval intersection per lane. Rejected: the "rightmost occupied column"
  heuristic — longest-first does not deliver items left-to-right and it
  wastes a lane on a later, earlier-starting item.
- `main.ts` calls `ensureMonthsFor` only when the visible range moves, and
  cache-change repaints coalesce to one `requestAnimationFrame`. Without
  the guard a signed-out session loops `error → notify → invalidate → place
  → onRangeChange → refetch → error` as one microtask chain and freezes the
  renderer.
- The variable-height row is proven, not promised: breaking `posOf`'s
  `w > ex.week` fails `scroll: posOf/heightOf/weekAtY round-trip, uniform
  and expanded` at the expanded row only. The synthetic scroller makes the
  row one conditional offset, O(1). **No overlay.** Closes the `OPEN.md`
  stop-and-revise clause; stage 04 sets `expanded` and animates `delta`.

### Year view
- Phone default is 14 columns (`columnsFor`: ≥1100 → 28, ≥360 → 14, else
  7). At 390px the grid is 27 rows and scrolls about one row; accepted.
- Bars are a per-row overlay grid of the same shape as `.bars`, capped at 3
  lanes, stacked from the cell's bottom edge (3px, 5px pitch) so three fit
  a 28px phone cell.
- The hover panel is a sibling of the grid; `build()` replaces only the
  grid, refills and repositions the panel in place, and drops it only on
  `pointerleave`, a tap elsewhere, or a year change. `meridiem()` in
  `year.ts` is the one 12-hour formatter; week chips stay 24-hour.
- Touch: a `pointerover` of type `touch` is ignored so the tap that
  follows it counts as the first tap, not the second.

### Tooling
- `scripts/` is node-only tooling, never bundled: the selftest runner and
  `shot.mjs`, a dependency-free CDP harness (Node's global `WebSocket`)
  that seeds `localStorage` and drives colour scheme with
  `Emulation.setEmulatedMedia`. `hover`/`pointer` are not emulatable media
  features; touch flow is driven with `Emulation.setTouchEmulationEnabled`.

## Stage 04 rulings (2026-08-29, made at plan time)

- **The expand is one CSS transition, not a rAF animation.** `scroll.ts` jumps
  `expanded` and `y` to their final values, writes each row's final geometry
  once, and `motion.css` interpolates. Per-frame cost is zero, no cubic-bezier
  solver is needed to reproduce `--ease-spring`'s overshoot, and the motion
  carve-out boundary holds without a new constant in `scroll.ts`.
- **Expansion and scroll-to-fit are the same transition.** Because the scroller
  is synthetic, moving `y` IS writing transforms — so the row growing and the
  view sliding up to fit it interpolate together, one duration, nothing to
  co-ordinate. `fitY` shifts up only as far as the row's own top edge, so
  opening a day never pushes its top above the fold.
- **The animation's end is read from computed style, not from a JS constant.**
  `getComputedStyle(row).transitionDuration + transitionDelay`. Reduced motion's
  80ms is then correct by construction rather than by a parallel constant.
- **Accepted, bounded:** hit-testing during the animation resolves against the
  FINAL layout while the pixels are still in flight. The window is exactly
  `--t-open` (expand) or `--t-fast + --t-base` (collapse). Preferred over the
  alternative — mid-flight-accurate maths would mean per-frame recomputation and
  a click that lands on whatever slid under the finger.
- **`data-jump` guards recycling during an animation only.** A node recycled into
  view mid-animation would transition from its position 14 rows away. The stamp
  is written only while `data-anim` is set, so steady-state recycling keeps its
  two style writes per row per frame. Asserted in the harness so the guard cannot
  leak and deaden normal recycling.
- **Phone (≤560px) is inline full width**, via the same `grid-template-columns`
  mechanism with `0fr` neighbours and zero column gap. The bottom sheet stays
  rejected; no new reason was found to retry it.
- **Reduced motion collapses motion, not dwell.** The global 80ms rule would make
  a toast unreadable, so `.toast` keeps `--t-toast` and swaps to opacity-only
  keyframes under `prefers-reduced-motion`.
- **`chrome.toast` is built at stage 04**, `chrome.mount` stays a stage-05 stub.
  Toasts belong to `chrome.ts` in the file layout; a temporary home in `day.ts`
  would be a boundary bend with a deletion attached.
- **The panel stops pointer events reaching the scroller.** `scroll.ts` calls
  `setPointerCapture` on every pointerdown in the scroller, which retargets the
  compat `click` and would break every form control. One `pointerdown`
  `stopPropagation` on the panel fixes it without `scroll.ts` learning what a
  day panel is.
- **Day taps are detected from the pointer sequence, not `click`**, for the same
  capture reason, with the target resolved by `document.elementFromPoint` at the
  pointerdown position — which is the hit test CONVENTIONS demands anyway. A
  movement past `TAP_SLOP` is a drag, not a tap.

## Stage 04 gate close (2026-08-30)

Promoted from `04_day/output/verification.md` after the human closed the gate.
That file is now a record, not an input. Two gate rows were deferred rather
than passed, by the human's decision: 60fps on a mid phone (blocked by the
signed-out-refetch loop, not run to a result) and `grid-template-columns`
interpolation on iOS Safari (its Chrome findings are already a recorded
limitation below and in `SPEC.md`, so the iOS answer would refine a disclosed
gap rather than gate the stage). Rulings 1–8 were made at plan time and are
already recorded above in "Stage 04 rulings (2026-08-29, made at plan time)";
what follows is rulings 9–14, made during execution, plus the stage's
substantive discoveries.

### Toast severity
- **The toast is `role="alert"`, not `role="status"`.** `status` is an ARIA
  polite live region: a polite announcement may be skipped entirely, so a
  blind user could never learn that a calendar write failed, and the toast
  self-removes after 3.2s with no way to recall it. A severity parameter, so
  stage 05 could raise benign toasts politely, was rejected as speculative
  generality — the only caller today is the error path. This changes
  user-visible behaviour, so it is promoted rather than left in the ledger.

### Two undocumented engine constraints
Both confirmed by an isolated repro before being treated as fact, and both
are why the transition gate moved off the scroller and onto the 14 pool rows.
- **`grid-template-columns` will not transition when JS writes it as an
  inline style.** The value must travel through a CSS custom property
  (`--expand-cols`) that a static rule reads with `var()`.
- **`grid-template-columns` will not transition through an ancestor-attribute
  selector** (`.scroller[data-anim] .week`), regardless of write order. The
  gate must be a same-element selector (`.week[data-anim]`).

### The gate is armed, and split by property
- **The gate must be armed before the gated property's value changes, not
  merely in the same task as it** — hence `armAnim(kind)` and
  `armColsAnim(node, kind)`, which raise a gate and do nothing else. This
  corrects a ruling made earlier in the same stage that writing the columns
  before `setExpanded` in one task would suffice, on the reasoning that a
  transition is decided from the after-change style; the repro said otherwise
  for this property in this engine. The lesson to keep: empirical evidence
  beat the reasoning, here and generally.
- **The transition gate is split by property, both halves per-row.**
  `data-anim` (`transform`, `height`, `column-gap`) is stamped pool-wide,
  because every row's geometry shifts when one grows; `data-cols-anim`
  (`grid-template-columns`) is stamped only on the row(s) whose columns
  actually change — the expanding row, plus the departing row on a
  cross-week switch. On the row carrying both, a compound rule
  `.week[data-anim][data-cols-anim]` lists all four properties, because
  `transition-property` is not additive between two equal-specificity rules
  — without it the later rule in source order silently wins outright and
  drops the other's properties. The recycling guard (`data-jump`) pairs with
  *each* gate on the same element.
- **`.bars` inherits its column template and gap rather than being written.**
  `renderWeek` creates a fresh `.bars` on every fill, so an inline column
  write to it has no before-change value and cannot transition — the bar
  overlay snapped to the final grid while the cells interpolated, misaligning
  every multi-day bar from its cells for the full 380ms of every expand.
  `grid-template-columns: inherit` plus `column-gap: inherit` fixes it by
  construction: a transitioned value is the computed value for inheritance,
  so `.bars` tracks `.week` per frame and a freshly created node inherits
  correctly.

### `grid-template-columns` interpolation — live limitation, not solved
The column template interpolates at some viewports and paths and snaps at
others, and it is not a viewport split: the first expand interpolates at
390×844 and snaps at 1440×900 and 1920×1200, while an in-row day switch does
the exact reverse. Height, `transform` and `column-gap` animate correctly
everywhere; the column end state is always correct; only the easing is
inconsistent. The three engine constraints above and the split-gate
architecture are each confirmed necessary and, together, not sufficient — an
isolated reconstruction of the app's real architecture (pre-existing pool
nodes, the split gate, `--expand-cols`, children replaced mid-task) **does**
ease correctly, so this is not a hard engine wall. **The cause is not
established.** Recorded in `SPEC.md` "Scroll engine API" (KNOWN LIMITATION)
and `04_day/output/verification.md` §3 with the raw widths, so nobody
re-derives five rounds of findings; do not re-litigate the three constraints
on the theory that one of them is the missing piece. Also in `OPEN.md`.

### A retracted conclusion, and why it matters beyond this bug
For five fix rounds this stage's own probe sampled `columnsInterpolated` at
50% of the transition and concluded several paths "confirmed snap." The
expand's `--ease-spring` is `cubic-bezier(0.34, 1.56, 0.64, 1)`, which
overshoots — progress exceeds 1.0 from roughly 35% to 85% of the duration,
spanning that sample point — so a *correct* implementation, sampled there,
also reads past the end value and reports `false`. The boolean was pinned to
false by its own instrument, not by the app. It now samples at ~20%, before
the overshoot window, and only after that fix did any row report `true`. The
rule to keep, beyond this one probe: **when an instrument's own sampling
point interacts with the thing it measures (an easing curve, a debounce, a
retry window), a negative result is not evidence until the instrument is
checked against a known-good case.** Reasoning about correctness is not a
substitute for an instrument that cannot lie in this particular way.

## Planning layer rulings (2026-09-05)

The product's reference is the wall-sized year calendar (thebigasscalendar.com):
one surface, every day, marked by hand. Habits and journal (07/08) stay on
hold behind it — the habit market is saturated and the year-planning angle is
the differentiator. Made with the human in a Cowork planning session, before
any code; three parallel iteration sessions run from these.

- **A planned day is an all-day event in the primary calendar; the planning
  attributes live on the category.** `budgetDays` and `blocks` are prefs
  fields on `StoredCategory`. Rejected: one secondary Google calendar per
  layer ("Vacation", "Blackout") — cleaner in Google's own UI, but it needs
  the broader `calendar` scope, the calendarList API, and a `gcal.ts` that
  knows more than one calendar. The store rule ("Google Calendar only,
  nothing of its own") holds without any of that.
- **No AI in v1.** Vacation planning here is constraint satisfaction over a
  small set: a budget, blocked days, and the grid. Paint, count, refuse
  conflicts. "Suggest long weekends around holidays" is a heuristic for a
  later pass, not a model; nothing in the layer depends on one.
- **The strip is the mode switch.** One row of chips serves as legend,
  ledger and palette: click a chip to paint with it, click it again to
  stop. Rejected: a separate Paint button plus a palette — two controls for
  one intent, and the header is already full at phone widths.
- **The paint highlight snaps.** A selection is feedback, not motion; a
  transition on `data-paint` would put a per-cell animation on the drag
  path and a new declaration in `motion.css` for no gain.
- **Erase removes a whole run.** Splitting a run around the erased day is
  three non-atomic writes (delete, create, create) with no rollback across
  them; the month view's form already trims a run's dates. Deferred to
  `OPEN.md`, not rejected.
- **The seed is unchanged.** "Vacation" and "Blackout" are not seeded: the
  seed is frozen for colorId reasons, and not every user plans leave. Demo
  configures them in memory so the layer is visible without a sign-in.
  - **Amended 2026-09-05, before session A opened: Vacation and Blackout ARE
    seeded.** Session C's first-run copy pitches painting vacations and
    blackouts; a new install with no Vacation chip contradicts its own first
    screen and sends the user to Settings before the pitch is true. Vacation:
    colorId 7, no budget — a budget is personal and is set in Settings, the
    strip shows days used until then. Blackout: colorId 11, `blocks`. The
    "colorId reasons" were checked: the seed holds 9, 10, 5, 8, so 7 and 11
    collide with nothing, and no existing row changes. "Not every user plans
    leave" is covered by delete, which leaves Google untouched. Existing
    installs are unaffected — the seed applies only when prefs carry no
    categories. Demo no longer configures the pair; it sets a budget on the
    seeded Vacation in memory.
- **The planning layer works in both views; year first, month in iteration D
  (2026-09-05, before A opened).** The human: "we really need it to happen in
  both, I flip-flop between year and month a lot." Not folded into A because
  A's surface excludes `render.ts` and C is already in `main.ts`; a third
  session on the month grid during A and C is how merges go bad. Instead A
  builds the controller host-agnostic (SPEC "Planning layer — Both views")
  and D mounts it on the month grid after A merges. Rejected: painting in
  the year view only — the strip's ledger is useful wherever the user is
  looking, and the month view is where half their time goes.
- **New installs open in the last-used view (2026-09-05).** `defaultView`
  gains `"last"`, the default; `lastView` is written on every switch. Same
  reason: the user flips between views constantly, so any fixed default is
  wrong half the time. Supersedes "absent -> cal". Owner: session C, which
  already owns the view switch in `main.ts` and the Settings sheet. The type
  change landed on `main` before A and C branched so neither edits
  `types.ts` for it.
- **05 gate on the phone, 2026-09-05: two findings, both to session C.**
  (1) iOS auto-zoom: form fields at 12px make Safari zoom the page 1.33× on
  focus and leave it there; the cure is 16px fields under coarse pointers,
  not `maximum-scale=1`, which disables pinch zoom on Android. (2) A parked
  desktop tab never refetches: `ensureMonthsFor` ran only on range change.
  Foreground events now re-run it; the 5-minute rule is unchanged and no
  polling timer is added (a timer would fetch for nobody). The landscape
  address bar is Safari's, not ours: judged in the installed PWA.
- **05 gate on the phone, 2026-09-05, second pass: the "phone can't edit"
  report was two things, neither a touch bug.** Instrumented on the real
  iPhone (a throwaway `evlog` branch on a Pages preview, since WebDriver's
  iOS touch actions never deliver a finger-up and the automation window
  blocks real fingers): day open, event edit, Add after a zoom, and Year all
  fire a full touch → click chain. (1) The phone was in the signed-out-over-
  warm-cache state — Reconnect pill, dimmed FAB — because the quiet token
  renewal at launch runs in a hidden Google frame that Safari's tracking
  prevention blocks; one Reconnect tap fixes a visit. Whether that is
  acceptable per visit is an `OPEN.md` item, not decided here. (2) In the
  year view the first tap raises the panel and the second opens the day, as
  SPEC said; nothing on screen said so. Ruled: the panel says "Tap again to
  open" and is itself tappable on touch (SPEC amended, A's step 9).
  Rejected: first tap opens directly on touch — a phone would lose the only
  way to peek at a day without leaving the year.
- **The 14-column stretch is 1.35fr, from a measurement.** At 375px a busy
  row at 2.2fr compressed its plain days to an unreadable strip (screenshot,
  2026-09-05, signed-out cache). Closes the `OPEN.md` item opened at the
  year-view redesign; 28-column stays 2.2fr, 7-column stays off.
- **No DESIGN.md.** The awesome-design-md pattern was considered as a way to
  give parallel sessions one design source. SPEC "Visual direction — Night
  Depth" plus `motion.css` already are that source, and CLAUDE.md resolves
  conflicts to the spec; a second file would be a second truth. Polish is
  driven from the deployed app, not from a token file.
- **Three iteration sessions in parallel, on worktrees, from one amended
  spec.** The upstream edits for all three landed in this commit so no
  session amends `SPEC.md` concurrently. Surfaces are disjoint by file:
  planning (`plan.ts`, `year.ts`, `categories.ts` sanitize, the Settings
  row), demo (`state.ts` seed, `chrome.ts` demo pill/first-run button,
  README/LICENSE), polish (`style.css`, `motion.css`, `chrome.ts` first-run
  copy and sheet). `chrome.ts` is shared by demo and polish: demo owns the
  first-run buttons and the pill; polish owns copy, layout and the sheet.
  Merge order when they land: planning, demo, polish.

## Gate close — the three parallel iterations (2026-09-05)

A (planning layer), B (demo + beta on-ramp) and C (beta polish) ran on
worktrees from one amended spec, merged A → B → C as a fast-forward onto
`main` (a1adfd1) and deployed. The human passed A on the real wire (paint,
blocked paint, erase reached Google) and B on the dev server. Rulings each
session made against its contract, promoted here; the contract changes are
in `SPEC.md` under the same date.

**A — planning layer**
- `daysUsed` absorbs the cross-month duplicate (a Set of days); no caller
  dedupes. Un-budgeted categories show their used count, 0-with-no-budget is
  omitted. Erase takes the lowest-lane all-day bar, not literally lane 0.
- The strip rebuilds before `build()`'s hidden-root guard, so a budget set
  while the year is hidden lands on the next show; the strip is sticky.
- Seed twins: Vacation `#0E86C4`/`#5CC1F2`, Blackout `#B3261E`/`#F28B82`
  (crimson, apart from `--past` and `--cat-err`). The planning fields sit on
  a second line under each category row; Blocks reuses the segment control.
- The paint tint is a `background-image` layer using the bars' exact
  `color-mix`; the cell carries `data-cat` so `--cat` resolves through the
  bars' rule. `PlanHost` = root, surface, cellAt, cellsIn, dayOf, laneZeroId,
  eventsIn, bounds, createEvent, deleteEvent, toast, onModeChange; category
  label and the blocks set come from `categories.ts`, never a `year.ts`
  closure. `TAP_SLOP` is copied by value with a comment naming `main.ts`.
- Escape mid-drag releases capture, clears the paint, writes nothing, exits
  the mode; `exitMode()` is the same path. A chip click selects, the selected
  chip deselects, another chip switches directly. Over budget marks the
  figure only. The blocked-day toast is locale-formatted at the display
  boundary.

**B — demo**
- Demo is a fourth connection state in `chrome.ts`, checked before auth:
  seeded months are `ready`, so `warmCache()` would otherwise read demo as
  stale. Demo shows its pill at once and keeps the FAB live — a refused save
  is the demo's lesson. `isConnected()` keeps its meaning (false in demo);
  the FAB and `n` check demo explicitly.
- The avatar slot holds the pill AND a dot-less avatar. `?demo` is scrubbed
  at entry. The quiet token renewal at boot is skipped in demo, so a quietly
  signed-in browser cannot flip to connected mid-demo. `savePrefs` writes
  memory only in demo; `exitDemo()` re-reads storage. The seed hard-codes the
  frozen seed colorIds. The Vacation budget is written from `main.ts` through
  the one writer; `state.ts` never learns the seed list.
- Supersedes "demo does not seed prefs" above: demo writes no prefs and
  configures memory.

**C — polish**
- The "not loaded" note is `main.ts`'s, under the grid; `state.monthsNotLoaded`
  is the query. `--surface` is the ring colour on ink-filled controls; the
  first-run screen makes its root siblings `inert`. `#toasts` sits above the
  FAB strip at every width. The launch table is `state.resolveLaunchView`.
  A's Budget input is a field and gets 16px under coarse pointers. The demo
  account row reads "Demo" with a Connect on the pill's path. The phone
  header tightens (6px gaps, 8px padding, range `nowrap`) rather than the
  pill changing copy. Tickets 5, 6 and 8 verified with no change shipped.

**Gate fix on the integration tip.** The year view stayed stale after a
write made in the month view — since stage 03, `onCacheChange` cleared
`yearDirty` while the year was hidden and `year.ts` bails on a hidden root.
Only a visible year consumes the flag now; `openYear()` invalidates when it
finds it set. Found by the human at A's gate; probed both ways.

**Copy.** The first-run card pitches the year (C ticket 1), shipped as C
drafted it; the human chose to ship first and edit later.

## Follow-ups after the first planning deploy (2026-09-05, evening)

- **FAB date, amended: the open day, else today.** The stage-05 rule (the
  mid-week day of the docked week) read to the human as an arbitrary
  Thursday, and the open day's own "+ Add" already covered the open day, so
  the FAB's target was the least useful one on screen. Chosen over "open day,
  then today if visible, then the docked week": one rule with no visibility
  clause. Probed: open day → that day with the form; nothing open a year away
  → today; from the year view → today.
- **Over budget warns and still paints.** Rejected: refusing like a blackout
  — once over, that category could not be painted at all until something was
  erased; a budget is an allowance, not a rule. The count uses only the days
  the run newly adds, so a repaint over an existing run is silent. Probed
  both ways (budget 2 over three days warns "5 of 2"; budget 10 is silent).
- **The landing page replaces the splash, and covers every signed-out state
  (2026-09-05, evening).** The human: the first screen should be a landing
  page, and nobody who has not signed in should see the calendar. Chosen:
  cover always, accepting that an offline open shows the landing until the
  token survives a reload. Rejected: cover only when online — a stranger
  flips airplane mode and sees everything, so the privacy gain is cosmetic.
  Designed from SPEC "Visual direction — Night Depth", not from a DESIGN.md:
  the earlier ruling stands (one source of truth), and the page reuses the
  grid's own tokens down to a mini year drawn as tiles and runs. The
  harness keeps the old read-only state through a dev-only `uncover()`
  seam; production cannot uncover. Privacy and About are static pages in
  `public/`, linked from the landing footer, written to Google's
  verification requirements (SPEC "MANUAL SETUP — Publishing the OAuth app").
