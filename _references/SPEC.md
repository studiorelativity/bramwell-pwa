# Bramwell — Build Spec (consolidated 2026-08-29)

This is the single contract for the rebuild. It is the last-known-good state
of every decision made across the v3 build (stages 01–08) plus the approved
stage 09 direction, with everything rejected or superseded removed. History
lives in `DECISIONS.md`; this file only says what to build.

Three products, three stores, one shell:

| Concern | Store | Spec |
|---|---|---|
| Calendar and appointments | Google Calendar (only) | this file |
| Habit tracker | Supabase | `HABITS.md` |
| Journal | Markdown files in the Obsidian vault | `JOURNAL.md` |

The calendar never stores anything of its own beyond a localStorage cache
and prefs. Nothing about a habit or a journal entry is ever written to
Google Calendar. (v3 stored day notes as Google Calendar events; that is
retired — see `JOURNAL.md`.)

---

## What this is

A single-user PWA (desktop + mobile, one codebase): a perpetual calendar that
scrolls vertically through time. Rows are weeks — seven columns, Monday to
Sunday — stacking downward forever in both directions. There is no year
boundary and no month container: months are labels, not walls.

Backed by the user's real Google Calendar. Full create/edit/delete.
User-defined categories map to Google colorIds.

## The core interaction: the rolling month

Every week row is the same height, always at full detail. There is no zoom
and no lens (built, tried, rejected — do not retry).

- Week rows are uniform, sized so roughly **6.5 weeks fill the viewport**,
  proportional to viewport height within clamps (74–190px).
- Scrolling **snaps to half-month anchors** — the 1st and the 16th. A
  15 / 30 / 45 setting (in Settings, persisted) controls how many anchors
  are skipped: every anchor, every other (the 1st of each month), every
  third. Anchors are real dates, never a rolling day count (a day count
  drifts ~5 days/year against the calendar).
- The anchor comes to rest at the **vertical centre** of the viewport
  (`SNAP_ALIGN = 0.5`). At 30 a stop straddles a month boundary; at 15 a
  stop on the 16th frames a whole month.
- Momentum settles into the detent softly; it does not hard-stop. Haptics
  and sound are off; the detent is visual.
- On first load the view rests on the anchor nearest today, today marked.
  `prefs.lastDockedDay` is written but not read at launch.

## Year view

Toggled from the header. One calendar year at once, no scrolling on desktop.

- A continuous **week-aligned grid, 28 day columns per row** (four weeks),
  first row indented by the weekday of 1 January. Tablets AND phones fall
  back to 14 columns (a 390px phone scrolls about one row — accepted at the
  stage-03 gate); 7 only below 360px.
- **2026-08-30: strict column alignment is traded away.** Every column was
  the same weekday all year; month spines and stretched event days (both
  below) each insert or widen a track, so that no longer holds. It is a
  deliberate trade, not a regression: the per-cell weekday letter (`.yrwd`)
  carries the weekday instead, and the weekend shade stays per-cell
  (`data-weekend`), so weekend banding survives approximately. Supersedes
  the stage-03 phrasing; the 14-column phone ruling is unchanged.
- Each cell: weekday abbreviation, day number, the month band and weekend
  shade, and up to **3 thin category-coloured
  bars** for that day's events, longest-first so a multi-day event holds
  one lane across the row. More than 3 are dropped in the grid; the panel
  lists them all. **"Events" includes timed ones**, unlike a calendar week
  row where a timed event is excluded from the bars because it has a chip
  instead: this grid has no chips, so excluding them made a day of timed
  events read as empty. A timed event is a single-cell bar on its start day.
- **Month spine (2026-08-30).** Between the last cell of a month and the 1st
  of the next — and before the year's first in-year cell — a narrow non-day
  track carries the full month name in caps, reading bottom-up
  (`writing-mode: vertical-rl`). Desktop 24px and the full name; 14-column
  layouts 18px and a 3-letter name. **The spine replaces the `.badge` month
  label in the year grid**, which is why "Layout details" now exempts this
  view from identical badge treatment: two month names on the 1st would be
  the same duplicate rendering CONVENTIONS' stand-down rule exists to stop.
  Its colour is neutral, never `--today`. **Amended 2026-08-30 after the first
  deploy: the name is `--ink` on a `--surface` ground, not `--ink-dim` on
  `--band-b-end`.** The original was legible on paper — 5.1-5.9:1, above AA —
  but unreadable in practice, and measuring showed why: at `--band-b-end` the
  spine sat **1.01:1** against the cells beside it, optically identical, so it
  read as a gap with faint text rather than a divider. The band ladder is
  deliberately shallow, so no background choice separates the spine by more
  than ~1.1:1 — the label itself has to carry it. `--surface` makes the spine a
  recess in the tile field (the Night Depth shape: tiles on a ground, needing
  no hairline to define them), and `--ink` put the name at **14.9-15.4:1**
  across all five moods in both schemes. Raised to `--ink-strong` (pure white
  in dark, pure black in light, 17.9-18.6:1) and it STILL read faintly, which
  settled the diagnosis: at 10px, uppercase, rotated 90 degrees, the limit is
  **stroke weight, not contrast ratio** — no colour choice was going to fix it.
- **The spine is INVERTED (2026-08-31, and this is the version that works):** a
  solid `--ink-strong` block carrying `--surface` letters, so the BLOCK is the
  marker and the name is negative space inside it. That sidesteps stroke weight
  entirely — a filled 24px bar reads at a squint where 10px rotated strokes
  never did, which is the whole point of the spine. 17.9-19.0:1 across all five
  moods in both schemes. **The calendar's month name is inverted to match**, so
  a month boundary looks the same in either view.
  Three attempts to reach this — `--ink-dim`, `--ink`, `--ink-strong` — each
  measured comfortably above AA and each reported as hard to see. Recorded so
  the next person reads it as the lesson it is: when a legible contrast ratio
  keeps failing in practice, the variable being measured is the wrong one. The spine's own text sets its row's
  minimum height, so a long month name grows its row rather than being cut.
- **Event-day stretch (2026-08-30), static.** A cell carrying at least one
  event gets a wider track (2.2fr against 1fr at 28 columns; **1.35fr at 14,
  retuned 2026-09-05 from a device measurement** — see "Planning layer");
  not applied on 7-column layouts. At 28-column widths a stretched cell also shows up to 2 event
  titles inline — one line each, ellipsised, with a category dot — between
  the day number and the bars. **No track size in the year view is ever
  animated**: interpolating `grid-template-columns` is a recorded KNOWN
  LIMITATION (see "Scroll engine API"), so the template is computed once per
  `build()` and nothing transitions it. Hover feedback is the existing Night
  Depth lift instead.
- Day numbers on event days render `--ink` at weight 620; ordinary days stay
  `--ink-dim`. Today keeps `--today`, its ring and its number — unchanged.
- Cells with events take the Night Depth hover lift (`translateY(-2px)` plus
  the `--ring` fade, compositor properties only, declarations in
  `motion.css`). The panel contract below is unchanged.
- The panel's date is formatted by **locale**, never a hardcoded `d/m` — that
  reads as a 30th month to a US reader. `timeZone: 'UTC'`, since `DayNumber`
  is a UTC civil date.
- **Hover raises a panel** showing previous / hovered / next day with every
  event in full (title, meridiem start time for timed events). Panel is
  `pointer-events: none`, flips above the cell when there is no room
  below, and **survives background repaints** (rebuilt in place, never
  hidden, unless the displayed year changes).
- **Touch**: first tap raises the panel, second tap on the same day opens
  that day in the calendar view, a tap elsewhere dismisses.
- `<` `>` step the year. **Clicking a day returns to the calendar view on that
  day — positioned at its week AND expanded (amended 2026-08-31).** "On that
  day" previously delivered only the scroll: you landed on the right week with
  nothing open, which is indistinguishable from landing on any of its six
  neighbours and reads as the pick having been ignored. The day now arrives
  with its inline expansion open. Ordering is load-bearing — `goToWeek` settles
  the week synchronously, then `openDayAt` defers a frame and the `setExpanded`
  behind it runs `fitY`; both want the same week, so `fitY` refines the
  position instead of fighting it. Opening a year calls `ensureMonthsFor` for
  its months.
- No virtualization: 365 cells rebuild in one pass. `onCacheChange`
  filters by year before repainting.

## Planning layer (2026-09-05)

The product's reference is the wall-sized year calendar: one surface, every
day visible, marked by hand, so what is planned and what is still open are
read in one glance. The year view above is that surface; this section adds the
verbs it was missing. Nothing here adds a store: a planned day is an ordinary
all-day event in the user's Google Calendar, and the two planning attributes
live on the category in prefs.

