# Stage 03 — verification

**Status: GATE PASSED and CLOSED, 2026-08-29.** Every automated criterion below passed;
the human approved on device with every tuned constant at its SPEC value. All 14
rulings are promoted to `DECISIONS.md` (and `SPEC.md` where they change the
contract); this file is now a record, not an input.
Everything under "Gate" is the human's to run on a device; those rows are
unfilled by design, as is the "after the gate" column of the tuned-by-feel
table. At gate close the rulings below are promoted to `DECISIONS.md` (and
`SPEC.md` where they change the contract) and this file becomes a record.

Branch `stage-03-engine`, 18 commits on `main`. Suite grew 42 → 51 cases.

## Automated criteria (agent-run, evidence inline)

| Criterion | Result | Evidence |
|---|---|---|
| `npx tsc --noEmit` | PASS | `TSC_CLEAN`, no diagnostics |
| `npm run selftest` | PASS | `51/51`, exit 0 |
| `npm run build` | PASS | `✓ built`; chunks `index`, `scroll`, `selftest` plus css |
| No motion literal outside `motion.css` | PASS | `grep -n "transition\|animation" src/*.css src/*.ts index.html` minus `motion.css` → three `style.css` lines, all `var(--t-*) var(--ease-*)`; the `.ts` hits are comments. |
| No colour literal outside the token layer | PASS | `render.ts`/`year.ts` set `data-cat` only; `style.css` consumes `var(--*)`; the `:root` block in `style.css` holds the four non-mood tokens (`--ink`, `--ink-dim`, `--rule`, `--today`, `--ring`) by ruling 3 below. |
| `scroll.ts` imports `types.ts` and `dates.ts` only | PASS | `grep ^import src/scroll.ts` |
| Browser globals inside functions only | PASS | `npm run selftest` imports `scroll.ts`, `render.ts` under bare node and passes. |

### The variable-height row is proven, not asserted

`OPEN.md` "Rebuild questions" carries the stage-09 stop-and-revise clause:
*whether the virtualizer's one variable-height row can be done without an
overlay*. `scroll: posOf/heightOf/weekAtY round-trip, uniform and expanded`
runs the pure maths with a non-null `expanded` under node. Plan Task 1 Step 5
breaks `posOf` (`w > ex.week` → `w >= ex.week`) to show the case is
non-vacuous; reproduced today:

```
--- BROKEN posOf (>=):
FAIL  scroll: posOf/heightOf/weekAtY round-trip, uniform and expanded — expanded: week 4 -> y 740 -> 3
50/51
--- RESTORED:
51/51
```

The maths break exactly at the expanded row and nowhere else. The virtualizer
is synthetic (`y` is a number we own), so the expanded row costs one
conditional offset in `posOf`/`heightOf` and stays O(1) — no overlay is needed.
**This closes the clause with evidence**; the human confirms at gate close.

### Headless evidence — `npm run shot` (six runs: 3 viewports × 2 schemes)

`scripts/shot.mjs` seeds `localStorage` with a crafted `ready` August
(a 21-day all-day run Mon 10 → Sun 30; a timed 09:15 event; five all-day
events stacked on the 20th) and September (a 2-day event), never touching
auth or the network. Colour scheme via CDP `Emulation.setEmulatedMedia`;
`body` background came back `rgb(242,239,234)` (Warm light) and
`rgb(20,18,16)` (Warm dark), proving the emulation took. Every
"control works" claim is `document.elementFromPoint()` at the control's centre.

| claim | 390×844 L | 390×844 D | 1440×900 L | 1440×900 D | 1920×1200 L | 1920×1200 D |
|---|---|---|---|---|---|---|
| `.week` nodes | 14 | 14 | 14 | 14 | 14 | 14 |
| row height (px) | 121 | 121 | 130 | 130 | 176 | 176 |
| row spacing = row height | true | true | true | true | true | true |
| docked row top at content centre (Δpx) | 0 | 0 | 0 | 0 | 0 | 0 |
| 21-day event: titled bars | 1 | 1 | 1 | 1 | 1 | 1 |
| … `data-cont-before` / `data-cont-after` | 2 / 2 | 2 / 2 | 2 / 2 | 2 / 2 | 2 / 2 | 2 / 2 |
| rows showing two bands (Aug/Sep split mid-row) | 4 | 4 | 4 | 4 | 4 | 4 |
| timed event is a chip, never a bar | true | true | true | true | true | true |
| any day number clipped by its tile | false | false | false | false | false | false |
| "+N" on the stacked day (6 bars incl. the run) | +2 | +2 | +2 | +2 | none | none |
| wheel nudge settles on an anchor row | true | true | true | true | true | true |
| boundary rule y = content centre after settle | true | true | true | true | true | true |
| header after settle | Aug – Sep 2026 | ″ | ″ | ″ | ″ | ″ |
| `.week` count after a year back by wheel | 14 | 14 | 14 | 14 | 14 | 14 |
| header a year back | Aug – Sep 2025 | ″ | ″ | ″ | ″ | ″ |
| Today button hit-tests; returns today to centre | true | true | true | true | true | true |
| Cal/Year toggle hit-tests | true | true | true | true | true | true |
| year columns / rows | 14 / 27 | 14 / 27 | 28 / 14 | 28 / 14 | 28 / 14 | 28 / 14 |
| year cells | 365 | 365 | 365 | 365 | 365 | 365 |
| year fits without scrolling | **false** | **false** | true | true | true | true |
| bars on the 6-event day (cap 3) | 3 | 3 | 3 | 3 | 3 | 3 |
| panel lists every event (19th/20th/21st) | 8 | 8 | 8 | 8 | 8 | 8 |
| panel passes the pointer through | true | true | true | true | true | true |
| panel flips above at the bottom edge | true | true | true | true | true | true |
| panel survives a repaint, never hidden | true | true | true | true | true | true |
| year cell hit-tests | true | true | true | true | true | true |

