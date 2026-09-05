# Planning layer — implementation plan (iteration A, 2026-09-05)

> Executed inline in this session (superpowers:executing-plans). Pure core
> TDD'd through `npm run selftest`; DOM steps verified by the headless probe
> `scripts/plan-shot.mjs` (sibling of `shot.mjs`, per the brief).

**Goal:** the year view gains a plan strip, paint mode, the conflict rule and
erase, backed by two planning fields on `StoredCategory` and a DOM-free core
in `src/plan.ts`.

**Spec:** `_iteration/planning-layer.md`; `_references/SPEC.md` "Planning
layer (2026-09-05)", "Categories and customization", "Scroll engine API",
"Year view — Touch (amended 2026-09-05)"; DECISIONS "Planning layer rulings".

## Brainstorm against the contract — questions the brief leaves open, and the rulings taken

The human is absent this session; each of these is shipped as ruled here and
repeated in `planning-layer.verification.md` for the gate.

1. **A category with neither budget nor `blocks`.** SPEC gives figures only
   for budgeted ("used / budget") and blocking ("count alone") categories;
   DECISIONS says the un-budgeted seeded Vacation "shows days used until
   then". Ruling: every chip shows its used count; a budgeted one shows
   `used / budget`; a count of 0 with no budget is omitted so a fresh install
   is not a row of zeros.
2. **Erase target.** The brief says "the lane-0 bar"; SPEC says "the ONE
   all-day event under it — the topmost bar (lane 0)". A timed event can hold
   lane 0 in the year grid (timed events are bars there). Ruling: the lowest-
   lane ALL-DAY bar among the drawn lanes (< 3). SPEC's noun wins.
3. **Cross-month duplicate events.** `eventsForMonth` stores a boundary-
   crossing event in both months. Ruling: `daysUsed` is robust to the
   duplicate by construction (a distinct-day set), documented on the function
   and tested by passing the same event twice; `firstBlocked` is a min over
   events, likewise idempotent. The caller does not dedupe.
4. **Strip freshness while hidden.** `build()` bails at `clientWidth === 0`
   (the year view hidden under the calendar). A budget edited in Settings
   from the month view would leave the strip stale on the next show. Ruling:
   the strip is rebuilt BEFORE that guard — it needs no measurement.
5. **Seed twins.** Vacation `displayHex #0E86C4` (a deeper Peacock that holds
   on light tiles the way `#3056D3` does against Blueberry), dark twin
   `#5CC1F2`. Blackout `#B3261E` (crimson, distinct from `--past` red at 2px
   and from `--cat-err`), dark twin `#F28B82`.
6. **Settings row geometry.** `.set-cat` is a non-wrapping flex row that
   already carries six controls at 380px; `.set-cat`'s rule is outside this
   iteration's CSS surface. Ruling: the Budget input and Blocks toggle sit on
   a second line under each category row (`.plan-row`), inside
   `buildColors()`. The toggle reuses `set-seg`/`set-segb` so it IS the
   segment control's look, with `.plan-blocks` as its own identity.
7. **Paint highlight mechanism.** `.yrbar`/`.bar` use
   `color-mix(in srgb, var(--cat) 16%, transparent)` as a fill over the tile.
   A cell's band colour is its `background-color`; the tint is applied as a
   `background-image` gradient layer so the tile stays and the category tint
   sits on it (a transparent mix as `background` would drop the tile).
   `--cat` resolves through the same `[data-cat]` rule the bars use: the
   painted cell carries `data-cat` alongside `data-paint`.
8. **Step 9 CSS.** `.yrpanel-open` and `@media (hover: none) { .yrpanel {
   pointer-events: auto } }` are not `.plan*` rules but step 9 names them;
   appended with the planning block and recorded.
9. **Controller host (SPEC "Both views").** `PlanHost = { root, surface,
   cellAt, cellsIn, dayOf, laneZeroId, eventsIn, bounds, createEvent,
   deleteEvent, toast, onModeChange }`. Categories (label, `blocks` set) are
   read from `categories.ts` inside the controller — module state, not a
   `year.ts` closure. `bounds()` exists so D can pass an open range.
10. **Erase click vs. paint drag share one pointer path.** Erase acts on
    pointer-up when the pointer moved ≤ 6px (`TAP_SLOP`, copied by value with
    a comment naming `main.ts` as its home — `main.ts` is not importable).