- **Category planning fields.** `StoredCategory` gains two optional fields:
  `budgetDays?: number` (integer, 1–366; the days-per-calendar-year the user
  means to spend on it — "Vacation: 30") and `blocks?: true` (days carrying an
  event of this category may not be planned over — "Blackout"). `sanitize()`
  drops an invalid `budgetDays` (non-integer, out of range) and any `blocks`
  that is not literally `true`, keeping the row. The seed is unchanged: no
  seed category has either field. Settings' category row gains a Budget
  number input (blank = none) and a Blocks toggle; both are structural edits
  for the row-rebuild rule.
- **The plan strip.** A row of category chips inside the year view, between
  the header and the grid, always visible in the year view. Each chip: the
  category dot and label; when the category has a budget, "used / budget"
  in tabular figures; when it `blocks`, its day count alone. **Used** = the
  number of distinct days in the DISPLAYED year covered by at least one
  all-day event of that category — overlapping runs count a day once, timed
  events never count. Over budget renders the figure at `--ink-strong`
  weight 620 and nothing else: no reserved hue, no third colour. On phone
  widths the strip scrolls horizontally. An empty strip is impossible (the
  fallback category always exists), so it has no empty state.
- **Paint mode.** Clicking a chip selects it and enters paint mode; clicking
  the selected chip, Escape, or leaving the year view exits. In paint mode
  the hover panel is suppressed (it would flicker under a drag) and pointer
  down on a day cell begins a run: the grid captures the pointer, the cell
  under the pointer is found with `elementFromPoint` on every move, and the
  run is `min(startDay, currentDay) .. max(...)` inclusive — a date range,
  not a rectangle, so dragging across rows selects the days between, like
  selecting text. Cells in the run carry `data-paint`; its highlight is the
  category's bar fill (16%) on the cell, and it **snaps, deliberately** — a
  selection is not motion, and it stays out of `motion.css`. Pointer up
  writes ONE all-day event: title = the category label, category = the chip,
  `repeat: 'none'`, the run's start and end. The existing optimistic path
  repaints the year through `onCacheChange`; the strip's figures update in
  the same repaint. A run clipped to the displayed year at both ends. On
  touch, the grid takes `touch-action: none` only while paint mode is on,
  so a finger paints; exiting restores scrolling.
- **The conflict rule.** If any day in the run carries an event of a
  `blocks` category, and the chip is not itself a `blocks` category, the
  write is refused before the optimistic apply, with a toast naming the
  first blocked day ("Aug 14 is blocked"). Painting a `blocks` category is
  always allowed — that is how blackouts are laid down — including over
  existing plans; v1 does not warn in that direction (`OPEN.md`).
- **Erase.** The strip's last chip is Erase, category-agnostic. In erase
  mode a click on a day removes the ONE all-day event under it — the
  topmost bar in that cell (lane 0) — as a whole run, via
  `deleteEvent(id, 'instance')`, optimistic like any other write. A day with
  no all-day event does nothing; a recurring instance is refused with a
  toast ("Recurring — edit it from the month view"). Trimming a run by a day
  is done from the month view's form; split-on-erase is an `OPEN.md` item.
- **Pure core in `src/plan.ts`** (added to the file layout below), DOM-free,
  imports `types.ts` and `dates.ts` only: `runOf(a, b, yearStart, yearEnd)`,
  `daysUsed(events, categoryName, yearStart, yearEnd)`, `firstBlocked(run,
  events, blockingNames)`, `sanitizePlanning(row)`. All four are covered by
  the node selftest before any DOM is wired. `year.ts` consumes them and
  owns the strip, the drag, and the writes through `state.ts` (it already
  imports `state.ts`; it never imports `gcal.ts`). `YearHost` gains
  `toast(message: string): void` so write errors surface without `year.ts`
  importing `chrome.ts`.
- **Year-view stretch is retuned by column count.** The 2.2fr event-day
  stretch was measured on device (2026-09-05, 375px): a busy 14-column row
  compresses its ordinary days below legibility. The factor becomes 2.2 at
  28 columns and **1.35 at 14**; still off at 7. Thirty painted vacation days
  would otherwise make the phone year unreadable. Closes the `OPEN.md` item.
- **Both views (amended 2026-09-05).** The layer belongs to the calendar,
  not to the year view: the strip, paint mode, the conflict rule and erase
  work in the month view too, on the month grid's day cells. The year view
  ships first (iteration A); the month view follows in iteration D, after A
  merges, mounting the same controller on the month grid. To make that a
  mount and not a rewrite, A builds the drag/paint/erase controller against
  a host interface — a root element, a way to resolve a pointer position to
  a day cell, a way to enumerate the cells of a run, and the write/toast
  callbacks — with no dependency on `year.ts` internals beyond that. Where
  the strip sits in the month view (the header row, or a row that scrolls
  with the grid) is D's brainstorm, not decided here.
- Not in this layer: AI suggestions, holidays, a second Google calendar,
  weekend/weekday budget accounting. Recorded in `OPEN.md` with the reasons.

## Layout details

- 7 equal columns; weekend columns get a subtle shade layered over the
  month band.
- Months alternate a neutral background band **per day column** (keyed on
  `month % 2`, so Dec/Jan differ). A week straddling a boundary shows both.
- Sticky header, left to right: the month(s) or year in view (heavier
  weight; "Aug – Sep 2026" when the view straddles, which at rest it does;
  cross-fades on change; the window is the docked week ±3), year steppers
  (year view only), the **Month/Year** toggle, a Today button, the account
  avatar. **2026-08-31: the toggle reads "Month"/"Year"** — it said "Cal",
  which named the implementation rather than what the user is looking at.
  The app name sits **centred on the header**, positioned against the header
  itself rather than as a flex sibling, so the range label's width cannot
  shift it; `pointer-events: none` so it can never eat a click aimed at a
  control, and hidden at phone widths where the bar is already full.
- **Today button** goes to today without changing the view: calendar
  scrolls and re-snaps; year view pages back to the current year. The
  Month/Year toggle is the only control that switches views.
- A floating add button, bottom-right, safe-area aware, both views. Opens
  the event form pre-filled with the date nearest viewport centre
  (calendar: mid-week day of the docked week; year: today). `n` on desktop
  does the same, ignored inside inputs or with a day open. It must not
  cover the last row's Sunday events on a notched phone.
- **A named month marker at each boundary, inline, from the 1st to the end of
  that week row. Amended 2026-08-31: the `.badge` is gone from BOTH views.**
  The year grid has its vertical spine; the calendar has the horizontal
  equivalent — a transparent strip carrying the boundary line, with the full
  month name in `--ink` caps on a `--surface` recess at its left end, where the
  badge used to sit. One name per boundary, never two (CONVENTIONS' stand-down
  rule).
  **The calendar strip must stay transparent**, and this is measured, not
  taste: it occupies the row's top 0-15px and `.daynum` sits at `top: 3px`, so
  a filled band covered the day number of every day in the month's first week.
  The name rides at the left because day numbers are top-RIGHT; that is the one
  place in the row it collides with nothing. It remains absolutely positioned
  inside the week row, exactly as the 1px hairline it replaced was — no layout
  height, and the virtualizer never learns it exists, so uniform row maths and
  the single variable-height row are untouched.
- **All-day and multi-day events render as bars** spanning their days
  within each week row, wrapping across consecutive rows. Longest-first
  lane packing. Title once, on the true start; continuations carry no
  title, keep a flat edge on the broken side, and drop the spine.
- **Timed events render as chips only** (no thin bars), sorted by start,
  with a category dot, muted tabular start time, and title.
- Day numbers **top-right**; the month name **top-left** at a boundary row
  (2026-08-31: this replaced the `.badge`); "+N" overflow **bottom-left**;
  habit/journal markers bottom-right (see their specs).
- Tap/click a day → **inline day expansion** (below). No overlay drawer.
- **The drag surfaces suppress text selection (2026-08-31).** Dragging the
  scroller IS how you scroll it, and `scroll.ts` captures the pointer to do
  that — but nothing stopped the browser reading the same drag as a text
  selection, so a scroll, or even a tap that moved a pixel, highlighted every
  day number it passed over. `touch-action: none` governs gestures, not
  selection; `user-select: none` on `.scroller`, `.yearview` and `.hdr` is what
  does it. The day panel and the year panel opt back **in**: an event title is
  worth copying, and form fields must stay editable.