Notes on the numbers:
- Row heights 121/130/176 all sit inside the 74–190 clamp and differ by
  viewport — proportional, not fixed.
- The 21-day run is three pieces: Aug 10–16 (`cont-after`), 17–23 (both),
  24–30 (`cont-before`). Title once, on the first. The plan's "2
  continuation bars" counted pieces-with-`cont-before`; the selector it
  wrote counts either attribute, which is 3. Both numbers are right.
- "+2" is honest accounting: capacity at 121–130px is 4 lanes, the 20th
  carries 6 bars, 2 are hidden and reported. At 176px capacity is 7 and
  nothing is hidden, so no "+N" — `visibilityFor` in both cases.
- **Year view on the phone scrolls**: 27 rows of 14 at 390px is ~860px in a
  788px viewport, about one row over. SPEC's "no scrolling" is a desktop
  claim; the phone question is the gate's (ruling 10).

### Interaction checks not in the harness (run ad hoc via CDP, 2026-08-29)
- Real `Input.dispatchMouseEvent` hover on a year cell raises the panel
  below it with the hovered day in the middle; `elementFromPoint` under the
  panel resolves to the cell beneath (panel is `pointer-events: none`).
- Touch flow with `Emulation.setTouchEmulationEnabled` (`hover: none`
  true): a `pointerover` of type `touch` is ignored; first tap raises the
  panel and stays in the year view; a tap on a pad cell dismisses; a second
  tap on the same day returns to the calendar with the header back at
  "Aug – Sep 2026".
- Panel drops on `pointerleave` and when the year changes (`›`), and only
  then.
- `›` then Today: header 2027 → 2026, today's cell ringed again.

## Rulings the spec left open (promote at gate close)

1. **The palette** — fifty values in `categories.ts` `MOODS`: a fixed
   lightness ladder (`--band-a-end` +2.5, `--band-a` +4, `--band-b-end`
   +4.5, `--band-b` +6 relative to the ground) applied to five hues.
   **Warm's light ground moved off the seed `#f7f6f3` to `#F2EFEA`** — the
   seed's 96.1% lightness left no headroom for four raised steps. The seed
   near-black `#0f1115` is hue 220 and is now Cool's dark ground exactly.
   Dark grounds are near-identical by design; the mood reads through the
   bands. The ladder is asserted in both schemes by
   `categories: the mood ladder holds in both schemes`.
2. **Four non-mood tokens** (`--ink`, `--ink-dim`, `--rule`, `--ring`) live in
   `style.css` `:root` with a dark override; they do not vary by mood.
3. **`--today` is reserved teal** (`#0D9488` light / `#2DD4BF` dark) and
   appears on exactly two marks: today's inset ring and today's day number.
   The hover ring is the neutral `--ring`, never `--today`.
4. **Hover is compositor-only**: `translateY(-2px)` plus an `::after` layer
   carrying `--el-hover` and the ring, cross-faded by opacity. No
   `box-shadow` transition, no `scale()`.
5. **`render.renderWeek(node, week, spans, rowH)`** — gained `rowH` so bar
   capacity is derived, not measured. `visibilityFor` is exported so the
   selftest pins the "+N" arithmetic the renderer actually uses.
6. **`ScrollHost` gained `mondayOf(week)` and `weekOf(day)`** so `scroll.ts`
   never imports `state.ts`; week↔day conversion arrives through the host.
7. **The header window is centred on the dock**: `renderRange(week − 3,
   week + 3)`. `onDock` reports the week at the viewport centre and ~6.5
   weeks are visible; the plan's `[week, week + 6]` named a window three
   weeks below the screen.
