# Iteration: Year view redesign — RESOLVED against the repo (2026-08-30)

Reviewed against the actual tree by Cowork with the folder connected. This
replaces the earlier draft, which was written before the repo was readable.
Run this as an **iteration session, not a stage session**: the entry rule
would route a stage session to 05_shell (BUILT, GATE NOT RUN), and this work
amends closed stage-03 territory instead. Upstream edits (Part 1) land
before any code (CLAUDE.md: fixes go upstream, never patched downstream).

## What the review found

Already built, spec'd, and gate-approved — the draft assumed these were new:
- 28-column week-aligned grid, Jan-1 indent, every column one weekday
  (`columnsFor`, SPEC "Year view"). 14 cols tablet/phone, 7 below 360px.
- Month bands (`data-band` a/b on month parity) and weekend shade, via the
  four band tokens. Today = inset ring + accent number (`--today`).
- Per-row lane-packed category bars, max 3, longest-first, timed events as
  single-cell bars (`.yrbars` overlay grid, `assignLanes`).
- A hover panel (`.yrpanel`) with a SPEC contract: previous/hovered/next
  day, every event in full, survives repaints, touch two-tap. DECISIONS
  already schedules "restyled in the same tokens in a later pass" — this
  iteration IS that pass. Restyle it; do not rebuild it.

Collisions in the draft — resolved as follows:
1. **Hairline borders contradict Night Depth.** SPEC "Visual direction":
   cells are "rounded raised tiles … **not hairline-ruled grid cells**", and
   hairlines are the rejected v3 direction. Retrying a rejected approach
   needs a new dated reason in DECISIONS (CLAUDE.md rule). Ruling proposed
   below: **no borders**. The flatness Doug is reacting to is band contrast,
   not missing rules — fix it with the spine, event-day ink, stretch, and
   (if still needed) a year-view ladder amendment. If Doug overrules and
   wants hairlines anyway, that is a one-paragraph DECISIONS entry first.
2. **The prototype's teal spine edge violates the reserved-hue rule.**
   `--today` "is used for nothing else" (SPEC, twice). The spine uses
   neutral ink tokens, not teal.
3. **Animated stretch would land on the `grid-template-columns`
   interpolation KNOWN LIMITATION** (SPEC "Scroll engine API",
   04_day/output/verification.md §3 — five fix rounds, cause not
   established, do not re-litigate). Resolution: **stretch is static** —
   the template is computed once per `build()`, nothing transitions. Hover
   feedback is the existing Night Depth lift (translateY + ring), which is
   compositor-only and already tokenized. No new entry in the limitation's
   case list, no `data-cols-anim` machinery needed.
4. Draft's `--yv-*` hex palette: discarded. Colours come from the mood
   ladder in `categories.ts` and the non-mood tokens in `style.css`; no new
   hex anywhere.
5. Draft's serif month labels (Newsreader): dropped. The app is
   system-stack; a webfont is a Visual-direction amendment plus an SW
   precache concern for a deployed PWA. The spine name uses the existing
   stack, weight 620, letter-spaced caps.

## Part 1 — upstream edits (do these first, verbatim intent, your wording)

`_references/SPEC.md` "Year view":
- AMEND the "every column is the same weekday all year" bullet: strict
  column alignment is traded away. Both new features break it — stretched
  event days widen their track, and month spines insert a track. The
  per-cell weekday letter (`.yrwd`, already rendered) carries the weekday
  instead. Weekend shade stays per-cell (`data-weekend`), so weekend
  banding survives approximately.