- **The open day carries a 1px `--ink-strong` inset ring (2026-08-31)**, not
  elevation alone. It shipped at 2px and was immediately too heavy: that
  outweighed both the 1px hover ring and today's own 2px accent, inverting the
  hierarchy so the open day shouted louder than the one day the palette
  reserves a hue for. A hairline at full ink separates without dominating. The open elevation is the third and last shadow level but it
  has no edge, so an expanded day — especially one arrived at from the year
  view — did not read as picked. `--ring` is the hover weight and `--today` is
  reserved, which leaves the strong neutral. Today's own accent ring is a
  `::before` pseudo-element and paints over this one, so an open today keeps
  its identity.

## Visual direction — Night Depth

Approved 2026-08-29 (reference: the "Bramwell Calendar" design canvas,
week-view + motion-primitives artboards). **Token values live in
`categories.ts` `MOODS` since the stage-03 gate** (DECISIONS "Stage 03 gate
close"); the canvas is history, not the source.
Where v3's "warm neutral, hairlines, no elevation" direction conflicts,
this section wins; v3 clauses it does not address still govern (type,
bar treatment, restraint).

- Layered, dark-first. Day cells are rounded (12px) raised tiles on a
  near-black ground, not hairline-ruled grid cells. Month structure reads
  through tile surface value (in-month vs out-month, weekend shade).
- Exactly three elevation levels: resting cell, hovered cell, open day.
  Nothing else casts a shadow.
- Hover: cell **presses down** `translateY(2px)` (amended 2026-09-02 — it
  lifted up until the elapsed-time rail arrived at the row's top edge; a 2px
  lift put the tile's edge into the rail's band, so the rail cut across the
  tile and covered the ring on today or the open day), shadow deepens, a 1px neutral ring
  (`--ring`, never `--today` — that hue is reserved for today's own mark and
  used for nothing else) fades in (compositor properties only: opacity and
  transform, never box-shadow, which repaints every frame).
- Today: accent inset ring on the cell plus accent day number. `--today`
  is reserved for today's own mark and used for nothing else. Today is
  distinguished by **form** so a red category can never read as today.
- **The elapsed-time line (2026-08-31).** Every day of the **current calendar
  year** carries a 2px line along its top edge: `--past` (red) on days behind
  today, `--future` (a quiet neutral track) on days ahead, with today's own
  ring between them. Read across a row it is a progress bar through the year
  — the track is the year, the red is how much of it has gone, today is the head. `--past` runs at **half opacity** — a reference line, not
  a commitment, and Night Depth keeps full strength for the event bars; opacity
  rather than texture, because a dashed line across 240 cells is the busy-ness
  the row-level rail exists to remove. Days outside the current year carry neither, so scrolling into last
  year shows a plain grid: the line answers "where am I in THIS year", not
  "is this date in the past". Same treatment in both views. `--past` is the
  second reserved hue, alongside `--today`; neither is a category colour and
  a red category bar is a filled 18px shape, not a 2px edge, so the two
  cannot be confused. **It is drawn per ROW, not per cell** — one straight
  segment per class in the row's overlay grid (`.bars` / `.yrbars`), spanning
  the past (or future) columns as a single item, so it runs unbroken across
  the tile gaps. The first version was a 2px edge on each cell's own `::before`;
  a rounded tile with a gap either side breaks that at every corner, and ~240
  past days read as ~240 red arcs. A month spine sits above the overlay and
  interrupts the segment visibly, which reads as a month tick on the rail.
- Light mode gets the same structure with inverted surface logic; dark is
  the design-lead mode. `prefers-color-scheme` is honored.
- Event bars: category colour at ~16% as fill, full colour for text and a
  3px left spine, 5px radius. Dark mode uses brightened category variants
  (light hues fail contrast on tinted dark fills).
- **The four band tokens are `--band-a`, `--band-a-end`, `--band-b`,
  `--band-b-end`** — month parity (`month % 2`) crossed with weekday/weekend.
  A cell carries `data-band="a|b"` and `data-weekend`, so a week straddling a
  month boundary shows both bands without special-casing. Keeping the weekend
  shade as a token rather than an opacity is what stops moods reaching past
  `--surface` and the bands.
- **The ladder is fixed; a mood shifts hue and temperature only** — that is
  what "band contrast is a property of the set" means. Dark, relative to the
  ground: `--band-a-end` +2.5, `--band-a` +4, `--band-b-end` +4.5, `--band-b`
  +6 points of lightness. Light inverts the surface logic (ground mid-light,
  tiles lighter) at the same step ratios.
- Restraint rule: the user's commitments are the only strong colour on
  screen. Mood tints only move the quiet ground beneath them. **One sanctioned
  exception (2026-08-31): the elapsed-time line.** It is structural, like
  today's ring, not decorative — and it is held to a 2px edge, never a fill,
  so ~240 past days do not become a red field.

## Inline day expansion

Replaces the overlay drawer. Click a day and it grows in place inside its
week row — row height and the row's `grid-template-columns` animate
together, neighbours compress. The expanded day carries: the event list,
the add/edit form, the habit checklist (`HABITS.md`), and the journal link
(`JOURNAL.md`).

- One day open at a time; opening another collapses the first; Escape
  collapses; scrolling does not force-collapse. **Leaving for the year view
  collapses it too (2026-08-31, confirmed by the human).** The expansion is
  calendar state: a day expanded in a view you have left is not one of the
  cases above, and keeping it alive gave the scroll position two owners —
  `fitY` holding the old row on screen against `goToWeek` jumping to a picked
  day, with the deferred one winning. Collapsing on the way OUT removes the
  second owner at its source rather than making every future caller of
  `goToWeek` remember to close first.
- The virtualizer must support **exactly one variable-height row**: rows
  below the expanded one shift by an animated delta. If this cannot be
  done cleanly, stop and revise — do not fake it with an overlay.
- **Phone (≤560px): inline full width.** Ruled at the stage-04 plan. The other
  six columns go to `0fr` and the column gap to zero, so it is the same
  `grid-template-columns` mechanism as the desktop `3fr`, not a second shell.
  The bottom sheet stays rejected (`DECISIONS.md` "Rejected — do not retry").
- **The collapsed read-out stands down while the day is open.** The panel is
  the read-out; the cell's own `.chips` and `.more`, and the row-level `.bars`
  and `.rule` crossing it, must not also be showing. This is not cosmetic:
  `.chips`/`.more` are positioned against the cell's BOTTOM, so a cell grown to
  fit the panel pins them on top of it, and every event renders twice — once as
  a `.dp-ev` pill in the list, once as a bare chip over the bottom of that list.
  The six collapsed neighbours keep their own bar segments; only the open cell
  covers the one crossing it. The day number and the month badge stay: they are
  the cell's identity, and the panel's top margin is their clearance.
- Transient-UI rule: a background month refresh must never close the
  expanded day, reset the form, or wipe text being typed. `refresh()` is
  a no-op while the form is open.

### Day module API (`src/day.ts`)

```
configure(host: DayHost): void
expand(day: DayNumber, into: HTMLElement): void   — attach the panel, rebuild the list
beginCollapse(): void                             — fade the content, panel stays until detach
detach(): void                                    — remove the panel from the DOM
openAdd(day: DayNumber): void                     — the FAB entry point
refresh(): void                                   — rebuild the list; NO-OP while the form is open
isFormOpen(): boolean
closeForm(): void                                 — close the form, keep the day open
contentHeight(): number                           — panel offsetTop + offsetHeight, 0 unattached
validate(draft: EventDraft): string | null        — pure; null when writable
DayHost = { toast(message), onHeightChange(), onFormClosed() }
```

`day.ts` owns ONE panel node and moves it between cells. A refill or a resize re-attaches
the same DOM, so typed text cannot be wiped by anything but an explicit rebuild — and
`refresh()` refuses to rebuild while the form is open.

## Motion

- Tokens in `:root` beside colour tokens: `--t-fast: 140ms`,
  `--t-base: 240ms`, `--t-open: 380ms`, `--t-stagger: 40ms`,
  `--t-toast: 3200ms`,
  `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)`,
  `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)`. **No transition or
  animation value may appear outside the token layer.**
- **Carve-out: the scroll engine's physics constants are not motion tokens.**
  `PROJECT_MS`, `SETTLE_BASE/PER_WEEK/MAX_MS`, `WHEEL_GAIN`, `WHEEL_IDLE_MS`
  and `easeOutCubic` drive imperative rAF math, not CSS transitions; they
  cannot be expressed as custom properties and "Perpetual scroll mechanics"
  requires them at the top of `scroll.ts`. The boundary: **a value that
  drives a CSS transition or animation belongs in `motion.css`; a value that
  drives per-frame arithmetic belongs in `scroll.ts`.** No third home, and
  neither kind may appear as a literal at a use site.
  (Stage 04 ruling: the expand is driven by CSS, so its duration lives in
  `motion.css` and `scroll.ts` gains no new constant. `scroll.ts` reads the
  effective duration back off the element's computed style to know when the
  animation ended — a token read, not a literal.)
- Hover enters `--t-fast --ease-out`, leaves `--t-base`. Expand runs
  `--t-open --ease-spring`; content staggers in 40ms apart (fade + 6px
  rise). Collapse runs `--t-base --ease-out`, content fades first, no
  stagger.
- One shared enter/exit utility solves display:none-vs-animation once, with
  three states: `.enter` (hidden at rest — the before-change style), `[data-in]`
  (entering, staggered by `--i`), `[data-out]` (leaving, opacity only, never
  staggered). A caller forces a reflow (`void node.offsetWidth`) between
  adding `.enter` and setting `[data-in]`, so the browser commits the hidden
  style before the transition-eligible one is applied — that forced reflow is
  what makes the transition run, not `@starting-style`/`transition-behavior:
  allow-discrete`, which this utility does not use. Components never write
  their own transitions. A component sets `--i` as a plain integer; the 40ms
  cadence stays a token.
- `prefers-reduced-motion`: everything collapses to 80ms opacity-only.
  Carve-out: a toast's animation is its LIFETIME, not motion. Collapsing it to
  80ms would make an error unreadable, so under reduced motion the toast keeps
  `--t-toast` and swaps to opacity-only keyframes.
- Performance: hover animates compositor properties only. The expand
  row-height animation is the one permitted layout animation, contained
  to the scroller. 60fps on a mid phone is a gate criterion.

## Event form

Ported behaviour (content contract unchanged from the drawer):

- Fields: title (required), category chips (the user's list, labels not
  names), all-day toggle, start/end (all-day end is **inclusive** in the
  form), repeat (RRULE; **disabled when editing**), notes → `description`.
- Recurring events show a scope picker (this occurrence / whole series),
  default "this occurrence". Series delete confirms first.
- Validation and write errors surface in the form **and** as a toast.
  `chrome.toast` is built at stage 04, because that is where the first write
  error can happen; `chrome.mount` stays a stage-05 stub. The file layout puts
  toasts in `chrome.ts` and that is where they go — no interim home to delete
  later.

## First-run and connection state

- Cold start, no auth, no cached months: first-run screen — app mark,
  name, one-line description, three plain lines of what to expect,
  Connect Google Calendar (wraps `auth.signIn`), "Try the demo", a note
  that events live only in Google Calendar, and a low-emphasis support
  mailto. `place-items: safe center` + `overflow-y: auto` so Connect is
  reachable on the shortest phone.
- Cached months but stale auth: calendar renders read-only from cache
  with a reconnect pill in the header (after a 2.5s grace so quiet renewal
  does not cry wolf). The first-run screen never covers a warm cache.
- Signed in: a generic avatar with a connection dot bound to auth state
  (no profile scope — `calendar.events` carries no name). Avatar opens
  Settings.
- **A signed-out session issues exactly one token request.** `getToken()`
  already coalesces concurrent callers, so a cold window's dozen month loads
  share one attempt; the damage is the *loop*. Every range move re-runs
  `ensureMonthsFor` over months left in `error`, `needsFetch` says yes again,
  and on a phone each retry is a popup the browser blocks without a gesture —
  observed on iOS Safari as dozens of `Failed to open popup window` per
  second, self-sustaining for as long as the view keeps moving. The auth gate
  in "State API" caps this at one attempt per session. The consequence to
  hold onto: **a signed-out phone cannot recover by itself**, because the
  popup path needs a gesture, so the reconnect pill and the first-run Connect
  button are the only ways back.

## Settings

A sheet from the avatar: account row ("Google Calendar · Connected") with
sign-out; snap 15/30/45; default view (labelled Month/Year, stored as `cal`/`year`); a **Colors** section
(below); Mood; sound row is a labelled stub. All prefs; no new storage. A
background refresh must not close or reset the sheet.

The whole of `prefs` (`bramwell.prefs.v1`). Every field is optional so a
blob written by an older build still loads and `state.ts`'s fallbacks keep
compiling:

```
categories?       StoredCategory[]     absent -> seed
fallbackCategory? name                 absent -> "other"
mood?             MoodId               absent -> "warm"
snapStepDays?     15 | 30 | 45         absent -> 30
defaultView?      "cal" | "year" | "last"   absent -> "last"
lastView?         "cal" | "year"       written on every view switch
lastDockedDay?    DayNumber            written at dock, not read at launch
```

`defaultView` **is** read at launch, unlike `lastDockedDay`: the view a
session opens in is a setting, where the scroll position is not.
**Amended 2026-09-05:** the setting has three values. `"cal"` and `"year"`
open that view; `"last"` (the default for new installs, and what an absent
field means) opens the view the previous session ended in, read from
`lastView`, which `main.ts` writes on every Month ↔ Year switch. Absent
`lastView` under `"last"` opens the month. The Settings segment reads
Last / Month / Year. The view IS a setting and the last-used view IS the
sensible default: the user switches between them constantly, and a fixed
default would be wrong half the time.

## Categories and customization

Categories are the user's own list, prefs-backed:

```
StoredCategory         = { name, label, colorId, displayHex?, budgetDays?, blocks? }
                         (budgetDays and blocks: "Planning layer", 2026-09-05)
prefs.categories       — StoredCategory[]   (absent -> seed)
prefs.fallbackCategory — name               (absent -> "other")
prefs.mood             — mood id            (absent -> "warm")
```

- `name` is the stable key (`CalendarEvent.category`, `data-cat`). Never
  changes; **renaming edits `label` only.** New names are a slug of the
  label, uniquified against the current set.
- **Seed** (frozen — existing events carry these colorIds):

  | name | label | colorId | displayHex | dark twin |
  |---|---|---|---|---|
  | work | Work | 9 | #3056D3 | #7B96FF |
  | personal | Personal | 10 | #17925A | #4FC48D |
  | financial | Financial | 5 | #D97706 | #F0A13C |
  | other | Other | 8 | #64748B | #94A3B8 |

  Display hexes are explicit overrides — Google's own hexes for 9/10/5/8
  are different colours. Dark twins are hand-picked for the seed; every
  other colour is derived (`brighten()`: HSL, lightness floor 0.62,
  saturation cap 0.72).
- Add, rename, remove. **Ceiling 11** (Google has 11 event colorIds; the
  colorId is the only channel by which a read resolves to a category).
- **INVARIANT: no two categories share a colorId.** Enforced in the UI
  (taken colorIds disabled in other rows) and in the loader (`sanitize()`
  treats the stored blob as untrusted: drops missing name/label, unknown
  colorId, duplicate name or colorId; caps at 11; first writer wins).
- One category is always the **fallback**: unknown/absent colorId resolves
  to it; it cannot be deleted. Role lives in `prefs.fallbackCategory`.
- **Deleting a category never touches Google.** Its events keep their
  colorId and resolve to the fallback on the next read/render.
- **Google colour table.** `categories.ts` owns and exports it — the 11
  colorIds with Google's own name and hex. Stage 05's settings dropdown is
  its consumer; it is also the light-mode hex for any category with no
  `displayHex`. Hexes below are transcribed from Google's palette and are
  **unverified until a gate opens an event in the Google Calendar app**.

  | id | name | hex | id | name | hex |
  |---|---|---|---|---|---|
  | 1 | Lavender | #7986CB | 7 | Peacock | #039BE5 |
  | 2 | Sage | #33B679 | 8 | Graphite | #616161 |
  | 3 | Grape | #8E24AA | 9 | Blueberry | #3F51B5 |
  | 4 | Flamingo | #E67C73 | 10 | Basil | #0B8043 |
  | 5 | Banana | #F6BF26 | 11 | Tomato | #D50000 |
  | 6 | Tangerine | #F4511E | | | |

- **Dark twins are keyed on the light hex, not on category identity:**
  `light = displayHex ?? googleHex(colorId)`, then
  `dark = TWINS[light] ?? brighten(light)` over the four seed twins. This
  survives renames and colorId changes with no bookkeeping, and a hand-
  picked `#3056D3` gets the curated twin rather than a derived one.
- **Two colour layers.** Layer 1: the Google colorId (dropdown of the 11
  with Google's names — Lavender, Sage, Grape, Flamingo, Banana,
  Tangerine, Peacock, Graphite, Blueberry, Basil, Tomato). **Changing it
  affects new writes only; never mass-PATCH history.** Layer 2: optional
  display hex overriding on-screen rendering everywhere. When they
  disagree the settings row shows both swatches — divergence is a
  feature, never a surprise.
- **Mood**: fixed list — Warm (default), Paper, Cool, Sage, Dusk. Each
  sets `--surface` and the four band tokens only, light and dark, on the
  default's luminance ladder (band contrast is a property of the set).
  Never `--ink*`, `--rule*`, `--today`, or category colours.
  **Values: stage 03.** Only Warm's `--surface` exists in-repo (the seed
  paint in `index.html`); the other four moods and all four band tokens
  live in the design canvas, which "Visual direction" defers to and which
  is not in the repo. `categories.ts` ships the mechanism with a `MOODS`
  table holding Warm only, so the other four ids resolve to Warm until
  stage 03 fills it from the canvas. No palette is invented in stage 02.