8. **Header order follows SPEC "Layout details"**: range, year steppers
   (year view only), Cal/Year toggle, Today, avatar slot. The plan snippet
   had Today before the toggle.
9. **`assignLanes` is shared** between week rows and the year grid and uses
   true interval intersection per lane, not a "rightmost occupied column"
   heuristic — longest-first does not deliver items left-to-right, and the
   heuristic wastes a lane when a later, earlier-starting item arrives. The
   year grid packs per row of `cols` cells in a bar overlay of the same
   shape as `.bars`, so a run crosses tile gaps as one object there too.
10. **Year view phone default is 14 columns** (`columnsFor`: ≥1100 → 28,
    ≥360 → 14, else 7), which puts `OPEN.md`'s "7 is a long scroll" on this
    gate. Bars stack from the cell's bottom edge (3px, 5px pitch) so three
    fit a 28px phone cell.
11. **The year panel is a sibling of the grid, not a child**, and `build()`
    replaces only the grid — that is what "survives repaints" means
    mechanically. The panel is refilled and repositioned in place on
    rebuild and dropped only by `pointerleave`, a tap elsewhere, or a year
    change.
12. **`main.ts` calls `ensureMonthsFor` only when the visible range moves.**
    `place()` reports the range on every repaint and a cache change is a
    repaint, so without the guard a signed-out session loops
    `error → notify → invalidate → place → onRangeChange → refetch → error`
    as one unbroken microtask chain that starves the renderer (found by the
    harness: `Runtime.evaluate` never returned). Cache-change repaints are
    also coalesced to one `requestAnimationFrame`, since opening a range
    starts a dozen fetches that each notify on `loading`.
13. **`scripts/`** is in the SPEC file layout: node-only tooling, never
    bundled (`selftest.ts` runner, `shot.mjs` harness).
14. **`meridiem()`** in `year.ts` is the one place a 12-hour time is
    formatted; week chips stay 24-hour tabular per SPEC.

## Findings for `OPEN.md` (not this stage's to fix)
- **Signed-out refetch pressure.** Stage 02's rule refetches an `error`
  month on every `ensureMonthsFor` call. With ruling 12 that is once per
  range move, but a long signed-out scroll still issues a token attempt per
  month per move. Stage 05 owns the connection state and should decide
  whether `error` becomes sticky while signed out.

## Tuned-by-feel table (human fills "after the gate")

| constant | SPEC | after the gate | why it moved |
|---|---|---|---|
| `VISIBLE_WEEKS` | 6.5 | | |
| `MIN_ROW_H` | 74 | | |
| `MAX_ROW_H` | 190 | | |
| `SNAP_ALIGN` | 0.5 | | |
| `PROJECT_MS` | 300 | | |
| `SETTLE_BASE_MS` | 280 | | |
| `SETTLE_PER_WEEK_MS` | 42 | | |
| `SETTLE_MAX_MS` | 760 | | |
| `WHEEL_GAIN` | 0.6 | | |
| `WHEEL_IDLE_MS` | 140 | | |
| `HAPTIC_ON_SNAP` | false | | |

## Gate (human, on device)

| Criterion | Result |
|---|---|
| Flick three months: settles softly on a centred anchor; header updates | |
| Double-tap never zooms on the phone | |
| 15/30/45 each land on valid anchors — **not switchable on device this stage**: only 30 is wired, the step control is stage 05's Settings, and `ctl` is not on `window.bramwell`. Say if you want a DEV-only step toggle before the gate. | |
| No day number clipped at any window width | |
| Year view: 365 days without scrolling on the desktop; hover panel keeps up and flips at edges; tap flow on the phone | |
| `.week` count stays 14 after scrolling a year back | |
| 14 vs 7 columns on the phone (ruling 10) — keep 14? | |
| Palette reaction (ruling 1) — Warm light ground off the seed; dark grounds near-identical | |

## Not tested
- 60fps on a real mid-range phone — headless cannot measure it.
- The feel of the settle, projection, and drag; every constant above is at
  its SPEC value.
- Haptics — `HAPTIC_ON_SNAP false` by decision.
- Anything needing a real account: the harness seeds `localStorage`. Real
  events with recurring instances, cross-month spans from Google, and the
  refresh-while-scrolling path are exercised only by the stage-02 suite.
- `prefers-reduced-motion` collapse (the rule exists in `motion.css`; not
  driven).
- Whether 14 columns actually beats 7 on a phone in the hand.
- The `15`/`45` snap steps in the browser: `setSnapStep` is unit-tested via
  `nearestAnchor` (`scroll: anchor sequence and the 15/30/45 modulus`) but
  only 30 is wired, since the step control is stage 05's Settings.
- Safari `gesturestart` suppression and iOS double-tap — listeners are
  bound; behaviour needs the device.
