# Planning layer — verification (iteration A, 2026-09-05)

**Status: BUILT, headless-verified, awaiting the human gate.** Branch
`planning-layer`, worktree `bramwell-A`. The human was not available during
the session; every ruling below was shipped as written and is listed for the
gate to confirm or reverse.

## What was built, per the brief's steps

1. **Types + sanitize.** `StoredCategory.budgetDays?: number` (integer
   1–366) and `blocks?: true`. `categories.sanitize()` keeps the row and drops
   an invalid field through `plan.sanitizePlanning(row)`. Seed: `vacation`
   (label Vacation, colorId 7, displayHex `#0E86C4`, dark twin `#5CC1F2`, no
   budget) and `blackout` (Blackout, colorId 11, `#B3261E` / `#F28B82`,
   `blocks: true`) appended after `financial`, before `OTHER`. The four
   original rows and their colorIds are unchanged; the selftest pins that.
2. **`src/plan.ts`**, DOM-free, imports `types.ts` and `dates.ts` only:
   `runOf`, `daysUsed`, `firstBlocked`, `sanitizePlanning`, plus the `Run`
   type. Cross-month duplicate handling: `daysUsed` counts a distinct-day set,
   so the same event handed twice adds the same days once — documented on the
   function, pinned by a case; the caller does not dedupe.
3. **Strip.** `.planstrip` inside the year root before `gridHost`; one
   `.planchip` per category (dot, label, `.planchip-fig`) plus Erase.
   Figures from `daysUsed` over the displayed year, rebuilt on every
   `build()` and BEFORE its width guard (see ruling 4). Over budget:
   `data-over` → `--ink-strong` 620. Phone: `overflow-x: auto`, no scrollbar
   chrome, and sticky (ruling 13).
4. **Paint mode.** `mountPlanner(host: PlanHost): PlanController` in
   `year.ts`, host-agnostic per SPEC "Both views": mode state, pointer
   capture on `host.surface`, `elementFromPoint` → cell on every move, run
   highlight via `data-paint` + `data-cat` on the cells, the `firstBlocked`
   check, the write through `host.createEvent`, Escape (mid-drag: abandon).
   `data-mode` on the root; hover panel suppressed for the whole mode;
   `touch-action: none` + `cursor: crosshair` on `.yr` while set.
   `YearController.exitMode()` added and called from `showYear(false)`.
   `YearHost.toast` added; `main.ts` passes `chrome.toast`.
5. **Erase.** Pointer down/up within `TAP_SLOP` (6, copied by value from
   `main.ts` with a comment) → the cell's `data-lane0` id (set in `build()`
   during lane assignment) → recurring → toast; else
   `deleteEvent(id, 'instance')`. A drag, or an empty cell, does nothing.
6. **Settings row.** In `buildColors()`: a `.plan-row` under each category
   row with a Budget `<input type="number" min=1 max=366 inputmode=numeric>`
   (blank deletes the field; out-of-range reverts and writes nothing) and a
   Blocks `<button aria-pressed>` reusing the `set-seg`/`set-segb` look. Both
   `rebuild()`.
7. **Stretch retune.** `wide ? '2.2fr' : '1.35fr'`.
8. **Style.** One block appended to `style.css`: `.planstrip`, `.planchip*`,
   `.yrcell[data-paint]` (the bar fill's `color-mix(... 16%, transparent)` as
   a `background-image` layer over the tile), `.yearview[data-mode] .yr`,
   `.plan-row`/`.plan-bud`/`.plan-unit`, and step 9's `.yrpanel-open` +
   `@media (hover: none) { .yrpanel { pointer-events: auto } }`. No
   transition or animation declaration was added (grep: the only new hit is
   a comment saying so).
9. **Touch panel affordance.** Under `(hover: none)` the panel ends with
   `.yrpanel-open` "Tap again to open" (`--ink-dim`, 12px), is
   `pointer-events: auto`, and a click on it calls `host.onPickDay(shown)`.
   Under hover: no line, `pointer-events: none` — both measured.

## Gate criteria and results

### `npm run selftest` — 62/62 (was 57/57 at branch)
New cases: `plan: sanitizePlanning keeps the row and drops an invalid field`
(0, 367, 2.5, "30", -1, NaN, null, true dropped; 1, 366 kept; `blocks`
1/"true"/false/"yes"/{} dropped, `true` kept; through `sanitize()` the row
survives), `categories: the seed sanitizes to itself, blocks intact`,
`plan: runOf orders, clips and is inclusive`, `plan: daysUsed counts distinct
in-year all-day days of one category` (overlap once, Dec 31 clip, timed zero,
other category zero, duplicate once, other year zero), `plan: firstBlocked
finds the lowest blocked day or null` (lowest in the RUN, timed never blocks,
empty set never blocks). Each was watched failing first (module/exports
missing at link) and then passing. Two existing seed-size assertions moved
from 4 to 6.

### `npm run build` — clean (tsc --noEmit, vite build, build-sw)