- Settings UI: one row per category (label editable in place, colorId
  dropdown, display swatch with clear, delete on every row but the
  fallback's — two-step "Remove?" button, not `confirm()`), add row
  disabled at 11 with the reason, Mood selector. Label edits do not
  rebuild the row; structural edits do.
- `categories.ts` stays DOM-free and never imports `state.ts`; `main.ts`
  pushes prefs in via `configure(...)`, at bootstrap and again on any
  prefs change, so there is one writer. The module initialises to the seed
  so a read before `configure()` resolves to seed colours, never throws.
  `configure()` substitutes the seed when `sanitize()` yields nothing —
  zero categories would leave `fallback()` with nothing to return. Runtime colours are emitted by
  `main.ts` into one `<style>` element from `categories.themeCss()`
  (`[data-cat]` rules plus `--cat-<name>` properties plus mood tokens).
  `:root` values in `index.html` are seed paint only. `render.ts` sets
  `data-cat` and nothing else per frame.

## Demo mode

Entry: "Try the demo" on first-run, or `?demo`.

- Seeds ~17 months of deterministic events (mulberry32, fixed seed,
  anchored to today) into the in-memory cache only. Seed exercises every
  render path: a 21-day span across three rows, weekly recurring timed
  chips with `recurringEventId`, monthly/quarterly financial all-days,
  weekend spans, one day that overflows the year cell's 3 bars, all seed
  categories.
- localStorage is never written in demo. `ensureMonthsFor` and every
  network path are inert; unseeded months stay empty. Zero requests to
  googleapis.com.
- Writes reject with `DemoError` ("Demo — connect your Google Calendar to
  save.") **before** the optimistic apply. Customization works in memory
  and persists nothing; leaving demo re-runs `configure()` from prefs.
- **Demo shows the planning layer (2026-09-05).** Demo pushes an in-memory
  category set through `configure()` — the seed plus `vacation` (label
  "Vacation", colorId 7, `budgetDays: 30`) and `blackout` (label
  "Blackout", colorId 11, `blocks: true`) — and seeds a few Vacation runs
  and a Blackout block so the strip reads something like "12 / 30". This
  narrows DECISIONS' "demo does not seed prefs": it still writes no prefs;
  it configures memory, which leaving demo already resets. A paint in demo
  hits `DemoError` like any other write.
- Header shows a "Demo · Connect" pill in the avatar's slot; clicking it
  (or Connect anywhere) exits demo and starts sign-in. Demo never survives
  a reload.

## Perpetual scroll mechanics

- Virtualized: only the rows the viewport needs plus a buffer (14 rows at
  every viewport), nodes recycled, transform-positioned
  (`placeRow(node, y, height)`, two style writes per row per frame).
  Week index is the layout coordinate (week 0 = the week containing today,
  captured at anchor time, not read live).
- Load events lazily by month as weeks come within ~8 weeks of the
  viewport, both directions. Cache per `year-month` in localStorage;
  render from cache instantly, background-refresh visible months.
- 60fps on a mid-range phone: no layout thrash in the scroll handler.
- Touch: `touch-action: manipulation` on `html, body`, `touch-action: none`
  on rows, `preventDefault` on `dblclick` and Safari's
  `gesturestart/change/end`. (`user-scalable=no` alone does nothing on
  iOS; the meta stays for installed-PWA and Android.)
### Scroll engine API

```
scroll.mount(root: HTMLElement, host: ScrollHost): ScrollController
ScrollHost      = { fillRow(node, week, rowH), mondayOf(week), weekOf(day),
                    onDock(week), onRangeChange(firstWeek, lastWeek), onExpandEnd() }
ScrollController= { goToWeek(week, animate), setSnapStep(15|30|45),
                    setExpanded(ex: Expanded, animate: boolean), rowHeight(),
                    invalidate(weeks?), armAnim(kind: 'expand'|'collapse'),
                    armColsAnim(node: HTMLElement, kind: 'expand'|'collapse'), destroy() }
render.renderWeek(node: HTMLElement, week: WeekIndex, spans: EventSpan[], rowH: number): void
render.packLanes(spans: EventSpan[]): PackedSpan[]
render.columnsFor(offset: DayOffset, full: boolean): string
render.renderRange(node: HTMLElement, firstWeek: WeekIndex, lastWeek: WeekIndex): void
year.mount(root: HTMLElement, host: YearHost): YearController
YearHost        = { onPickDay(day), toast(message) }        — toast: "Planning layer"
plan.runOf(a, b, yearStart, yearEnd): { start, end }         — pure, plan.ts
plan.daysUsed(events, categoryName, yearStart, yearEnd): number
plan.firstBlocked(run, events, blockingNames): DayNumber | null
plan.sanitizePlanning(row): { budgetDays?, blocks? }
```

- **`scroll.ts` knows nothing about calendars.** It imports `types.ts` and
  `dates.ts` only; `main.ts` injects `fillRow`, which is what calls
  `render.renderWeek`. This is the seam stage 04 wraps to substitute an
  expanded row, without either module knowing about the other. `scroll.ts`
  never imports `state.ts`. Week↔day conversion is anchored maths and
  arrives through the host, which is what keeps the virtualizer
  calendar-agnostic.
- `renderWeek` FILLS a recycled node; it does not create one. (Supersedes the
  stage-01 stub's `renderWeek(week, spans): HTMLElement`.)
- **The position math is pure and takes `expanded` as a parameter**, so the
  variable-height row is testable under node before it is built:

```
rowHeightFor(viewportH, headerH)   heightOf(w, rowH, expanded)
posOf(w, rowH, expanded)           weekAtY(y, rowH, expanded)
snapTargetY(anchorWeek, rowH, expanded, viewportH)
fitY(y, ex, rowH, viewportH)
nearestAnchor(day, modulus, dir)   projectY(y, velocity)
settleMs(distancePx, rowH)         easeOutCubic(t)
Expanded = { week: WeekIndex; delta: number } | null
```

- **Anchors are a sequence, and 15/30/45 is a modulus over it.**
  `n = (year*12 + month-1) * 2 + (day === 16 ? 1 : 0)`; an anchor is enabled
  when `n % modulus === 0` for modulus 1/2/3. At 30 that is the 1st of each
  month; at 45, every 1.5 months.
- **The snap target is the TOP EDGE of the row containing the anchor date,
  placed at `viewportH * SNAP_ALIGN`.** The month boundary is drawn as a rule
  at the top of that row from the 1st rightward, so "boundary y equals
  content centre" and "a stop on the 16th frames a whole month" are the same
  statement.
- Row height excludes the sticky header:
  `clamp((viewportH - headerH) / VISIBLE_WEEKS, MIN_ROW_H, MAX_ROW_H)`.
- Rows recycle by `pool[((w % 14) + 14) % 14]`, so a node keeps its week
  identity across small scrolls and `fillRow` runs only when a node's
  assigned week actually changes.
- `scroll.ts` and `render.ts` keep browser globals inside functions only, so
  the node selftest can import their pure cores (CONVENTIONS).

- Tuned constants live at the top of `scroll.ts`: `VISIBLE_WEEKS 6.5`,
  `MIN/MAX_ROW_H 74/190`, `SNAP_ALIGN 0.5`, `PROJECT_MS 300`,
  `SETTLE_BASE/PER_WEEK/MAX_MS 280/42/760`, `WHEEL_GAIN 0.6`,
  `WHEEL_IDLE_MS 140`, `HAPTIC_ON_SNAP false`. Easing `easeOutCubic`,
  velocity smoothed 0.7/0.3, drag 1:1 with row height.
- **`setExpanded` jumps the maths and lets CSS carry the pixels.** It sets
  `expanded`, moves `y` through `fitY` so the grown row is fully on screen, and
  writes each row's FINAL transform and height once. `posOf`/`weekAtY` are
  therefore never mid-flight-wrong: a click during the animation resolves
  against the layout the pixels are heading for, bounded by `--t-open`.
  Expansion and the scroll-to-fit ride are one transition, not two.
- **`rowHeight()` exists so no consumer measures the row.** The expanded delta
  is `max(0, panel height − rowHeight())`; reading it off a DOM node would read
  a mid-animation height.
- **KNOWN LIMITATION: `grid-template-columns` does not visibly interpolate
  on every path at every viewport.** `transform` and `height` animate
  correctly everywhere, and the column END STATE is always correct. What is
  inconsistent is the easing, and it is path-dependent, not simply
  size-dependent (Chrome, measured): the FIRST expand interpolates at
  390×844 and snaps at 1440×900 and 1920×1200, while the in-row day SWITCH
  does the exact reverse — snapping at 390×844 and interpolating at both
  desktop widths. Whatever the cause is, it discriminates between two paths
  that write the same property through the same gate, and it is not
  established. This is the one confirmed, unresolved gap in the stage's
  animation work — but not the only thing stage 04 leaves unproven: its
  row-height-interpolation and positive `data-jump` claims rest on hand and
  isolated-repro evidence rather than on the suite. See
  `04_day/output/verification.md` for the raw widths.
  Every constraint below is independently confirmed by an isolated repro,
  including one that reconstructs this app's actual architecture (pool
  nodes pre-existing before the mutation, the split gate below, `--expand-
  cols`, children replaced mid-task, transform/height/columns all changing
  together) and DOES ease the columns correctly. The real app, with the
  same design verified wired exactly right (the gate attribute present and
  held for the transition's full duration, `transition-property`/
  `transition-duration` computed correctly throughout), still snaps the
  column value to its target within the first couple of milliseconds. The
  cause is not established. Do not re-litigate the constraints below on the
  theory that one of them is the missing piece — each has already been
  tested in isolation and confirmed necessary but, together, not sufficient
  for the full app. The next thing worth trying, if anyone picks this back
  up: stub `day.ts`'s panel-DOM work (moving the panel between cells,
  rebuilding its list, the staggered `.enter` transitions) to a no-op and
  see whether the column transition starts interpolating — it is the one
  significant thing the working isolated repro does not reproduce.
- **The transition gate is split in two, both carried per row, never on the
  scroller.** `data-anim` (`expand`/`collapse`) gates `transform`, `height`,
  `column-gap` and is stamped on every pooled row — geometry shifts under
  any row when one grows, so all 14 need it. `data-cols-anim` (`expand`/
  `collapse`) gates `grid-template-columns` alone and is stamped only on
  the row(s) whose columns actually change this task — the expanding row,
  and on a cross-week switch, the departing row whose columns are being
  cleared — because that is the only row with a value to transition for
  that property. Both gates use the SAME tokens per kind
  (`var(--t-open)`/`var(--ease-spring)` for expand,
  `var(--t-base)`/`var(--ease-out)`/`var(--t-fast)` delay for collapse), so
  the columns and the geometry never desync. On the row carrying BOTH
  attributes (the one actually animating), a compound rule,
  `.week[data-anim][data-cols-anim]`, lists all four properties: the two
  single-attribute rules have equal specificity and `transition-property`
  is not additive between them, so without the compound rule the one later
  in source order would silently win outright and drop the other's
  properties from that row's eligibility. Both gates are written once per
  action — `setAnim` sweeps the whole pool once when a geometry action
  starts or ends, `armColsAnim` writes one node once — never inside
  `place()`'s per-frame path or a kinetic `frame()` tick (a kinetic
  settle's own gate-clear happens once, when `animateTo` starts it, not on
  every tick it runs). Both clear together on every path that already
  clears the gate (pointerdown, wheel, `goToWeek`, a settled `animTimer`,
  the start of a kinetic action) — `setAnim`'s one pool loop clears
  `data-jump` and both gate attributes. A node recycled INTO view
  mid-animation, from a DIFFERENT week than it last held, is stamped
  `data-jump`; a refill that keeps the SAME week (a full `invalidate()`
  resets every slot's bookkeeping, not just the ones that moved) does not.
  The recycling guard pairs `data-jump` with EACH gate on the same element
  — `.week[data-anim][data-jump]` and `.week[data-cols-anim][data-jump]`
  (motion.css) — never an ancestor-and-row pairing.
- **`armAnim(kind)`/`armColsAnim(node, kind)` raise their gate on its own —
  no timer, no geometry, no `place()` — so it opens BEFORE the property it
  gates changes, not merely in the same task as it.** This engine decides
  transition eligibility at the moment a property's value changes, not
  retroactively once `transition-property` later includes it — a value
  already at its target before the gate exists is not eligible one
  statement later, confirmed by repro. `main.ts`'s `remeasure()` arms
  `data-anim` first (all rows), then `invalidate()`s the row(s) — which is
  where `applyColumns`/`clearColumns` arm `data-cols-anim` on the ONE row
  about to change, immediately before writing `--expand-cols` — then calls
  `setExpanded`, which measures `contentHeight()` and writes the final
  transform and height. One task, gate-then-geometry, for both gates.
  `closeDay()` arms both the same way, in the same order, before
  `clearColumns` — including ahead of `armAnim('collapse')` itself, because
  `setAnim`'s own first statement can synchronously cancel a still-pending
  expand timer and fire a full, ungated refill of every row right there, so
  `data-cols-anim`'s value must already be set before that can happen, not
  merely before the next line of `closeDay` runs. `setExpanded` still calls
  `setAnim` itself on every call, so re-arming `data-anim` in the same task
  is simply idempotent.
- **The expanded column template is written to a CSS custom property,
  `--expand-cols`, never to `grid-template-columns` directly.** This engine
  does not transition `grid-template-columns` when JS sets it via inline
  style at all, regardless of gating — repro: a plain grid with nothing
  else in flight, changed by `el.style.gridTemplateColumns = …` with a
  correct matching duration and matching track-sizing function, still
  snaps; the identical value change made through a custom property a
  static CSS rule reads with `var()` eases normally. `.week`'s rule is
  `grid-template-columns: var(--expand-cols, repeat(7, minmax(0, 1fr)))`.
  This, the per-row split above, and the arm-before-write ordering are
  independently-necessary, load-bearing browser constraints on THIS
  engine, not incidental style choices — reintroducing a direct
  `grid-template-columns` write, writing the column template before arming
  its gate, or gating it from an ancestor's attribute again, each
  reintroduces a snap with no error to catch it. None of the three,
  individually or together, has been shown sufficient to fix the app-level
  gap named at the top of this list.
- **`onExpandEnd()` fires when the animation is over.** `scroll.ts` reads the
  duration from the row's own computed `transition-duration` plus
  `transition-delay`, so `motion.css` keeps the single home for the value and
  reduced motion's 80ms is honoured without a second code path.

## PWA

- `manifest.webmanifest`: name, icons (B mark, graphite theme), display
  `standalone`, `start_url: "/"`, `scope: "/"`. Both
  `mobile-web-app-capable` and the Apple meta.
- Service worker (`sw.ts`, emitted at the site root as a classic script,
  registered in production only):

  | Path | Strategy |
  |---|---|
  | `/assets/*` (hashed) | cache-first |
  | everything else | network-first, cache as offline fallback |

  Offline navigation falls back to `/` (not `/index.html`, which the host
  307s). Never cache a response with `response.redirected`. Never cache
  Calendar API responses in the SW. Precache only paths the build really
  emits. `public/_headers` must keep `/sw.js` uncacheable.
- Offline: opens read-only from cache (from the second launch onward —
  hashed assets are runtime-cached on first online load); writes fail
  visibly and roll back; background refresh on reconnect.

## Stack

- Vite + vanilla TypeScript, strict. No framework, no runtime dependency
  except the Supabase client (`HABITS.md`).
- localStorage for the event cache (`bramwell.cache.v1`, versioned,
  discarded on mismatch, quota failures swallowed) and prefs
  (`bramwell.prefs.v1`).

## File layout

```
/index.html               — seed tokens, GIS <script>, viewport meta
/public/manifest.webmanifest — served at /manifest.webmanifest; Vite copies public/ to dist/ root
/public/                  — icons, _headers
/src/main.ts              — bootstrapping and wiring; owns the theme <style>
/src/auth.ts              — GIS token client; the ONLY file that knows about Google auth
/src/gcal.ts              — Calendar API; the ONLY file calling googleapis.com
/src/habits.ts            — Supabase client; the ONLY file calling Supabase (HABITS.md)
/src/journal.ts           — journal link/index resolution, no network of its own (JOURNAL.md)
/src/dates.ts             — anchorless civil-date core: brands, civilToDay/dayToCivil, monthKey; imports no runtime code
/src/selftest.ts          — pure async selfTest() over dates.ts, state.ts and gcal.ts under a stubbed fetch; loaded only by main.ts under ?selftest
/src/state.ts             — event cache, today() anchor, DayNumber<->WeekIndex math, persistence, write orchestration, demo
/src/scroll.ts            — virtualizer, snap physics, the one variable-height row
/src/render.ts            — week rows, bars, chips, lane packing, month badges, header
/src/year.ts              — year view, plan strip, paint/erase modes
/src/plan.ts              — planning core: run selection, budget usage, conflict check; DOM-free, imports types.ts and dates.ts only (2026-09-05)
/src/day.ts               — inline day expansion content: event list, form, habits, journal
/src/categories.ts        — category resolution, Google colour table, moods, themeCss()
/src/chrome.ts            — first-run, settings sheet, FAB, toasts
/src/sw.ts                — service worker
/src/types.ts
/scripts/                 — node-only tooling, never bundled: selftest runner, headless evidence harness, service-worker build step
/src/style.css            — token consumption only
/src/motion.css           — motion tokens, elevation scale, enter/exit utility, reduced-motion
/.env.local               — VITE_GOOGLE_CLIENT_ID, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (gitignored)
```

Module boundaries are hard. Leaf modules (`categories`, `gcal`, `habits`)
stay DOM-free and never import `state.ts`; `main.ts` pushes data in.
Anything may import `dates.ts`; it has no anchor and no state.
A file the layout lacks is added **here first**, then created.

## Auth (`src/auth.ts`)

Google Identity Services token model (`initTokenClient`). Script tag in
`index.html`; `auth.ts` polls for `window.google`.

- Scope: `https://www.googleapis.com/auth/calendar.events` only.
- Token in memory only. `getToken(forceRefresh = false)`: cached if valid,
  else `requestAccessToken({prompt: ''})` for quiet renewal. A failed quiet
  renewal leaves `isSignedIn()` false and surfaces the reconnect pill; the
  user's click is the gesture (browsers block the popup otherwise). Any
  401 → `getToken(true)` once; if the retry also 401s, `invalidateToken()`
  then rethrow. Never a dead state.
- `signOut()` revokes via `google.accounts.oauth2.revoke` (a local-only
  clear would quiet-renew straight back in).
- `invalidateToken()` is a **local-only** clear of the cached token and its
  expiry — no revoke, no client reset. It is for a token the API *rejected*,
  not one the user is finished with: revoking would be wrong, because the
  grant itself may still be good. Unlike `signOut()`, a later quiet renewal
  MAY sign straight back in — if it succeeds the grant was still good; if it
  fails, `isSignedIn()` stays false and the reconnect pill stands. The
  failure path inside a renewal already clears the token on its own, so
  `invalidateToken()` exists solely for the API-rejected case.
- Exports exactly `getToken`, `signIn`, `signOut`, `isSignedIn`,
  `invalidateToken`.

## Calendar API (`src/gcal.ts`)

Base `https://www.googleapis.com/calendar/v3`, bearer token, calendar
`primary`.

- **List month:** `GET /calendars/primary/events`, `timeMin`/`timeMax`
  RFC3339 with local offset, `singleEvents=true`, `orderBy=startTime`,
  `maxResults=250`, follow `nextPageToken` to exhaustion. Cancelled
  events dropped. Events carrying `extendedProperties.private.bramwell =
  "daynote"` (v3 legacy notes) are read as ordinary all-day events —
  no special handling in the rebuild.
- **Create:** `POST`. Timed: `start/end.dateTime` + timezone; a timed
  event carries start and end DayNumbers (may cross midnight; renders on
  its start day). All-day: `start/end.date`, API end **exclusive**,
  internal end **inclusive**; convert at this boundary only. `colorId`
  from the category, `description` from notes, `recurrence` from repeat
  (`RepeatRule` = `none | daily | weekly | monthly | yearly`, mapped to
  one RRULE).
- **Update:** `PATCH`, changed fields only, on whichever id the caller
  sends — the instance id is this occurrence, `recurringEventId` is the
  whole series.
- **Delete:** same id choice. `WriteScope` (`instance | series`) is
  `state.ts`'s vocabulary, where the picker and the series-delete
  confirmation live; see the bullet below.
- **`gcal.ts` returns `StoredEvent`, never `CalendarEvent`.** `category` is
  resolved against current prefs, which is `state.ts`'s job on every read;
  resolving it here would make `gcal.ts` import `categories.ts` and depend
  on `configure()` having already run. Returning the persisted shape makes
  "category is never serialized" structural rather than remembered.
- **Instance-vs-series is an id choice, made by the caller.** `WriteScope`
  does not reach the wire: only `state.ts` holds the `CalendarEvent` that
  carries both `id` and `recurringEventId`, so it picks which id to send.
  `gcal.updateEvent(id, changes, colorId, token)` and
  `gcal.deleteEvent(id, token)` take no scope. `colorId` stays an explicit
  argument: `EventDraft.category` is a category *name*, and `gcal.ts` may
  not import `categories.ts` to resolve it.
- 403 rate-limit / 5xx / 429: one retry with backoff, then surface. A 403
  is retried **only** when the body's error reason is `rateLimitExceeded`
  or `userRateLimitExceeded`; a permissions 403 surfaces immediately.
- Errors are thrown as `GcalError { status, body }`. `gcal.ts` owns the
  transport retry; `state.ts` owns the 401 re-auth retry. Neither retries
  the other's case.
- `fetch` is called bare inside each function, never captured at module
  scope, so a test can swap `globalThis.fetch`.
- `MAX_RESULTS` is a module constant; lower it to force pagination during
  a gate, restore to 250. `listMonth` caps the `nextPageToken` loop at 20
  pages so a stub returning a fixed token fails rather than hangs.

## Write orchestration (`src/state.ts`)

UI → `state.ts` → `gcal.ts`; the day module never imports `gcal.ts`.
`createEvent` / `updateEvent` / `deleteEvent`: apply locally as pending →
API call → reconcile from the server's answer (refetch the touched months;
a series write marks every resident month stale) → or roll back, toast,
rethrow. The offline check sits inside the try block after the optimistic
apply so the rollback path really runs. `onCacheChange(fn)` notifies
listeners with changed month keys. Optimistic creates are built field by
field, not by spreading the draft.

