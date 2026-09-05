# Iteration A: Planning layer (2026-09-05)

**Session type: iteration, not stage.** The entry rule would route a stage
session to 05_shell; this amends closed stage-03 territory (the year view) and
stage-02 territory (categories). The upstream edits already landed — read
them, do not re-derive them:

- `_references/SPEC.md` "Planning layer (2026-09-05)", "Categories and
  customization" (StoredCategory shape), "Scroll engine API" (YearHost,
  plan.ts signatures), "File layout" (`src/plan.ts`), "Definition of done"
  (Planning layer rows), "Year view" (14-column stretch 1.35fr).
- `_references/DECISIONS.md` "Planning layer rulings (2026-09-05)".
- `_references/OPEN.md` "Opened at the planning layer (2026-09-05)".

Run on a worktree: `git worktree add ../bramwell-A -b planning-layer`. Two
other sessions run beside you (B: demo, C: polish). Your files: `src/plan.ts`
(new), `src/year.ts`, `src/categories.ts` (sanitize + types), `src/types.ts`,
`src/selftest.ts`, `src/chrome.ts` **only inside `buildColors()`** (the
Budget input and Blocks toggle on the category row), `src/style.css` **only
for new `.plan*` / `[data-paint]` rules appended at the end**, `src/main.ts`
only to pass `toast` into `year.mount`. Touch nothing else; if you must, stop
and say so. Merge order at the end is A, then B, then C.

## Process
CLAUDE.md "How a stage session runs" applies (brainstorm against the
contract → plan → TDD the pure core → execute → verify). Write the plan to
`_iteration/output/planning-layer.plan.md` and verification to
`_iteration/output/planning-layer.verification.md`. Note: `_iteration/output/`
is a new directory — create it.

## Build order (each step verifiable alone)

1. **Types + sanitize.** `StoredCategory.budgetDays?: number`,
   `blocks?: true`. `sanitize()` keeps the row and drops an invalid field.
   Selftest: budget 0, 367, 2.5, "30" (string) all dropped; 1 and 366 kept;
   `blocks: 1` and `blocks: "true"` dropped; `blocks: true` kept.
   **Seed (amended 2026-09-05, DECISIONS "Planning layer rulings"):** append
   `vacation` (label Vacation, colorId `'7'`, no budget) and `blackout`
   (label Blackout, colorId `'11'`, `blocks: true`) to `SEED`, after
   `financial` and before `OTHER`. Pick `displayHex` per Night Depth and add
   both dark twins to `TWINS`. The frozen-seed comment stays true: existing
   rows and their colorIds do not change. Seed holds 9, 10, 5, 8; 7 and 11
   are free. Selftest: the seed sanitizes to itself with `blocks` intact.
2. **`src/plan.ts`**, DOM-free, imports `types.ts`/`dates.ts` only.
   - `runOf(a, b, yearStart, yearEnd)` — ordered, inclusive, clipped.
   - `daysUsed(events, categoryName, yearStart, yearEnd)` — distinct days,
     all-day only, clipped to the year. Selftest: two overlapping runs count
     shared days once; a run crossing Dec 31 counts only in-year days; a
     timed event counts zero; an event of another category counts zero.
     Remember `eventsForMonth` stores a cross-month event in BOTH months —
     the caller must dedupe by id before calling, or `daysUsed` must (pick
     one, document it, test it).
   - `firstBlocked(run, events, blockingNames)` — lowest day in the run
     covered by an all-day event whose category is in the set, else null.
   - `sanitizePlanning(row)` — the piece `categories.sanitize()` calls.
3. **Strip.** In `year.ts`, a `.planstrip` element inside `root`, before
   `gridHost`. One `.planchip` per category (dot, label, figures) plus the
   Erase chip. Figures from `daysUsed` over the displayed year; rebuilt on
   every `build()` — cheap, 365 days × 11 categories. Phone: `overflow-x:
   auto`, `-webkit-overflow-scrolling: touch`, no scrollbar chrome.
   Over-budget figure: `--ink-strong`, weight 620, nothing else.
4. **Paint mode.** Chip click → `mode = { kind: 'paint', cat }` /
   `{ kind: 'erase' }` / null. `data-mode` on `root` for CSS. While set:
   hover panel suppressed (`onOver` returns early; `hidePanel()` on entry),
   `touch-action: none` on `.yr`, `cursor: crosshair`. Pointer down on a
   `.yrcell[data-day]` → `setPointerCapture` on `gridHost`, record start.
   Pointer move → `document.elementFromPoint(e.clientX, e.clientY)` →
   closest `.yrcell[data-day]` → `runOf(start, that)` → set `data-paint`
   on cells in the run, clear it on the rest (walk `cellFor` over the run;
   keep a `Set` of painted cells to clear). Pointer up / cancel →
   `firstBlocked` check → `createEvent(...)` or `host.toast(...)`. Escape
   exits mode and, mid-drag, abandons the run. `showYear(false)` in
   `main.ts` already calls into the year controller? It does not — add
   `YearController.exitMode()` and call it from `showYear(false)`; that is
   the one `main.ts` line beyond `toast`. Record the API addition in SPEC
   "Scroll engine API" when you write verification (it records what was
   built; that is within an iteration's own bounds per CLAUDE.md).
5. **Erase.** Click (pointer down/up with < 6px movement — `main.ts`'s
   `TAP_SLOP` value; do not import `main.ts`) → the lane-0 bar in
   that cell. You have `items` + `assignLanes` in `build()`; keep a per-cell
   map of lane-0 event id when building rows. `recurringEventId` present →
   toast; else `deleteEvent(id, 'instance')`.
6. **Settings row.** In `buildColors()`: a Budget `<input type="number"
   min="1" max="366" inputmode="numeric">` (blank = delete the field) and a
   Blocks toggle (a `<button aria-pressed>` styled like the segment control,
   not a checkbox — iOS PWA checkbox styling is the OPEN.md hazard). Both
   are structural edits → `rebuild()`.
7. **Stretch retune.** `'2.2fr'` becomes `wide ? '2.2fr' : '1.35fr'`.
8. **Style.** Append to `style.css`: `.planstrip`, `.planchip`,
   `.planchip[aria-pressed="true"]`, `.planchip-fig`, `.yrcell[data-paint]`
   (background: `color-mix(in srgb, var(--cat) 16%, transparent)` — check
   the existing bar-fill rule and use the same mechanism it uses),
   `.yearview[data-mode] .yr { touch-action: none; cursor: crosshair }`.
   No transition anywhere in these rules (CONVENTIONS).

## Verification (write it up; the human runs the gate)
- `npm run selftest` green with the new cases, and `npm run build` clean.
- Hit-test every new control with `elementFromPoint` (CONVENTIONS).
- Headless probe (extend `scripts/shot.mjs` or a sibling): seed a budgeted
  category in prefs, paint a run by dispatching pointer events at cell
  centres, assert the optimistic event appears in the cache and the strip
  figure changes; then a blocked run, assert nothing in the cache and the
  toast text. Both answers from one instrument (CONVENTIONS: an instrument
  that has only ever reported one answer proves nothing).
- On the real wire (human): SPEC "Definition of done — Planning layer".

## Out of bounds
Anything in `OPEN.md` "Opened at the planning layer". Holidays, AI, weekday
budgets, split-erase, a second calendar. Do not touch `day.ts`, `scroll.ts`,
`render.ts`, `motion.css`, `sw.ts`, first-run, or the settings sheet outside
`buildColors()`.