### Headless probe — `scripts/plan-shot.mjs`, output in `planning-layer.probe.json`
Run against `npm run dev` on the port the server printed (5174; 5173 was
taken by another vite — the harness comment's trap, met). Chrome
`--headless=new` over CDP; colour scheme via `Emulation.setEmulatedMedia`;
the coarse pointer via `Emulation.setTouchEmulationEnabled` (see "What was
learned"). Seeded prefs: the six seed categories with Vacation `budgetDays
30`; seeded cache: a 5-day Vacation run Aug 3–7, a 3-day Blackout Aug 13–15,
a recurring instance Aug 20, September empty.

**Hit-tests (every new control, `elementFromPoint` at the centre resolving
to the control or a descendant)** — 1440×900 light AND dark, 390×844 dark:
- all 7 chips (Work, Personal, Financial, Vacation, Blackout, Other, Erase): hits
- the Erase chip after mode changes: hits
- `.plan-bud` and `.plan-blocks` on the Vacation row (sheet open): hits
- `.yrpanel-open` at 390 under coarse pointer: hits
- a Vacation chip on the sticky strip after `scrollTop = 400` at 390: hits
- `#btn-mode`: hits (control for the instrument)

**Both answers, one instrument** (desktop, identical in light and dark):
- Blocked run Aug 12–16 with the Vacation chip: mid-drag 5 cells
  `data-paint`, all `data-cat="vacation"`, tint layer present; on pointer-up
  toast **"Aug 13 is blocked"**, paint cleared, Aug 12/16 carry no
  `data-has-ev`, strip still "5 / 30".
- Allowed run Sep 7–11: mid-drag 5 cells; on pointer-up, paint cleared and —
  read synchronously through the year view's own repaint before the
  microtask queue runs — Sep 7/9/11 carry `data-has-ev` and the strip reads
  **"10 / 30"**; no toast before yielding. After three frames the write has
  failed (`VITE_GOOGLE_CLIENT_ID is not set` — `.env.local` is absent in this
  worktree by design), the toast carries that message, and the strip is back
  to "5 / 30". Optimistic apply and rollback both observed.
- Blackout chip over the existing Vacation run: no refusal, strip Blackout
  3 → **8** optimistic, then rollback to 3 with the same signed-out toast.
- Erase, recurring day (Aug 20, `data-lane0 = rec-1`): toast **"Recurring —
  edit it from the month view"**, event still there. Erase, empty cell: no
  toast. Erase with a 40px pointer travel on Aug 4: nothing erased. Erase
  click on Aug 4 (`data-lane0 = vac-5`): Aug 3/4/7 lose `data-has-ev`, strip
  **"0 / 30"** optimistic, rollback to "5 / 30".
- Mode: chip click → `data-mode="paint"`, chip `aria-pressed=true`, `.yr`
  `touch-action: none`, `cursor: crosshair`, hover panel suppressed
  (`pointerover` on a cell leaves it hidden). Escape → `data-mode` gone,
  `touch-action: auto`, all chips unpressed. Escape mid-drag: 5 painted → 0,
  the following pointer-up writes nothing, no toast. Leaving the view with
  a mode on: `data-mode` gone after `showYear(false)`.
- Hover panel under `(hover: hover)`: shown, `pointer-events: none`, no tap
  line — the negative control for step 9.

**Settings (1440 light):** Vacation budget shows "30"; Blackout's toggle
pressed; Personal's not. Toggle Personal → prefs `blocks: true`, rebuilt row
pressed; toggle again → the key is deleted (not written `false`). Budget 20
→ prefs `budgetDays: 20`, field shows 20; "400" → refused, field back to 20,
prefs untouched; blank → key deleted. A budget of 12 set on Work while the
year view was hidden shows as **"1 / 12"** on the next open (ruling 4).

**Phone (390×844, touch emulation, dark):** `matchMedia('(hover: none)')`
true; rows carry `1.35fr` and no `2.2fr` (desktop rows carry `2.2fr`); the
strip's `overflow-x` is `auto` and its `scrollWidth > clientWidth`; strip
top stays at 0 of the year view after the grid scrolls 400px under it. First
touch tap on Aug 3 raises the panel with "Tap again to open" in the
`--ink-dim` colour (`rgb(154,151,143)` = `#9A978F`), panel `pointer-events:
auto`; a click on the panel hides the year view and opens **Aug 3**
(`.day[data-open]` = 20668) in the calendar. Paint mode: `touch-action:
none`, a 3-cell drag paints 3, exit restores `auto`.

### Screenshots (scratch, not committed)
Year view mid-drag light/dark, the settings sheet light/dark, the phone panel
— looked at, not measured. The phone one is what caught the strip scrolling
away (ruling 13).

## Rulings the spec left open (for the gate to confirm)

1. **Un-budgeted, non-blocking categories show their used count**; a count
   of 0 with no budget is omitted so a fresh install is not a row of zeros.
   DECISIONS' "the strip shows days used until then" (Vacation, no budget) is
   what generalised.
2. **Erase takes the lowest-lane ALL-DAY bar among the drawn lanes**, not
   literally lane 0: SPEC's noun is "all-day event", and a timed event can
   hold lane 0 in the year grid (timed events are bars there, unlike the
   month view). A cell whose only bars are timed erases nothing.
3. **`daysUsed` absorbs the cross-month duplicate**; no caller dedupe.
4. **The strip rebuilds before `build()`'s `clientWidth === 0` guard**, so a
   budget set in Settings while the year view is hidden lands on the next
   show. The grid still bails while hidden (unchanged, stage 03).
5. **Seed twins:** Vacation `#0E86C4`/`#5CC1F2`, Blackout `#B3261E`/`#F28B82`.
   Blackout is crimson, deliberately apart from `--past` (a 2px edge, half
   opacity) and `--cat-err`; the SPEC "Categories" seed table needs these
   rows (upstream amendment 1 below).
6. **The planning fields sit on a second line under each category row**
   (`.plan-row`): `.set-cat` carries six controls at 380px and does not wrap,
   and its rule is outside this iteration's CSS surface. The Blocks toggle
   reuses `set-seg`/`set-segb` so it IS the segment control's look.
7. **The paint tint is a `background-image` layer** over the tile's band
   colour, using the bars' exact `color-mix(... 16%, transparent)`; the
   cell also carries `data-cat` so `--cat` resolves through the bars' rule.
8. **Step 9's CSS** (`.yrpanel-open`, the `(hover: none)` pointer-events
   rule) was appended alongside the `.plan*` block — not `.plan*` rules, but
   named by the brief's own step.
9. **`PlanHost`** = `{ root, surface, cellAt, cellsIn, dayOf, laneZeroId,
   eventsIn, bounds, createEvent, deleteEvent, toast, onModeChange }` —
   the brief's list plus `surface` (the capture target), `eventsIn` (for
   the conflict check), `bounds` (so D can pass an open range) and
   `onModeChange` (panel/chips). Category label and the `blocks` set are
   read from `categories.ts` inside the controller — module state, not a
   `year.ts` closure.