### State API

```
ensureMonthsFor(weeks: WeekIndex[]): void   — lazy month loading
monthState(key: MonthKey): MonthLoadState   — render reads load state
eventsForMonth(key: MonthKey): CalendarEvent[]
spansForWeek(week: WeekIndex): EventSpan[]
prefs(): Prefs / savePrefs(p: Prefs): void
createEvent(draft) / updateEvent(id, draft, scope) / deleteEvent(id, scope)
onCacheChange(fn: (months: MonthKey[]) => void): () => void
today() / weekOf() / dayAt() / enableDemo()
clearAuthGate(): void                       — see the auth gate, below
```

`loadCache`/`saveCache` are private: nothing outside `state.ts` touches the
event cache. `saveCache` is debounced (~250ms trailing) so an optimistic
write does not re-serialize the whole blob synchronously; `savePrefs`
writes immediately.

- `ensureMonthsFor` fetches a month key that is `absent`, `error`, or
  `ready` with `fetchedAt` older than **5 minutes**; it skips `loading`,
  and coalesces concurrent callers through an in-flight map. A failed
  fetch sets `error` but **keeps the prior events**, so a refresh failure
  never blanks a month already on screen. Stage 03 owns *when* to call it.
  **Amended 2026-09-05:** *when* is the range change AND the app returning
  to the foreground — `visibilitychange` to visible, window `focus`, and
  `online` each re-run `ensureMonthsFor` over the visible weeks. The
  five-minute rule still decides whether a fetch happens; there is no timer.
  Without this a parked tab never sees a write made on another device.