- ADD: **Month spine.** Between the last cell of a month and the 1st of the
  next (and before the year's first in-year cell), a narrow non-day track
  carrying the full month name in caps, reading bottom-up
  (`writing-mode: vertical-rl` rotated). Desktop 24px / full name;
  14-col layouts 18px / 3-letter name. The spine replaces the `.badge`
  month label on the 1st — remove the badge in the year grid (CONVENTIONS:
  a state that adds a rendering stands the old one down).
- ADD: **Event-day stretch (static).** A cell with ≥1 bar or event gets a
  wider track (2.2fr vs 1fr; not on 7-col layouts). Stretched cells at
  ≥28-col widths show up to 2 event titles inline (single line, ellipsis,
  category dot), in the space between the day number and the bars. No
  animation of track sizes anywhere in the year view.
- ADD: day numbers on event days render `--ink` weight 620; ordinary days
  stay `--ink-dim` (today keeps `--today`).
- AMEND hover: cells with events get the Night Depth hover lift
  (translateY(-2px) + `--ring` fade, compositor-only, declarations in
  `motion.css`). Panel contract unchanged.

`_references/DECISIONS.md` — new dated rulings:
- Hairline borders on year cells: considered 2026-08-30 for contrast,
  rejected again — Night Depth's tile statement stands; contrast comes from
  spine + stretch + ink weight. (Or the reverse ruling if Doug overrules.)
- Year-view stretch is static because animating `grid-template-columns` is
  the recorded known limitation; hover growth was rejected for the same
  reason.
- Spine colour is neutral (`--ink-dim` name, `--rule`-class edge);
  `--today` stays reserved.
- The year view's column-alignment property is traded for stretch + spine
  (supersedes the stage-03 phrasing; 14-col phone ruling unchanged).

`_references/OPEN.md`: add an item if the phone (14-col) stretch factor
reads badly on device — tune at the next device gate, don't guess.

## Part 2 — implementation (maps to real files)

`src/year.ts` — all inside `build()`:
- While pushing day cells, insert a spine element into `cells` before each
  day-1 cell (and before Jan 1, after the indent pads). Give it
  `class="yrspine" data-month-name`. Because it sits IN the cells array,
  the per-row `items` loop's indices (`i`, used for `grid-column`) stay
  consistent with the track list for free — do not special-case the bars
  math.
- Per row, build the template string explicitly instead of
  `repeat(var(--cols), 1fr)`: spine tracks fixed (`24px`/`18px`), event-day
  cells `2.2fr`, others `1fr`. Set it as an inline custom property on the
  row (`--yr-cols: <template>`); a static rule applies it. "Has events" for
  a cell = any bar item touches it, or `eventsForMonth` has an event on it
  — compute during the existing per-row event walk, not a second scan
  (DECISIONS: markers collected during lane packing, not per-cell lookup).
- Row capacity: a row is still `cols` DAY cells; spines are extra tracks.
- Multi-day bars that cross a spine: let the bar span the spine track
  (indices already do); paint the spine above the bars layer
  (z-index) so the divider visibly interrupts the run.
- Drop the `.badge` append for the year grid.
- Inline titles: in the stretch branch, append a `.yrtitles` block (max 2)
  to event-day cells. Suppression checklist (CONVENTIONS, the twice-shipped
  bug): the cell's own layout must still fit `.yrwd`/`.yrnum`; titles are
  `overflow:hidden` inside the cell; bars stay (they are the row overlay —
  do NOT try to hide per-cell segments of a multi-day run).

`src/style.css`:
- `.yrrow { grid-template-columns: var(--yr-cols); }` and
  `.yrbars { grid-template-columns: inherit; column-gap: inherit; }` —
  the stage-04 `.bars` lesson applied here so the overlay can never
  disagree with the row.
- `.yrspine`: background `--band-b-end`-class surface, name in `--ink-dim`,
  620 weight, ~9px, `.14em` tracking, vertical writing mode; a 2px inset
  edge using the ring/rule neutral — **not** `--today`.
- `.yrcell[data-has-ev] .yrnum { color: var(--ink); font-weight: 620; }`
- `.yrtitles` styles; grep the whole src tree for bare class tokens before
  naming (`yr*` family exists; `spine`/`yrtitles` must be greppable and
  collision-free — CONVENTIONS recurring-edit rule 1).
- `.yrpanel` restyle to Night Depth elevation tokens (this is the deferred
  "later pass"); contract untouched.
- Both colour schemes: only tokens, no literals, so light mode is correct
  by construction.
- If any hover transition is added it is declared in `motion.css`, never
  here (the stage-04 grep-provable rule: the declaration itself, not just
  the values).

`src/motion.css`:
- One block for `.yrcell[data-has-ev]:hover` lift using `--t-fast`/
  `--t-base` + `--ease-out`, mirroring `.day`'s hover pattern (opacity +
  transform only). Reduced-motion already collapses globally.

## Verification (per CONVENTIONS — the draft's checklist replaced)

- `npm run shot`-style probe in both schemes via CDP
  `Emulation.setEmulatedMedia` (never `--blink-settings`).
- Hit-test with `document.elementFromPoint` at cell centres: a stretched
  cell, a spine-adjacent cell, today. `elementsFromPoint` to prove the
  spine paints above a crossing bar and that no removed `.badge` still
  paints (paint order, not rect intersection).
- Assert NO transition is ever attached to `grid-template-columns` in the
  year view (grep `motion.css` + computed style probe).
- Panel still survives a repaint mid-hover (existing behaviour, easy to
  regress while restyling): trigger `invalidate()` with the panel open.
- Phone widths 390/360: 14-col spine legible, stretch factor acceptable —
  device gate, screenshot for the human.
- Cite field values, not exit codes (`npm run shot` is a printer, not a
  detector — OPEN.md).

## Acceptance

1. Month boundaries read at a squint from spine + bands; every spine names
   its month in full on desktop.
2. Event days are visibly wider and brighter; busy stretches of the year
   read as texture from across the room.
3. No border rules on year cells; no use of `--today` outside today's two
   marks; no colour literals outside the token layer.
4. Nothing in the year view transitions `grid-template-columns`.
5. Light mode holds without any year-view-specific colour fixes.
6. `.yrpanel` contract (prev/hovered/next, repaint survival, touch two-tap)
   unchanged and re-verified.