11. **Escape mid-drag** releases capture, clears `data-paint`, writes nothing,
    and exits the mode. `exitMode()` does the same from `showYear(false)`.
12. **Chip semantics.** Click selects; click the selected chip deselects;
    click a different chip switches without passing through null.

## File map

- Create `src/plan.ts` — pure core.
- Modify `src/types.ts` — `budgetDays?`, `blocks?` on `StoredCategory`.
- Modify `src/categories.ts` — seed rows, twins, `sanitize()` calls `sanitizePlanning`.
- Modify `src/selftest.ts` — new cases; two seed-size assertions updated.
- Modify `src/year.ts` — strip, planner controller, lane-0 map, stretch, touch panel line, `exitMode`.
- Modify `src/chrome.ts` inside `buildColors()` only — `.plan-row`.
- Modify `src/style.css` — appended block only.
- Modify `src/main.ts` — `toast` into `year.mount`; `yearCtl?.exitMode()` in `showYear(false)`.
- Create `scripts/plan-shot.mjs` — headless probe.
- Create `_iteration/output/planning-layer.verification.md`.

## Tasks

### Task 1 — types + sanitize (brief step 1)
- [ ] RED: selftest case `plan: sanitizePlanning keeps the row and drops an invalid field` (0, 367, 2.5, "30" dropped; 1, 366 kept; `blocks: 1`, `"true"` dropped; `true` kept) and `categories: the seed sanitizes to itself with blocks intact` (seed = work,personal,financial,vacation,blackout,other; blackout.blocks === true; vacation has no budget). Update the two 4-row assertions to 6.
- [ ] Run `npm run selftest` → fails on the missing module / seed.
- [ ] GREEN: `types.ts` fields; `plan.ts` `sanitizePlanning`; `categories.ts` seed + twins + call.
- [ ] `npm run selftest` green. Commit.

### Task 2 — `runOf`, `daysUsed`, `firstBlocked` (step 2)
- [ ] RED: `plan: runOf orders, clips and is inclusive`; `plan: daysUsed counts distinct in-year all-day days of one category` (overlap once; cross-Dec-31 clipped; timed zero; other category zero; duplicate copy once); `plan: firstBlocked finds the lowest blocked day or null`.
- [ ] Fail, implement, pass, commit.

### Task 3 — strip (step 3) + stretch retune (step 7) + style (step 8)
- [ ] `.planstrip` before `gridHost`; chips; figures; over-budget `data-over`; Erase chip. Rebuilt before the width guard.
- [ ] `'2.2fr'` → `wide ? '2.2fr' : '1.35fr'`.
- [ ] Append CSS block. Build clean. Commit.

### Task 4 — planner controller: paint (step 4), erase (step 5), `exitMode`
- [ ] `PlanHost`/`mountPlanner` in `year.ts`; chip clicks drive it; `onOver` early return; `hidePanel` on entry; `data-mode` on root; lane-0 map in `build()`; `toast` on `YearHost`; `exitMode` on the controller; `main.ts` two lines.
- [ ] Build clean. Commit.

### Task 5 — settings row (step 6)
- [ ] `.plan-row` under each `.set-cat`: Budget input (blank deletes; invalid reverts) and Blocks toggle; both `rebuild()`.
- [ ] Build clean. Commit.

### Task 6 — touch panel affordance (step 9)
- [ ] `.yrpanel-open` line under `(hover: none)`; panel click → `onPickDay(shown)`.
- [ ] Commit.

### Task 7 — headless probe + verification
- [ ] `scripts/plan-shot.mjs`: seeded prefs (Vacation budget 30, Blackout blocks) and cache (a 5-day Vacation run, a 3-day Blackout run, a recurring instance); hit-tests on every chip, the Erase chip, the Budget input, the Blocks toggle, the painted cells, the panel line at 390/coarse; a blocked run (toast text, no `data-has-ev` change, strip unchanged) THEN an allowed run (`data-paint` count mid-drag, `data-has-ev` after, strip 5→10); Escape restores `touch-action`; erase on the run (strip 5→0) and on the recurring day (toast); stretch factor at 390 and 1440.
- [ ] Write `planning-layer.verification.md`; record `exitMode` in SPEC "Scroll engine API" (the one reference edit the brief authorises); commit; push.