- `spansForWeek` gathers the one or two month keys the week touches and
  **dedupes by event id**: an event crossing a month boundary is stored in
  both months, and a week straddling that boundary would otherwise draw
  the bar twice.
- `eventsForMonth` re-resolves `category` through `categories.categoryFor`
  on every read, then merges the pending overlay.
- The 401 rule lives in one place, a `withToken(fn)` wrapper: `getToken()`
  → call → on a 401 `GcalError`, `getToken(true)` and call once more →
  else clear and surface.
- **The auth gate.** When `withToken`'s opening `getToken()` rejects, a
  module-private latch is set and `fetchMonth` returns immediately for every
  subsequent *background* month load — no token request is issued at all —
  until `clearAuthGate()` is called. Writes are deliberately not gated:
  they reach `withToken` directly, a Save press is itself the user gesture a
  popup needs, and they surface their own failure. `main.ts` clears the gate
  on a successful `signIn()` or renewal; `error` months are refetch-eligible
  again the moment it is down, so nothing else has to be re-armed. Rationale
  in "First-run and connection state".

## Dates

`DayNumber` (absolute civil-date integer, `Date.UTC` on y/m/d, DST-immune)
is what events and prefs store. `WeekIndex`/`DayOffset` (0 = Mon … 6 =
Sun) are layout coordinates relative to today, never persisted, converted
in `state.ts` only. All three are branded numbers; the constructors live
in `dates.ts` with the anchorless civil math, so leaves can brand a wire
date without touching `state.ts`. `gcal.ts` and `habits.ts` own wire ↔
DayNumber; `Date` objects appear only at API and display boundaries.