10. **`TAP_SLOP` is copied by value** (6) with a comment naming `main.ts`.
11. **Escape mid-drag** releases capture, clears the paint, writes nothing,
    exits the mode. `exitMode()` is the same path.
12. **Chip semantics:** click selects; the selected chip deselects; a
    different chip switches directly.
13. **The strip is sticky** at the top of the year view, on `--surface`,
    z-index 3 — SPEC's "always visible" holds on a phone where the view
    scrolls.
14. **The over-budget figure is the only over-budget mark**; the chip itself
    does not change (SPEC "nothing else").
15. **The blocked-day toast is locale-formatted** (`month: 'short', day:
    'numeric'`, UTC) — "Aug 13" in en-US, "13 Aug" in en-GB — the same
    display-boundary Date the panel header uses.

## Upstream amendments needed (not made — outside this session's authority)

1. `SPEC.md` "Categories and customization": the seed table lists four
   rows; add Vacation (7, `#0E86C4`, `#5CC1F2`) and Blackout (11, `#B3261E`,
   `#F28B82`, blocks). "Planning layer — Category planning fields" still
   says "The seed is unchanged: no seed category has either field" — now
   false (Blackout blocks); DECISIONS already carries the amendment.
2. `SPEC.md` "Definition of done — Category rules": "fresh install renders
   the four seed categories" → six.
3. `SPEC.md` "Planning layer — The plan strip": record rulings 1, 2 and 13
   if the gate confirms them.
4. `OPEN.md`: the year grid still bails on a hidden root, so a category
   RENAME made from the month view reaches the grid's inline titles only on
   the next repaint; the strip is fresh (ruling 4). Pre-existing, noted.
5. `CONVENTIONS.md` "Verification": `(hover: none)` / `(pointer: coarse)`
   are NOT media features `Emulation.setEmulatedMedia` honours;
   `Emulation.setTouchEmulationEnabled` is what flips them (learned here,
   first attempt failed silently with hover still `hover`).

Made, as the brief authorised: `SPEC.md` "Scroll engine API" now lists
`YearController` with `exitMode()` and `year.mountPlanner(host): PlanController`.

## Not tested
- The real wire (SPEC "Definition of done — Planning layer"): the event
  arriving in the Google Calendar app with the right colour and dates; the
  reconciled figure after a successful write; erase reaching Google. The
  worktree is signed out with no client id, so every write here rolled back.
- A real finger: pointer capture with a synthetic `pointerId` throws (caught;
  the drag still works because the listeners are on the root). Whether
  `touch-action: none` on `.yr` under a real iOS gesture keeps the page from
  scrolling while a finger paints is the phone gate's to see.
- iOS auto-zoom on the 12px Budget field — session C's item; `.plan-bud`
  inherits the sheet's sizes and will need C's 16px-under-coarse rule.
- The month-view mount (iteration D): `PlanHost` was shaped for it, not
  exercised on it.
- Light-mode phone; reduced motion (nothing here animates, by ruling).

## What was learned (for CONVENTIONS, via the gate)
- An optimistic apply that is rolled back in the same microtask queue is
  invisible to a rAF-coalesced repaint; a synchronous repaint path (here the
  year view's own resize listener) is how a probe sees the pending state
  without reaching into module internals.
- Coarse-pointer emulation is touch emulation, not a media feature.
