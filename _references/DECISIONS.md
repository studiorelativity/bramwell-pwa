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
  by its own clock, without adding an export.
- A failed quiet renewal does not auto-escalate to a popup (browsers block
  it outside a gesture); it surfaces the reconnect pill instead.
- The GIS `<script>` lives in `index.html`; `auth.ts` polls `window.google`.
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
- Timed events are chips only; bars are all-day/multi-day only.
- Year view: up to 3 per-cell bars longest-first (reads as a run across
  the row); no virtualization; opening a year fetches its months; the
  hover panel survives repaints and `onCacheChange` filters by year.
- Clicking a year-view day returns to the calendar on that day.
- Day number top-right, month badge top-left, "+N" bottom-left.
- `render.ts` collects per-day markers during lane packing, not with a
  per-cell lookup (~98 redundant scans per repaint otherwise).
- Hidden-state fix: any selector that sets `display` must re-assert
  `[hidden] { display: none }`.
- Flex-gap trap: text nodes are not flex items; wrap titles in a span.

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
  leaning inline. Year-view hover panel restyled in the same tokens in a
  later pass.

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