`CalendarEvent` is a discriminated union on `allDay`; timed events carry
`startMin`/`endMin` (minutes from local midnight). `category` is derived
from `colorId` at read time and never serialized. `EventSpan` (one per
week row an event touches) is built in `state.ts`; `render.ts` adds the
lane. `StoredEvent` is the persisted form of `CalendarEvent` with `category` stripped.

## Definition of done

Calendar (carried forward, all still binding):

- Sign in → a full month visible at once, today marked, month(s) named in
  the header, month structure legible from tile values alone.
- Flick three months: 60fps, settles softly onto a centred anchor at the
  chosen 15/30/45; header updates.
- Double-tapping a day on a phone never zooms the page.
- Year view: all 365 days on a desktop window, week-aligned except where a
  month spine or a stretched event day shifts a track, month spines naming
  each month, today; hover (tap on phone) shows three days with events in
  full; clicking a day returns to it.
- Scroll a year into the past: months load as approached, no jank, `.week`
  node count stays at 14.
- A 3-week all-day commitment renders as a wrapping bar across three rows
  and arrives in the Google Calendar app with the right colour and the
  right end date.
- Edit one occurrence of a weekly event; delete the series with
  confirmation.
- Install as PWA; kill the network; opens read-only from cache; a write
  fails visibly and rolls back; a deploy reaches an installed client on
  the next online open without a manual cache bump.
- A full month fits a notched phone and a 27" monitor; day numbers never
  clipped.
- Cold start signed out → first-run screen; Connect lands on today. Stale
  token over a warm cache → read-only calendar with a reconnect pill.
- FAB and `n` open the form on the centred date from anywhere in time.
- Settings (snap, default view, colours, mood) persist; sign-out returns
  to first-run.
- `?demo`: populated, zero googleapis.com requests, saves reject with the
  demo message, Connect exits into real sign-in, nothing persisted.
- Category rules: fresh install renders the four seed categories in the
  seed colours; two categories can never share a colorId; add is dead at
  11; delete leaves Google untouched and renders the fallback; rename
  keeps the key; display hex overrides on screen while Google shows the
  colorId's colour.
- Every mood keeps month structure readable on a phone at arm's length,
  light and dark.

Planning layer (2026-09-05):

- Give a category a budget of 30 in Settings; the year view's strip shows
  "0 / 30". Paint a Mon–Fri run: one all-day event arrives in the Google
  Calendar app with the right colour and dates; the strip reads "5 / 30".
  Paint a second run overlapping the first by two days: the strip counts
  each day once.
- Mark a category Blocks, paint three days with it, then try to paint a
  budgeted run across them: refused with a toast naming the first blocked
  day, nothing written to Google.
- Erase a painted run: gone from Google and from the strip's count. Erase on
  a recurring event's day: refused with the toast.
- Phone: paint mode drags paint and do not scroll; exiting paint mode
  restores scrolling; the strip scrolls horizontally.
- `npm run selftest` covers `plan.ts` (run clipping, distinct-day counting
  across overlapping and cross-month runs, blocked-day detection,
  planning-field sanitize) before any DOM was wired.

Redesign:

- No transition/animation value outside the token layer.
- No overlay drawer; every former drawer capability reachable inline.
- 60fps expand/collapse on the MacBook and a mid phone; reduced-motion
  path verified.
- Every "this control works" claim is backed by `elementFromPoint()` at
  the control's centre resolving to the control (see `CONVENTIONS.md`).

Habits and journal: see `HABITS.md` and `JOURNAL.md`.

---

## MANUAL SETUP (human-only)

Google Cloud Console — the v3 client carries over:

1. Project → enable **Google Calendar API**.
2. OAuth consent screen → External → scope `.../auth/calendar.events` →
   add yourself as test user → leave in **Testing** (up to 100 named
   users, no review; consent expires periodically — re-clicking sign-in
   fixes it, not a bug).
3. Credentials → OAuth client ID → Web application → authorized
   JavaScript origins `http://localhost:5173` (dev server),
   `http://localhost:4173` (`vite preview`, registered 2026-08-30) and the
   deployed origin. No redirect URIs. **Exact-match, and the port is part of
   the match**: `no.fail` and `www.no.fail` do not cover `bramwell.no.fail`, and
   5173 does not cover 4173 — which is why a production build served by
   `npm run preview` fails sign-in with `origin_mismatch` unless its own port
   is registered. Origin changes take a few minutes to propagate; retry in a
   fresh tab, since GIS caches the rejection.
4. `.env.local`: `VITE_GOOGLE_CLIENT_ID=`.

Supabase: see `HABITS.md`.

## DEPLOY (Cloudflare → https://bramwell.no.fail)

- The origin must be a **domain root**: `sw.ts` precaches `/`, the
  manifest declares `start_url`/`scope` `/`, icons link at `/`. HTTPS is
  required (GIS refuses insecure origins; SWs will not register).
- `bramwell.no.fail` is a dedicated subdomain in the `no.fail` zone; the apex
  is an unrelated Astro site. A subpath under the apex is not an option.
- Build `npm run build`, output `dist`, Node pinned by `.node-version`,
  env vars `VITE_GOOGLE_CLIENT_ID`, `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY` set in the dashboard (Vite inlines them;
  `.env.local` is gitignored). Client IDs and the anon key are public by
  design; the origin allowlist and RLS are the security boundaries.
- **A proxied Cloudflare zone overrides `_headers` for anything whose TTL is
  lower than the zone's Browser Cache TTL.** Observed on the first deploy
  (2026-08-30): `_headers` set `/sw.js` to `no-cache` and `bramwell-pwa.pages.dev`
  served exactly that, while the proxied `bramwell.no.fail` served
  `max-age=14400` — the zone default of 4 hours. `/assets/*` came through
  untouched because its `max-age=31536000` is *higher* than the zone's, which is
  what makes this asymmetric and easy to miss: the rule that matters most is the
  only one silently rewritten. The `_headers` file itself is fine and the other
  rules apply. Fix at the zone, not in the repo: a Cache Rule scoped to
  `bramwell.no.fail/sw.js` with Browser TTL "Respect origin", in preference to
  flipping the whole zone to "Respect Existing Headers" — the apex is an
  unrelated site. **Verify the deployed header, never the file**: `_headers`
  being correct proves nothing about what the browser receives.
- **Resolved 2026-08-31, and the resolution lives OUTSIDE this repo.** A
  zone-level Cache Rule on `no.fail` — hostname `bramwell.no.fail` AND URI
  path `/sw.js`, Browser TTL "Respect origin TTL" — plus a custom purge of
  that URL. On the wire: `cache-control: no-cache`,
  `cf-cache-status: REVALIDATED`.
  **This is dashboard state, not a file.** Nothing in the repository asserts
  it, no build step recreates it, and no test covers it: a zone change, a
  rule reordering, a project or domain migration, or a new Cache Rule with a
  broader match can silently revert it, and the only visible symptom is a
  deploy that quietly takes hours to reach installed clients. The detector is
  one command, and it belongs in the deploy checklist rather than anyone's
  memory:

  ```
  curl -sI https://bramwell.no.fail/sw.js | grep -i cache-control
  #  expect: cache-control: no-cache
  #  a max-age here means the Cache Rule is gone or is being out-matched
  ```
- Preview deployments cannot sign in (Google rejects wildcard origins).
  Anything touching auth or the API is tested on `bramwell.no.fail`.
- Deploying is a prerequisite for PWA/offline gate items, not a step after
  them: a phone reaching `http://<lan-ip>:4173` is not a secure context.
