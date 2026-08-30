# Stage 03 — Scroll Engine, Rendering, Year View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A perpetual vertical calendar that scrolls forever, snaps softly onto half-month anchors, renders weeks as recycled rows of Night Depth tiles with lane-packed bars and timed chips, plus a year view — all driven from the stage-02 data layer.

**Architecture:** `scroll.ts` is a synthetic virtualizer that knows nothing about calendars: it owns a scroll offset `y` it controls outright, places 14 recycled rows by transform, and calls a `fillRow(node, week)` callback injected by `main.ts`. All position maths are pure functions taking an `expanded` parameter, so stage 04's one variable-height row is proven under node here and only needs a setter there. `render.ts` fills rows and owns lane packing; `year.ts` rebuilds 365 cells in one pass. Nothing but `main.ts` touches more than one of them.

**Tech Stack:** Vite 6, TypeScript 5 strict, vanilla TS + CSS custom properties, Node 26 native type stripping. No runtime dependencies added.

**Spec:** `03_engine/CONTEXT.md` (contract, including its carry-forward block); `_references/SPEC.md` sections "The core interaction", "Year view", "Layout details", "Visual direction — Night Depth", "Perpetual scroll mechanics" (incl. "Scroll engine API"), "Motion", "Categories and customization" (rendering consumers only); `_references/CONVENTIONS.md`; `_references/DECISIONS.md` — "In force — scroll and render", "Rejected — do not retry", "Stage 03 rulings".

## Global Constraints

- TypeScript strict. No `any` without a `// why:` comment. `import type` for type-only imports (`verbatimModuleSyntax`). `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on.
- **Node type-stripping compatibility** for every module the selftest reaches: no `enum`, no `namespace`, no constructor parameter properties, no decorators.
- **Browser globals inside functions only, never at module scope** — `scroll.ts` and `render.ts` join the node selftest graph so their pure cores can be TDD'd. A module-scope `window`/`document` read takes the whole suite down.
- **The virtualizer never writes `w * H` inline.** Every position and height goes through `posOf` / `heightOf`, and the inverse through `weekAtY`. (DECISIONS "Stage 03 rulings" — this is what keeps stage 04 possible.)
- `scroll.ts` imports `types.ts` and `dates.ts` ONLY. It must not import `render.ts`, `state.ts` or `categories.ts`.
- **Motion carve-out** (SPEC "Motion", CONVENTIONS): CSS transition/animation values live only in `motion.css`; the scroll engine's per-frame physics constants live at the top of `scroll.ts`. A literal at a use site is wrong in either case.
- No colour literal outside the token layer. `render.ts` sets `data-cat` and nothing else per frame; runtime colour comes from `categories.themeCss()` via the one `<style>` `main.ts` owns.
- Tuned constants at the top of `scroll.ts`, exact values: `VISIBLE_WEEKS 6.5`, `MIN_ROW_H 74`, `MAX_ROW_H 190`, `SNAP_ALIGN 0.5`, `PROJECT_MS 300`, `SETTLE_BASE_MS 280`, `SETTLE_PER_WEEK_MS 42`, `SETTLE_MAX_MS 760`, `WHEEL_GAIN 0.6`, `WHEEL_IDLE_MS 140`, `HAPTIC_ON_SNAP false`.
- Touch: `touch-action: manipulation` on `html, body`; `touch-action: none` on rows; `preventDefault` on `dblclick` and Safari `gesturestart/change/end`. **`user-scalable=no` is NOT the fix** (DECISIONS "Rejected") — the meta stays only for installed-PWA and Android.
- Rows are uniform and always full detail. **No zoom, no lens** — built, tried, rejected. **No row `transform: scale()`** — clipped Monday's day number at 1440px. Night Depth lifts cells with `translateY`.
- Every "this control works" claim is backed by `document.elementFromPoint()` at the control's centre (CONVENTIONS).
- Headless verification drives colour scheme with CDP `Emulation.setEmulatedMedia`. `--blink-settings=preferredColorScheme=2` is unsanctioned — it crashes Chrome 151's renderer.
- `npx tsc --noEmit`, `npm run selftest` and `npm run build` must pass at the end of every task.

---

## THE PALETTE — your reaction gate

Fifty values. Nothing else in this plan depends on your taste; this does. Task 2 writes exactly this table into `categories.ts` and nothing more, so rejecting it costs one task.

The ladder is fixed and identical for every mood — a mood shifts only hue and saturation. Lightness steps, relative to the ground: `--band-a-end` +2.5, `--band-a` +4, `--band-b-end` +4.5, `--band-b` +6. So month parity is a gentle alternation and weekends sit slightly *under* their own band rather than beside it.

### Light

| mood | `--surface` | `--band-a` | `--band-a-end` | `--band-b` | `--band-b-end` |
|---|---|---|---|---|---|
| warm | `#F2EFEA` | `#FAF9F7` | `#F7F5F2` | `#FEFEFD` | `#FBFAF9` |
| paper | `#F4F1E9` | `#FBFAF6` | `#F8F7F1` | `#FEFEFD` | `#FCFBF8` |
| cool | `#EBEEF2` | `#F7F9FA` | `#F3F5F7` | `#FDFEFE` | `#F9FAFB` |
| sage | `#ECF1EC` | `#F8FAF8` | `#F3F6F4` | `#FEFEFE` | `#F9FBF9` |
| dusk | `#EFECF1` | `#F9F8FA` | `#F5F3F6` | `#FEFEFE` | `#FAF9FB` |

### Dark (the design-lead mode)

| mood | `--surface` | `--band-a` | `--band-a-end` | `--band-b` | `--band-b-end` |
|---|---|---|---|---|---|
| warm | `#141210` | `#1F1C19` | `#1B1816` | `#25211E` | `#211D1A` |
| paper | `#131210` | `#1F1D1A` | `#1A1916` | `#24221E` | `#201E1B` |
| cool | `#0F1115` | `#181B21` | `#14171C` | `#1C1F26` | `#191C22` |
| sage | `#101411` | `#191F1B` | `#151B18` | `#1D2520` | `#1A211D` |
| dusk | `#120F15` | `#1C1820` | `#18151C` | `#211C26` | `#1D1922` |

**Two things you should know before reacting:**

1. **The existing seed near-black `#0f1115` computes to Cool's dark ground exactly.** It was always blue-leaning (hue 220°), so it belongs to Cool rather than Warm. Warm's dark ground becomes genuinely warm (`#141210`). Nothing was fudged to make this land — it fell out of the ladder.
2. **Warm's light ground moves from the seed `#f7f6f3` to `#F2EFEA`.** The seed sits at 96.1% lightness, which leaves no headroom for four tile steps above it in a mode where raised tiles must be *lighter* than the ground. Dropping the ground to 93.5% is what makes the ladder expressible. If you would rather keep `#f7f6f3` exactly, the alternative is compressing the four steps into ~3.5 points of lightness, which will read as flat on a phone at arm's length.

In dark mode the five grounds are near-identical by design — Night Depth wants a near-black ground, and at 7% lightness hue is barely perceptible. **The mood reads through the bands, not the ground.** If you want moods to be obvious in dark mode, say so and I will raise the ground to ~10% and widen the ladder, at the cost of the "near-black" character.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/scroll.ts` | pure position/snap/physics maths (no DOM) | 1 |
| `src/categories.ts` | `MOODS` filled; `themeCss` emits band tokens | 2 |
| `src/style.css` | Night Depth tokens, grid, tiles, bars, chips, header | 3 |
| `src/motion.css` | motion tokens, enter/exit utility, reduced-motion | 3 |
| `src/render.ts` | `packLanes` (pure) | 4 |
| `src/render.ts` | `renderWeek` — cells, bands, badges, bars, chips, "+N" | 5 |
| `src/render.ts` | `renderRange` — the header's month/year label + cross-fade | 6 |
| `src/scroll.ts` | `mount` — recycler, RAF, drag/wheel physics, touch | 7 |
| `src/main.ts` | wiring: mode, `fillRow`, `ensureMonthsFor`, `onCacheChange` | 8 |
| `src/year.ts` | grid, cells, bars, steppers, day click | 9 |
| `src/year.ts` | hover panel, touch flow | 10 |
| `scripts/shot.mjs` | headless-Chrome evidence harness | 11 |
| `03_engine/output/verification.md` | gate record | 12 |

---

### Task 1: `scroll.ts` — the pure maths

The whole stage rests on this, and it is the task that discharges `OPEN.md`'s variable-height-row risk with test evidence rather than a promise. No DOM at all in this task.

**Files:**
- Modify: `src/scroll.ts` (replace the stub; `mount` stays throwing until Task 7)
- Modify: `src/selftest.ts` (five cases)

**Interfaces:**
- Consumes: `asWeek`, `asDay`, `civilToDay`, `dayToCivil` from `dates.ts`.
- Produces: `Expanded`, `rowHeightFor`, `heightOf`, `posOf`, `weekAtY`, `snapTargetY`, `nearestAnchor`, `projectY`, `settleMs`, `easeOutCubic`, and the tuned constants. Task 7's `mount` consumes all of them; Task 8 calls `nearestAnchor` for the Today button.

- [ ] **Step 1: Write the five failing tests**

Append to the `cases` array in `src/selftest.ts` (at the END — later tasks depend on the anchor-restore discipline established in stage 02):

```ts
  ['scroll: row height clamps and excludes the header', () => {
    // 6.5 rows fill the area BELOW the sticky header, or "6.5 weeks fill the
    // viewport" is false by exactly one header.
    if (rowHeightFor(844, 56) !== (844 - 56) / 6.5) return `phone: ${rowHeightFor(844, 56)}`
    if (rowHeightFor(400, 56) !== 74) return `short viewport did not clamp to MIN_ROW_H: ${rowHeightFor(400, 56)}`
    if (rowHeightFor(4000, 56) !== 190) return `tall viewport did not clamp to MAX_ROW_H: ${rowHeightFor(4000, 56)}`
    if (rowHeightFor(900, 56) <= 74 || rowHeightFor(900, 56) >= 190) return 'desktop should sit inside the clamps'
    return null
  }],

  ['scroll: posOf/heightOf/weekAtY round-trip, uniform and expanded', () => {
    const H = 120
    for (const ex of [null, { week: asWeek(3), delta: 260 }] as Expanded[]) {
      for (let w = -5; w <= 10; w++) {
        const week = asWeek(w)
        const y = posOf(week, H, ex)
        if (weekAtY(y, H, ex) !== w) return `${ex ? 'expanded' : 'uniform'}: week ${w} -> y ${y} -> ${weekAtY(y, H, ex)}`
        // every point inside a row maps back to that row
        const mid = y + heightOf(week, H, ex) / 2
        if (weekAtY(mid, H, ex) !== w) return `${ex ? 'expanded' : 'uniform'}: midpoint of week ${w} -> ${weekAtY(mid, H, ex)}`
      }
    }
    const ex: Expanded = { week: asWeek(3), delta: 260 }
    if (heightOf(asWeek(3), H, ex) !== H + 260) return 'the expanded row did not grow'
    if (heightOf(asWeek(2), H, ex) !== H) return 'a row above the expanded one changed height'
    if (heightOf(asWeek(4), H, ex) !== H) return 'a row below the expanded one changed height'
    if (posOf(asWeek(2), H, ex) !== posOf(asWeek(2), H, null)) return 'a row ABOVE the expanded one moved'
    if (posOf(asWeek(4), H, ex) !== posOf(asWeek(4), H, null) + 260) return 'a row below did not shift by exactly delta'
    // delta 0 must be indistinguishable from no expansion — this is what stage 03 ships with
    for (let w = -3; w <= 6; w++) {
      if (posOf(asWeek(w), H, { week: asWeek(3), delta: 0 }) !== posOf(asWeek(w), H, null)) return `delta 0 differed at week ${w}`
    }
    return null
  }],

  ['scroll: anchor sequence and the 15/30/45 modulus', () => {
    const d = (y: number, m: number, day: number) => civilToDay(y, m, day)
    const show = (n: DayNumber) => { const c = dayToCivil(n); return `${c.y}-${c.m}-${c.d}` }
    // modulus 1 (setting 15): every anchor — the 1st and the 16th
    if (nearestAnchor(d(2026, 3, 10), 1, 1) !== d(2026, 3, 16)) return `15 next from Mar 10: ${show(nearestAnchor(d(2026, 3, 10), 1, 1))}`
    if (nearestAnchor(d(2026, 3, 20), 1, 1) !== d(2026, 4, 1)) return `15 next from Mar 20: ${show(nearestAnchor(d(2026, 3, 20), 1, 1))}`
    if (nearestAnchor(d(2026, 3, 10), 1, -1) !== d(2026, 3, 1)) return `15 prev from Mar 10: ${show(nearestAnchor(d(2026, 3, 10), 1, -1))}`
    // modulus 2 (setting 30): the 1st of each month only
    if (nearestAnchor(d(2026, 3, 10), 2, 1) !== d(2026, 4, 1)) return `30 next from Mar 10: ${show(nearestAnchor(d(2026, 3, 10), 2, 1))}`
    if (nearestAnchor(d(2026, 3, 20), 2, -1) !== d(2026, 3, 1)) return `30 prev from Mar 20: ${show(nearestAnchor(d(2026, 3, 20), 2, -1))}`
    // modulus 3 (setting 45): every third anchor — 1.5 months apart
    const a = nearestAnchor(d(2026, 1, 5), 3, 1)
    const b = nearestAnchor(a, 3, 1)
    const c = nearestAnchor(b, 3, 1)
    const gaps = [show(a), show(b), show(c)].join(' ')
    if (gaps !== '2026-1-16 2026-3-1 2026-4-16') return `45 sequence: ${gaps}`
    // year boundary
    if (nearestAnchor(d(2026, 12, 20), 2, 1) !== d(2027, 1, 1)) return `year roll: ${show(nearestAnchor(d(2026, 12, 20), 2, 1))}`
    if (nearestAnchor(d(2027, 1, 5), 2, -1) !== d(2027, 1, 1)) return `back over year roll: ${show(nearestAnchor(d(2027, 1, 5), 2, -1))}`
    // dir 0 picks the closer side
    if (nearestAnchor(d(2026, 3, 3), 2, 0) !== d(2026, 3, 1)) return `nearest from Mar 3: ${show(nearestAnchor(d(2026, 3, 3), 2, 0))}`
    if (nearestAnchor(d(2026, 3, 28), 2, 0) !== d(2026, 4, 1)) return `nearest from Mar 28: ${show(nearestAnchor(d(2026, 3, 28), 2, 0))}`
    // every returned anchor is a 1st or a 16th, never a rolling day count
    for (const m of [1, 2, 3] as const) {
      for (let k = 0; k < 12; k++) {
        const day = dayToCivil(nearestAnchor(d(2026, 1, 1 + k * 29), m, 1)).d
        if (day !== 1 && day !== 16) return `modulus ${m} returned day-of-month ${day}`
      }
    }
    return null
  }],

  ['scroll: snap target puts the anchor row top at viewport centre', () => {
    const H = 120, VP = 780
    const t = snapTargetY(asWeek(4), H, null, VP)
    // Scrolled to t, the top edge of week 4 sits at exactly SNAP_ALIGN of the viewport.
    if (posOf(asWeek(4), H, null) - t !== VP * 0.5) return `anchor row top landed at ${posOf(asWeek(4), H, null) - t}, want ${VP * 0.5}`
    // With a row expanded above it, the target shifts by exactly delta and the
    // anchor still lands dead centre.
    const ex: Expanded = { week: asWeek(1), delta: 300 }
    const t2 = snapTargetY(asWeek(4), H, ex, VP)
    if (t2 - t !== 300) return `expanded row above did not shift the target by delta: ${t2 - t}`
    if (posOf(asWeek(4), H, ex) - t2 !== VP * 0.5) return 'anchor did not stay centred with a row expanded above'
    return null
  }],

  ['scroll: projection, settle duration and easing', () => {
    // velocity is px/ms; projection looks PROJECT_MS ahead
    if (projectY(1000, 0) !== 1000) return 'zero velocity moved the projection'
    if (projectY(1000, 2) !== 1000 + 2 * 300) return `projectY: ${projectY(1000, 2)}`
    if (projectY(1000, -2) !== 1000 - 2 * 300) return `negative projectY: ${projectY(1000, -2)}`
    // settle: base at zero distance, grows per week, capped
    if (settleMs(0, 120) !== 280) return `settle at rest: ${settleMs(0, 120)}`
    if (settleMs(120, 120) !== 280 + 42) return `settle one row: ${settleMs(120, 120)}`
    if (settleMs(120 * 100, 120) !== 760) return `settle did not cap: ${settleMs(120 * 100, 120)}`
    if (settleMs(-120, 120) !== 280 + 42) return 'settle ignored direction'
    // easing: anchored, monotonic, and decelerating (it must not hard-stop)
    if (easeOutCubic(0) !== 0 || easeOutCubic(1) !== 1) return 'easing is not anchored at 0 and 1'
    let prev = -1
    for (let i = 0; i <= 20; i++) {
      const v = easeOutCubic(i / 20)
      if (v < prev) return 'easing is not monotonic'
      prev = v
    }
    if (!(easeOutCubic(0.5) > 0.5)) return 'easeOutCubic must be above the diagonal (decelerating)'
    return null
  }],
```

Add to the imports at the top of `src/selftest.ts`:

```ts
import {
  easeOutCubic, heightOf, nearestAnchor, posOf, projectY, rowHeightFor,
  settleMs, snapTargetY, weekAtY,
} from './scroll.ts'
import type { Expanded } from './scroll.ts'
```

`DayNumber` is already in the type-only import from `./types.ts`; add `asWeek`, `civilToDay` and `dayToCivil` to the existing `./dates.ts` import if they are not already there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run selftest`
Expected: the run fails at module load with a `SyntaxError` naming the missing exports — `src/scroll.ts` currently exports only `mount`. That is a genuine red state; it becomes per-case failures once Step 3 lands.

- [ ] **Step 3: Implement the pure maths**

Replace `src/scroll.ts` with:

```ts
// STAGE 03 — virtualizer, snap physics, the one variable-height row.
// Imports types.ts and dates.ts ONLY. No DOM at module scope; mount() touches
// the DOM inside functions so the node selftest can import the maths below.
import type { DayNumber, WeekIndex } from './types.ts'
import { asWeek, civilToDay, dayToCivil } from './dates.ts'

// ---------- Tuned constants (SPEC "Perpetual scroll mechanics") ----------
// Motion carve-out: these drive per-frame arithmetic, not CSS transitions, so
// they live here rather than in motion.css. See SPEC "Motion".

export const VISIBLE_WEEKS = 6.5
export const MIN_ROW_H = 74
export const MAX_ROW_H = 190
export const SNAP_ALIGN = 0.5
export const PROJECT_MS = 300
export const SETTLE_BASE_MS = 280
export const SETTLE_PER_WEEK_MS = 42
export const SETTLE_MAX_MS = 760
export const WHEEL_GAIN = 0.6
export const WHEEL_IDLE_MS = 140
export const HAPTIC_ON_SNAP = false
/** Recycled row nodes. A taller expanded row means FEWER rows visible, never more. */
export const POOL_SIZE = 14

/** The one variable-height row. Stage 03 always passes null; stage 04 sets it. */
export type Expanded = { week: WeekIndex; delta: number } | null

// ---------- Geometry ----------

/** 6.5 rows fill the area BELOW the sticky header. */
export function rowHeightFor(viewportH: number, headerH: number): number {
  return Math.min(MAX_ROW_H, Math.max(MIN_ROW_H, (viewportH - headerH) / VISIBLE_WEEKS))
}

export function heightOf(w: WeekIndex, rowH: number, ex: Expanded): number {
  return ex !== null && w === ex.week ? rowH + ex.delta : rowH
}

/** The ONLY place a week becomes a y. Never write `w * rowH` anywhere else. */
export function posOf(w: WeekIndex, rowH: number, ex: Expanded): number {
  return w * rowH + (ex !== null && w > ex.week ? ex.delta : 0)
}

/** Inverse of posOf. O(1): three branches, no cumulative scan, no layout read. */
export function weekAtY(y: number, rowH: number, ex: Expanded): WeekIndex {
  if (ex === null) return asWeek(Math.floor(y / rowH))
  const top = ex.week * rowH
  if (y < top) return asWeek(Math.floor(y / rowH))
  if (y < top + rowH + ex.delta) return ex.week
  return asWeek(Math.floor((y - ex.delta) / rowH))
}

/** Scroll offset that puts the top edge of `anchorWeek` at SNAP_ALIGN of the viewport. */
export function snapTargetY(anchorWeek: WeekIndex, rowH: number, ex: Expanded, viewportH: number): number {
  return posOf(anchorWeek, rowH, ex) - viewportH * SNAP_ALIGN
}

// ---------- Anchors ----------
// Anchors are REAL DATES — the 1st and the 16th — never a rolling day count,
// which drifts ~5 days/year against the calendar (DECISIONS).

function anchorIndexOf(y: number, m: number, d: number): number {
  return (y * 12 + (m - 1)) * 2 + (d >= 16 ? 1 : 0)
}

function anchorDayOf(n: number): DayNumber {
  const half = ((n % 2) + 2) % 2
  const monthIdx = (n - half) / 2
  const y = Math.floor(monthIdx / 12)
  const m = monthIdx - y * 12 + 1
  return civilToDay(y, m, half === 1 ? 16 : 1)
}

/** 15/30/45 is a modulus over the anchor SEQUENCE: 1 = every anchor, 2 = the
 *  1st of each month, 3 = every 1.5 months. Bounded — modulus is at most 3. */
export function nearestAnchor(day: DayNumber, modulus: number, dir: -1 | 0 | 1): DayNumber {
  const { y, m, d } = dayToCivil(day)
  const n0 = anchorIndexOf(y, m, d)
  const enabled = (n: number) => (((n % modulus) + modulus) % modulus) === 0
  if (dir > 0) {
    for (let n = n0; ; n++) if (enabled(n) && anchorDayOf(n) > day) return anchorDayOf(n)
  }
  if (dir < 0) {
    for (let n = n0; ; n--) if (enabled(n) && anchorDayOf(n) < day) return anchorDayOf(n)
  }
  let lo = n0
  while (!enabled(lo)) lo--
  let hi = n0
  while (!enabled(hi)) hi++
  const a = anchorDayOf(lo), b = anchorDayOf(hi)
  return day - a <= b - day ? a : b
}

// ---------- Physics ----------

/** velocity is px/ms, smoothed 0.7/0.3 by the caller. */
export function projectY(y: number, velocity: number): number {
  return y + velocity * PROJECT_MS
}

export function settleMs(distancePx: number, rowH: number): number {
  const weeks = Math.abs(distancePx) / rowH
  return Math.min(SETTLE_MAX_MS, SETTLE_BASE_MS + SETTLE_PER_WEEK_MS * weeks)
}

/** Momentum settles into the detent softly; it does not hard-stop. */
export function easeOutCubic(t: number): number {
  const u = 1 - t
  return 1 - u * u * u
}

export function mount(_root: HTMLElement): void { throw new Error('STAGE 03: not implemented') }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run selftest`
Expected: `47/47` (42 from stage 02 plus these five).

Run: `npx tsc --noEmit && echo TSC_CLEAN`
Expected: `TSC_CLEAN`.

- [ ] **Step 5: Prove the expanded case is non-vacuous**

Temporarily change `posOf`'s `w > ex.week` to `w >= ex.week` and re-run.
Expected: FAIL on `scroll: posOf/heightOf/weekAtY round-trip` — the round-trip breaks at the expanded row. **Restore the line** and confirm `47/47` again. Record both outputs in your report; this is the evidence that stage 04's variable-height row is real rather than asserted.

- [ ] **Step 6: Commit**

```bash
git add src/scroll.ts src/selftest.ts
git commit -m "stage 03: pure scroll maths, variable-height row proven under node"
```

---

### Task 2: `categories.ts` — the mood palette

This task writes the swatch table above and nothing else, so a rejected palette costs exactly one task.

**Files:**
- Modify: `src/categories.ts` (`MOODS`, `MoodTokens`, `themeCss`)
- Modify: `src/selftest.ts` (one new case; **one existing case must be inverted** — see Step 1)

**Interfaces:**
- Consumes: `brighten`, `GOOGLE_HEX`, `TWINS`, `cats` — all present from stage 02.
- Produces: `themeCss(mood)` now emitting `--surface` plus `--band-a`, `--band-a-end`, `--band-b`, `--band-b-end` in both schemes. Task 3's `style.css` consumes those four names exactly.

- [ ] **Step 1: Invert the stale assertion, then write the new test**

The stage-02 case `'categories: themeCss emits both schemes and data-cat rules'` currently asserts that **every mood equals warm**, which was correct while `MOODS` held warm alone. That assertion is now backwards. Find this block and replace it:

```ts
    // Mood values are stage 03: every id resolves to warm for now, and none of them throws.
    for (const m of ['warm', 'paper', 'cool', 'sage', 'dusk'] as MoodId[]) {
      if (themeCss(m) !== css) return `mood ${m} differs from warm before stage 03 fills MOODS`
    }
```

with:

```ts
    // Stage 03 fills MOODS: every id must now produce its OWN palette.
    const seen = new Set<string>()
    for (const m of ['warm', 'paper', 'cool', 'sage', 'dusk'] as MoodId[]) {
      const out = themeCss(m)
      if (m !== 'warm' && out === css) return `mood ${m} is still identical to warm`
      seen.add(out)
    }
    if (seen.size !== 5) return `five moods produced ${seen.size} distinct stylesheets`
```

Then append the new case at the END of `cases`:

```ts
  ['categories: the mood ladder holds in both schemes', () => {
    const lightness = (hex: string) => {
      const n = parseInt(hex.slice(1), 16)
      const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
      return (Math.max(r, g, b) + Math.min(r, g, b)) / 2
    }
    const grab = (css: string, scheme: 'light' | 'dark', token: string): string => {
      // the dark block is everything after the media query opener
      const idx = css.indexOf('@media (prefers-color-scheme: dark)')
      const hay = scheme === 'light' ? css.slice(0, idx) : css.slice(idx)
      const m = new RegExp(`--${token}:\\s*(#[0-9A-Fa-f]{6})`).exec(hay)
      return m?.[1] ?? ''
    }
    configure({})
    for (const mood of ['warm', 'paper', 'cool', 'sage', 'dusk'] as MoodId[]) {
      const css = themeCss(mood)
      for (const scheme of ['light', 'dark'] as const) {
        const rung = ['surface', 'band-a-end', 'band-a', 'band-b-end', 'band-b']
          .map(t => ({ t, hex: grab(css, scheme, t) }))
        for (const { t, hex } of rung) {
          if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return `${mood}/${scheme}: --${t} missing or malformed (${hex || 'absent'})`
        }
        // The ladder: ground darkest, then weekend-a, a, weekend-b, b. Identical
        // ordering in both schemes — light inverts the SURFACE logic, not the ladder.
        for (let i = 1; i < rung.length; i++) {
          const lo = rung[i - 1]!, hi = rung[i]!
          if (!(lightness(hi.hex) > lightness(lo.hex))) {
            return `${mood}/${scheme}: --${hi.t} (${hi.hex}) is not lighter than --${lo.t} (${lo.hex})`
          }
        }
        // A weekend sits UNDER its own band, not beside it.
        const byToken = Object.fromEntries(rung.map(r => [r.t, r.hex]))
        if (!(lightness(byToken['band-a-end']!) < lightness(byToken['band-a']!))) return `${mood}/${scheme}: weekend a is not under band a`
        if (!(lightness(byToken['band-b-end']!) < lightness(byToken['band-b']!))) return `${mood}/${scheme}: weekend b is not under band b`
      }
    }
    // The seed near-black belongs to Cool, not Warm — it was always hue 220.
    if (grab(themeCss('cool'), 'dark', 'surface').toUpperCase() !== '#0F1115') return 'cool/dark ground is no longer the seed near-black'
    return null
  }],
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run selftest`
Expected: two failures — the inverted case (`mood paper is still identical to warm`) and the new ladder case (band tokens absent). Total `45/47`.

- [ ] **Step 3: Fill `MOODS` and emit the bands**

In `src/categories.ts`, replace the `MoodTokens` type and the `MOODS` table with:

```ts
type Bands = {
  surface: string
  bandA: string
  bandAEnd: string
  bandB: string
  bandBEnd: string
}
type MoodTokens = { light: Bands; dark: Bands }

/** The ladder is fixed; a mood shifts hue and saturation only (SPEC "Visual
 *  direction"). Lightness relative to the ground: band-a-end +2.5, band-a +4,
 *  band-b-end +4.5, band-b +6. Month parity is the a/b pair; weekend sits
 *  under its own band. Dark grounds are near-identical by design — Night Depth
 *  wants a near-black ground and the mood reads through the bands. */
const MOODS: Record<MoodId, MoodTokens> = {
  warm: {
    light: { surface: '#F2EFEA', bandA: '#FAF9F7', bandAEnd: '#F7F5F2', bandB: '#FEFEFD', bandBEnd: '#FBFAF9' },
    dark:  { surface: '#141210', bandA: '#1F1C19', bandAEnd: '#1B1816', bandB: '#25211E', bandBEnd: '#211D1A' },
  },
  paper: {
    light: { surface: '#F4F1E9', bandA: '#FBFAF6', bandAEnd: '#F8F7F1', bandB: '#FEFEFD', bandBEnd: '#FCFBF8' },
    dark:  { surface: '#131210', bandA: '#1F1D1A', bandAEnd: '#1A1916', bandB: '#24221E', bandBEnd: '#201E1B' },
  },
  cool: {
    // The stage-01 seed near-black #0f1115 is hue 220 and lands here exactly.
    light: { surface: '#EBEEF2', bandA: '#F7F9FA', bandAEnd: '#F3F5F7', bandB: '#FDFEFE', bandBEnd: '#F9FAFB' },
    dark:  { surface: '#0F1115', bandA: '#181B21', bandAEnd: '#14171C', bandB: '#1C1F26', bandBEnd: '#191C22' },
  },
  sage: {
    light: { surface: '#ECF1EC', bandA: '#F8FAF8', bandAEnd: '#F3F6F4', bandB: '#FEFEFE', bandBEnd: '#F9FBF9' },
    dark:  { surface: '#101411', bandA: '#191F1B', bandAEnd: '#151B18', bandB: '#1D2520', bandBEnd: '#1A211D' },
  },
  dusk: {
    light: { surface: '#EFECF1', bandA: '#F9F8FA', bandAEnd: '#F5F3F6', bandB: '#FEFEFE', bandBEnd: '#FAF9FB' },
    dark:  { surface: '#120F15', bandA: '#1C1820', bandAEnd: '#18151C', bandB: '#211C26', bandBEnd: '#1D1922' },
  },
}
```

and replace `themeCss` with:

```ts
function bandVars(b: Bands, indent: string): string {
  return [
    `${indent}--surface: ${b.surface};`,
    `${indent}--band-a: ${b.bandA};`,
    `${indent}--band-a-end: ${b.bandAEnd};`,
    `${indent}--band-b: ${b.bandB};`,
    `${indent}--band-b-end: ${b.bandBEnd};`,
  ].join('\n')
}

/** [data-cat] rules, --cat-<name> properties, mood tokens. main.ts owns the <style>. */
export function themeCss(mood: MoodId): string {
  const tokens = MOODS[mood]
  const light = cats.map(c => `  --cat-${c.name}: ${lightOf(c)};`).join('\n')
  const dark = cats.map(c => `    --cat-${c.name}: ${darkOf(c)};`).join('\n')
  const rules = cats.map(c => `[data-cat="${c.name}"] { --cat: var(--cat-${c.name}); }`).join('\n')
  return [
    `:root {`,
    bandVars(tokens.light, '  '),
    light,
    `}`,
    `@media (prefers-color-scheme: dark) {`,
    `  :root {`,
    bandVars(tokens.dark, '    '),
    dark,
    `  }`,
    `}`,
    rules,
    ``,
  ].join('\n')
}
```

`MOODS` is now a full `Record`, so the `MOODS.warm!` non-null assertion goes away — delete it rather than leaving a dead assertion.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run selftest`
Expected: `48/48`.

Run: `npx tsc --noEmit && echo TSC_CLEAN`
Expected: `TSC_CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add src/categories.ts src/selftest.ts
git commit -m "stage 03: the five-mood palette, ladder asserted in both schemes"
```

---

### Task 3: `style.css` and `motion.css` — Night Depth

**Files:**
- Modify: `src/style.css` (currently a one-line placeholder)
- Modify: `src/motion.css` (currently a one-line placeholder)
- Modify: `index.html` (replace the stage-01 seed `:root` block)

**Interfaces:**
- Consumes: `--surface`, `--band-a`, `--band-a-end`, `--band-b`, `--band-b-end`, `--cat-*`, `--cat` from Task 2's `themeCss`.
- Produces: the class and data-attribute contract Tasks 5, 6, 9 and 10 render against: `.week`, `.day[data-band][data-weekend][data-today][data-out]`, `.daynum`, `.badge`, `.more`, `.bars`, `.bar[data-cat]`, `.chip[data-cat]`, `.hdr`, `.yr`, `.yrcell`, `.yrpanel`.

**Non-mood colour tokens — the second thing for your reaction.** SPEC forbids moods from touching these, so they are fixed per scheme:

| token | light | dark | role |
|---|---|---|---|
| `--ink` | `#1A1A1A` | `#E8E6E1` | day numbers, titles |
| `--ink-dim` | `#6B6B6B` | `#9A978F` | weekday letters, times, "+N" |
| `--rule` | `rgba(0,0,0,.08)` | `rgba(255,255,255,.09)` | month boundary rule |
| `--today` | `#0D9488` | `#2DD4BF` | the one reserved hue |

`--today` is teal deliberately: it must not collide with the four seed category hues (blue-indigo, green, amber, grey), and SPEC says today is distinguished by **form** — an inset ring plus an accent number — precisely so a red category can never read as today.

- [ ] **Step 1: Replace `index.html`'s seed `:root` block**

Stage-01 ruling 4 called those values placeholders for this stage. Replace the whole `<style>` block in `index.html` with the minimum needed before `themeCss` lands, so there is no flash of unstyled ground:

```html
    <style>
      /* Pre-paint only: themeCss() replaces every one of these at boot. */
      :root { --surface: #F2EFEA; --ink: #1A1A1A; color-scheme: light dark; }
      @media (prefers-color-scheme: dark) {
        :root { --surface: #141210; --ink: #E8E6E1; }
      }
      html, body { margin: 0; background: var(--surface); color: var(--ink); }
    </style>
```

- [ ] **Step 2: Write `src/motion.css`**

```css
/* Motion tokens, elevation scale, enter/exit utility, reduced-motion.
   No transition or animation value may appear outside this file — except the
   scroll engine's per-frame physics constants, which live at the top of
   scroll.ts because they drive rAF arithmetic, not CSS (SPEC "Motion"). */
:root {
  --t-fast: 140ms;
  --t-base: 240ms;
  --t-open: 380ms;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* Exactly three elevation levels. Nothing else casts a shadow. */
  --el-rest: 0 1px 2px rgba(0, 0, 0, .06);
  --el-hover: 0 4px 12px rgba(0, 0, 0, .12);
  --el-open: 0 12px 32px rgba(0, 0, 0, .20);
}
@media (prefers-color-scheme: dark) {
  :root {
    --el-rest: 0 1px 2px rgba(0, 0, 0, .40);
    --el-hover: 0 4px 14px rgba(0, 0, 0, .55);
    --el-open: 0 14px 36px rgba(0, 0, 0, .65);
  }
}

/* One shared enter/exit utility, so components never write their own. */
.enter { opacity: 0; transform: translateY(6px); }
.enter[data-in] {
  opacity: 1; transform: none;
  transition: opacity var(--t-base) var(--ease-out), transform var(--t-base) var(--ease-out);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 80ms !important;
    transition-property: opacity !important;
    animation-duration: 80ms !important;
  }
}
```

- [ ] **Step 3: Write `src/style.css`**

```css
/* Token consumption only. Colour values live in categories.themeCss();
   motion values live in motion.css. */
:root {
  --ink: #1A1A1A;
  --ink-dim: #6B6B6B;
  --rule: rgba(0, 0, 0, .08);
  --today: #0D9488;
  --tile-r: 12px;
  --bar-r: 5px;
  --gap: 3px;
  --hdr-h: 56px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #E8E6E1;
    --ink-dim: #9A978F;
    --rule: rgba(255, 255, 255, .09);
    --today: #2DD4BF;
  }
}

html, body {
  margin: 0; height: 100%;
  background: var(--surface); color: var(--ink);
  font: 14px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
  touch-action: manipulation;              /* SPEC: not user-scalable=no */
  overscroll-behavior: none;
}

/* ---------- shell ---------- */
#app { height: 100%; display: flex; flex-direction: column; }

.hdr {
  height: var(--hdr-h); flex: none;
  display: flex; align-items: center; gap: 12px; padding: 0 12px;
  position: sticky; top: 0; z-index: 3;
  background: var(--surface);
}
.hdr-range { font-weight: 620; font-size: 15px; }
.hdr-spacer { flex: 1; }
.hdr button { font: inherit; color: var(--ink); background: none; border: 0; padding: 6px 10px; border-radius: 8px; }
.hdr button[aria-pressed="true"] { background: var(--band-b); }
/* Stage 05 fills this; reserved so the header is not restructured later. */
.hdr-avatar { width: 28px; height: 28px; border-radius: 50%; background: var(--band-b); }

.scroller { position: relative; flex: 1; overflow: hidden; touch-action: none; }

/* ---------- week rows ---------- */
.week {
  position: absolute; left: 0; right: 0; top: 0;
  display: grid; grid-template-columns: repeat(7, 1fr); gap: var(--gap);
  padding: 0 var(--gap);
  will-change: transform;
  touch-action: none;
}

.day {
  position: relative; border-radius: var(--tile-r);
  background: var(--band-a); box-shadow: var(--el-rest);
  padding: 4px 6px; min-width: 0; overflow: hidden;
}
.day[data-band="b"] { background: var(--band-b); }
.day[data-weekend][data-band="a"] { background: var(--band-a-end); }
.day[data-weekend][data-band="b"] { background: var(--band-b-end); }
.day[data-out] { opacity: .62; }

/* Hover: compositor properties only. Never scale a row (DECISIONS "Rejected"). */
@media (hover: hover) {
  .day:hover {
    transform: translateY(-2px); box-shadow: var(--el-hover);
    transition: transform var(--t-fast) var(--ease-out), box-shadow var(--t-fast) var(--ease-out);
  }
  .day:not(:hover) { transition: transform var(--t-base) var(--ease-out), box-shadow var(--t-base) var(--ease-out); }
  .day:hover::after {
    content: ""; position: absolute; inset: 0; border-radius: inherit;
    box-shadow: inset 0 0 0 1px var(--today); opacity: .35; pointer-events: none;
  }
}

/* Today is distinguished by FORM: an inset ring plus an accent number. */
.day[data-today]::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit;
  box-shadow: inset 0 0 0 2px var(--today); pointer-events: none;
}
.day[data-today] .daynum { color: var(--today); font-weight: 700; }

.daynum { position: absolute; top: 3px; right: 6px; font-size: 12px; font-variant-numeric: tabular-nums; }
.badge { position: absolute; top: 3px; left: 6px; font-size: 11px; color: var(--ink-dim); letter-spacing: .02em; }
.more { position: absolute; bottom: 3px; left: 6px; font-size: 11px; color: var(--ink-dim); }

/* The month boundary: a thin rule from the 1st to the end of that row. */
.week .rule {
  position: absolute; top: 0; height: 1px; background: var(--rule);
  pointer-events: none;
}

/* ---------- bars ---------- */
/* A bar layer over the 7 columns, so a multi-day run crosses the tile gaps
   as one object rather than reading as separate stubs (DECISIONS). */
.bars {
  position: absolute; inset: 0; padding: 0 var(--gap);
  display: grid; grid-template-columns: repeat(7, 1fr); gap: var(--gap);
  pointer-events: none;
}
.bar {
  grid-row: 1; align-self: start; min-width: 0;
  margin-top: calc(20px + var(--lane) * 20px);
  height: 18px; border-radius: var(--bar-r);
  background: color-mix(in srgb, var(--cat) 16%, transparent);
  border-left: 3px solid var(--cat);
  color: var(--cat);
  font-size: 12px; line-height: 18px; padding: 0 6px;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
/* Continuations keep a flat edge on the broken side and drop the spine. */
.bar[data-cont-before] { border-left: 0; border-top-left-radius: 0; border-bottom-left-radius: 0; }
.bar[data-cont-after] { border-top-right-radius: 0; border-bottom-right-radius: 0; }

/* ---------- timed chips ---------- */
.chip { display: flex; align-items: center; gap: 4px; font-size: 12px; min-width: 0; }
.chip .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--cat); flex: none; }
.chip .at { color: var(--ink-dim); font-variant-numeric: tabular-nums; flex: none; }
.chip .ttl { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.chips { position: absolute; left: 6px; right: 6px; bottom: 16px; display: flex; flex-direction: column; gap: 2px; }

/* Any selector that sets display must re-assert [hidden] (CONVENTIONS). */
[hidden] { display: none !important; }
```

- [ ] **Step 4: Confirm the build is clean and no motion literal escaped**

Run: `npx tsc --noEmit && npm run build && echo BUILD_OK`
Expected: `BUILD_OK`.

Run the motion-literal check — every CSS transition/animation value must be a token:

```bash
grep -nE 'transition[^;]*[0-9]+m?s|animation[^;]*[0-9]+m?s' src/style.css || echo "no motion literals in style.css (expected)"
```
Expected: `no motion literals in style.css (expected)`.

- [ ] **Step 5: Commit**

```bash
git add src/style.css src/motion.css index.html
git commit -m "stage 03: Night Depth tokens, tiles, bars, chips, motion scale"
```

---

### Task 4: `render.ts` — `packLanes`

**Files:**
- Modify: `src/render.ts` (add `packLanes`; `renderWeek` stays throwing until Task 5)
- Modify: `src/selftest.ts` (one case)

**Interfaces:**
- Consumes: `EventSpan`, `PackedSpan` from `types.ts` / `render.ts`.
- Produces: `packLanes(spans: EventSpan[]): PackedSpan[]`. Task 5 renders its output; Task 9 reuses it for the year view's 3-bar cap.

- [ ] **Step 1: Write the failing test**

Append to `cases` in `src/selftest.ts`:

```ts
  ['render: lane packing is longest-first, compact and deterministic', () => {
    const ev = (id: string, allDay: boolean) => ({
      id, title: id, category: 'work', allDay, start: asDay(0), end: asDay(0),
    } as unknown as CalendarEvent)   // why: only id/allDay/category are read by packLanes
    const span = (id: string, from: number, to: number, allDay = true): EventSpan => ({
      event: ev(id, allDay), week: asWeek(0),
      from: asOffset(from), to: asOffset(to), continuesBefore: false, continuesAfter: false,
    })
    // A long span must take lane 0 even though a short one starts earlier.
    const a = packLanes([span('short', 0, 0), span('long', 1, 6)])
    if (a.find(s => s.event.id === 'long')?.lane !== 0) return `longest-first violated: long got lane ${a.find(s => s.event.id === 'long')?.lane}`
    if (a.find(s => s.event.id === 'short')?.lane !== 1) return `short got lane ${a.find(s => s.event.id === 'short')?.lane}`
    // Non-overlapping spans of equal length share a lane.
    const b = packLanes([span('x', 0, 1), span('y', 3, 4)])
    if (b[0]?.lane !== 0 || b[1]?.lane !== 0) return `disjoint spans did not share a lane: ${b.map(s => s.lane).join(',')}`
    // Overlapping spans never share one.
    const c = packLanes([span('p', 0, 3), span('q', 2, 5)])
    if (c[0]?.lane === c[1]?.lane) return 'overlapping spans shared a lane'
    // Timed events are chips, never bars (DECISIONS "In force — scroll and render").
    const d = packLanes([span('bar', 0, 2, true), span('chip', 0, 2, false)])
    if (d.length !== 1 || d[0]?.event.id !== 'bar') return `timed event was packed as a bar: ${d.map(s => s.event.id).join(',')}`
    // Deterministic: input order must not change the result, or a repaint
    // reshuffles lanes under the user.
    const input = [span('m', 0, 2), span('n', 0, 2), span('o', 3, 6), span('p', 1, 1)]
    const once = packLanes(input).map(s => `${s.event.id}:${s.lane}`).sort().join(' ')
    const again = packLanes([...input].reverse()).map(s => `${s.event.id}:${s.lane}`).sort().join(' ')
    if (once !== again) return `not deterministic:\n  ${once}\n  ${again}`
    return null
  }],
```

Add `packLanes` to a new `./render.ts` import in `src/selftest.ts`, and `asOffset` to the `./dates.ts` import; `CalendarEvent` and `EventSpan` join the type-only import from `./types.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run selftest`
Expected: module-load failure naming the missing `packLanes` export.

- [ ] **Step 3: Implement**

In `src/render.ts`, above the `renderWeek` stub:

```ts
/** Longest-first first-fit. The id tie-break is load-bearing: without it a
 *  repaint can reshuffle lanes under the user. Bars are all-day only — timed
 *  events render as chips (DECISIONS "In force — scroll and render"). */
export function packLanes(spans: EventSpan[]): PackedSpan[] {
  const bars = spans.filter(s => s.event.allDay)
  bars.sort((a, b) =>
    (b.to - b.from) - (a.to - a.from) ||
    a.from - b.from ||
    (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0))
  const lastUsed: number[] = []   // lastUsed[lane] = rightmost offset occupied
  const out: PackedSpan[] = []
  for (const s of bars) {
    let lane = 0
    while (lane < lastUsed.length && (lastUsed[lane] ?? -1) >= s.from) lane++
    lastUsed[lane] = s.to
    out.push({ ...s, lane })
  }
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run selftest` → `49/49`. `npx tsc --noEmit` → `TSC_CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add src/render.ts src/selftest.ts
git commit -m "stage 03: deterministic longest-first lane packing"
```

---

### Task 5: `render.ts` — `renderWeek`

**Files:**
- Modify: `_references/SPEC.md` ("Scroll engine API" block — signature gains `rowH`)
- Modify: `src/render.ts`

**Interfaces:**
- Consumes: `packLanes` (Task 4); `dayAt`, `today` from `state.ts`; `dayToCivil`, `offsetOf` from `dates.ts`.
- Produces: `renderWeek(node, week, spans, rowH): void`. Task 7's `fillRow` calls it; Task 8 wires it.

- [ ] **Step 1: Amend SPEC first, then implement**

`renderWeek` needs the row height to decide how many bars and chips fit before "+N", and reading `node.clientHeight` would be a layout read inside the scroll handler — exactly the thrash SPEC forbids. The virtualizer already knows `rowH`, so it passes it. In `_references/SPEC.md`, change the line

```
render.renderWeek(node: HTMLElement, week: WeekIndex, spans: EventSpan[]): void
```
to
```
render.renderWeek(node: HTMLElement, week: WeekIndex, spans: EventSpan[], rowH: number): void
ScrollHost.fillRow(node, week, rowH)
```

- [ ] **Step 2: Implement `renderWeek`**

Replace the `renderWeek` stub in `src/render.ts`:

```ts
const WDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const BAR_H = 20        // must match --bar height + gap in style.css
const HEAD_H = 20       // day-number band at the top of a tile
const FOOT_H = 16       // the "+N" line

function capacityFor(rowH: number): number {
  return Math.max(0, Math.floor((rowH - HEAD_H - FOOT_H) / BAR_H))
}

/** Fills a RECYCLED node; never creates one. Sets data-cat and nothing else
 *  per frame — all colour comes from categories.themeCss(). */
export function renderWeek(node: HTMLElement, week: WeekIndex, spans: EventSpan[], rowH: number): void {
  const mon = dayAt(week, asOffset(0))
  const t = today()
  const cap = capacityFor(rowH)
  const packed = packLanes(spans)

  // Per-day counters collected DURING packing, not by a per-cell lookup
  // afterwards (~98 redundant scans per repaint otherwise — DECISIONS).
  const used: number[] = [0, 0, 0, 0, 0, 0, 0]
  for (const p of packed) for (let o = p.from; o <= p.to; o++) used[o] = (used[o] ?? 0) + 1
  const chips: EventSpan[][] = [[], [], [], [], [], [], []]
  for (const s of spans) if (!s.event.allDay) chips[s.from]!.push(s)
  for (const list of chips) list.sort((a, b) => (a.event.startMin ?? 0) - (b.event.startMin ?? 0))

  node.replaceChildren()
  let firstOfMonth = -1

  for (let o = 0; o < 7; o++) {
    const day = dayAt(week, asOffset(o))
    const { m, d } = dayToCivil(day)
    const cell = document.createElement('div')
    cell.className = 'day'
    cell.dataset['band'] = m % 2 === 0 ? 'a' : 'b'
    if (o >= 5) cell.dataset['weekend'] = ''
    if (day === t) cell.dataset['today'] = ''
    cell.dataset['day'] = String(day)

    const num = document.createElement('span')
    num.className = 'daynum'
    num.textContent = String(d)
    cell.append(num)

    if (d === 1) {
      firstOfMonth = o
      const badge = document.createElement('span')
      badge.className = 'badge'
      badge.textContent = new Date(Date.UTC(2000, m - 1, 1)).toLocaleString(undefined, { month: 'short', timeZone: 'UTC' })
      cell.append(badge)
    }

    const chipList = chips[o] ?? []
    const room = cap - (used[o] ?? 0)
    if (room > 0 && chipList.length > 0) {
      const box = document.createElement('div')
      box.className = 'chips'
      for (const s of chipList.slice(0, room)) {
        const chip = document.createElement('div')
        chip.className = 'chip'
        chip.dataset['cat'] = s.event.category
        const dot = document.createElement('span'); dot.className = 'dot'
        const at = document.createElement('span'); at.className = 'at'
        const min = s.event.startMin ?? 0
        at.textContent = `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
        const ttl = document.createElement('span'); ttl.className = 'ttl'
        ttl.textContent = s.event.title            // text nodes are not flex items (DECISIONS)
        chip.append(dot, at, ttl)
        box.append(chip)
      }
      cell.append(box)
    }

    const overflow = (used[o] ?? 0) + chipList.length - cap
    if (overflow > 0) {
      const more = document.createElement('span')
      more.className = 'more'
      more.textContent = `+${overflow}`
      cell.append(more)
    }
    node.append(cell)
  }

  const layer = document.createElement('div')
  layer.className = 'bars'
  for (const p of packed) {
    if (p.lane >= cap) continue          // counted in "+N" above
    const bar = document.createElement('div')
    bar.className = 'bar'
    bar.dataset['cat'] = p.event.category
    bar.style.gridColumn = `${p.from + 1} / ${p.to + 2}`
    bar.style.setProperty('--lane', String(p.lane))
    if (p.continuesBefore) bar.dataset['contBefore'] = ''
    if (p.continuesAfter) bar.dataset['contAfter'] = ''
    // Title once, on the true start; continuations carry none.
    if (!p.continuesBefore) bar.textContent = p.event.title
    layer.append(bar)
  }
  node.append(layer)

  if (firstOfMonth >= 0) {
    const rule = document.createElement('div')
    rule.className = 'rule'
    rule.style.left = `calc(${firstOfMonth} * (100% / 7))`
    rule.style.right = '0'
    node.append(rule)
  }
  void WDAY   // used by year.ts in Task 9
}
```

Add to `src/render.ts`'s imports: `import { dayAt, today } from './state.ts'` and `import { asOffset, dayToCivil } from './dates.ts'`. Keep browser globals inside functions only — `document` appears solely inside `renderWeek`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run selftest && npm run build`
Expected: `TSC_CLEAN`, `49/49`, build OK. No new selftest case — `renderWeek` is DOM and is covered by Task 11's headless evidence.

- [ ] **Step 4: Commit**

```bash
git add src/render.ts _references/SPEC.md
git commit -m "stage 03: week rows — tiles, bands, badges, bars, chips, +N"
```

---

### Task 6: `render.ts` — `renderRange`

**Files:** Modify `src/render.ts`.

**Interfaces:**
- Consumes: `dayAt` from `state.ts`, `dayToCivil` from `dates.ts`.
- Produces: `renderRange(node, firstWeek, lastWeek): void`. Task 8 calls it on every dock.

- [ ] **Step 1: Amend SPEC first**

SPEC's "Scroll engine API" block currently says `render.renderHeader(node: HTMLElement, weeks: WeekIndex[]): void`. Only the label's text changes per dock — the buttons are built once by `main.ts` — so the function is narrower than that name suggests. Change the line to:

```
render.renderRange(node: HTMLElement, firstWeek: WeekIndex, lastWeek: WeekIndex): void
```

- [ ] **Step 2: Implement**

```ts
/** "Aug – Sep 2026" when the view straddles, which at rest it does (DECISIONS).
 *  Only the label's text changes per dock; the buttons are built once by main.ts. */
export function renderRange(node: HTMLElement, firstWeek: WeekIndex, lastWeek: WeekIndex): void {
  const a = dayToCivil(dayAt(firstWeek, asOffset(0)))
  const b = dayToCivil(dayAt(lastWeek, asOffset(6)))
  const name = (m: number) => new Date(Date.UTC(2000, m - 1, 1)).toLocaleString(undefined, { month: 'short', timeZone: 'UTC' })
  const next = a.y === b.y
    ? (a.m === b.m ? `${name(a.m)} ${a.y}` : `${name(a.m)} – ${name(b.m)} ${a.y}`)
    : `${name(a.m)} ${a.y} – ${name(b.m)} ${b.y}`
  if (node.textContent === next) return          // no cross-fade when nothing changed
  node.dataset['in'] = ''
  node.textContent = next
  // The enter/exit utility owns the fade; components never write transitions.
  node.classList.remove('enter')
  void node.offsetWidth                          // restart the transition
  node.classList.add('enter')
  node.dataset['in'] = ''
}
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit && npm run selftest && npm run build`
Expected: `TSC_CLEAN`, `49/49`, build OK.

```bash
git add src/render.ts _references/SPEC.md
git commit -m "stage 03: header range label with cross-fade"
```

---

### Task 7: `scroll.ts` — the virtualizer

The largest task. It touches the DOM only inside `mount`, so the pure maths stay node-importable.

**Files:**
- Modify: `_references/SPEC.md` (`ScrollHost` gains `mondayOf`/`weekOf`)
- Modify: `src/scroll.ts`

**Interfaces:**
- Consumes: every export from Task 1.
- Produces: `ScrollHost`, `ScrollController`, `mount(root, host): ScrollController`. Task 8 wires it.

- [ ] **Step 1: Amend SPEC first**

`scroll.ts` may import `types.ts` and `dates.ts` only, but snapping needs week↔day conversion, which is anchored maths owned by `state.ts`. The host supplies it rather than the boundary being broken. In `_references/SPEC.md` change:

```
ScrollHost      = { fillRow(node, week), onDock(week, day), onRangeChange(weeks) }
```
to
```
ScrollHost      = { fillRow(node, week, rowH), mondayOf(week), weekOf(day),
                    onDock(week), onRangeChange(firstWeek, lastWeek) }
```
and add: "`scroll.ts` never imports `state.ts`. Week↔day conversion is anchored maths and arrives through the host, which is what keeps the virtualizer calendar-agnostic."

- [ ] **Step 2: Implement `mount`**

Replace the `mount` stub in `src/scroll.ts`:

```ts
export type ScrollHost = {
  fillRow(node: HTMLElement, week: WeekIndex, rowH: number): void
  mondayOf(week: WeekIndex): DayNumber
  weekOf(day: DayNumber): WeekIndex
  onDock(week: WeekIndex): void
  onRangeChange(firstWeek: WeekIndex, lastWeek: WeekIndex): void
}
export type ScrollController = {
  goToWeek(week: WeekIndex, animate: boolean): void
  setSnapStep(step: 15 | 30 | 45): void
  invalidate(weeks?: WeekIndex[]): void
  destroy(): void
}

export function mount(root: HTMLElement, host: ScrollHost): ScrollController {
  const pool: HTMLElement[] = []
  const assigned: (number | null)[] = []
  const expanded: Expanded = null          // stage 04 sets this; the maths already handle it
  let y = 0
  let rowH = MIN_ROW_H
  let viewportH = 0
  let modulus = 2                          // 30 is the default (DECISIONS)
  let raf = 0
  let dragging = false
  let lastPointerY = 0
  let lastT = 0
  let velocity = 0                         // px/ms, smoothed 0.7/0.3
  let anim: { from: number; to: number; t0: number; ms: number } | null = null
  let wheelTimer: ReturnType<typeof setTimeout> | null = null

  for (let i = 0; i < POOL_SIZE; i++) {
    const n = document.createElement('div')
    n.className = 'week'
    pool.push(n)
    assigned.push(null)
    root.append(n)
  }

  function measure(): void {
    viewportH = root.clientHeight
    const header = root.previousElementSibling as HTMLElement | null
    rowH = rowHeightFor(viewportH + (header?.offsetHeight ?? 0), header?.offsetHeight ?? 0)
    for (const s of assigned.keys()) assigned[s] = null   // force a refill at the new height
    place()
  }

  /** Two style writes per row. No layout READS here — that is the thrash SPEC forbids. */
  function place(): void {
    const first = weekAtY(y, rowH, expanded)
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = asWeek(first + i)
      const slot = ((w % POOL_SIZE) + POOL_SIZE) % POOL_SIZE
      const node = pool[slot]!
      if (assigned[slot] !== w) {
        assigned[slot] = w
        host.fillRow(node, w, rowH)
      }
      node.style.transform = `translateY(${posOf(w, rowH, expanded) - y}px)`
      node.style.height = `${heightOf(w, rowH, expanded)}px`
    }
    host.onRangeChange(first, asWeek(first + POOL_SIZE - 1))
  }

  function dockedWeek(): WeekIndex {
    return weekAtY(y + viewportH * SNAP_ALIGN, rowH, expanded)
  }

  function frame(now: number): void {
    raf = 0
    if (anim !== null) {
      const t = Math.min(1, (now - anim.t0) / anim.ms)
      y = anim.from + (anim.to - anim.from) * easeOutCubic(t)
      place()
      if (t < 1) { raf = requestAnimationFrame(frame) } else { anim = null; host.onDock(dockedWeek()) }
    }
  }

  function kick(): void { if (raf === 0) raf = requestAnimationFrame(frame) }

  function animateTo(target: number): void {
    anim = { from: y, to: target, t0: performance.now(), ms: settleMs(target - y, rowH) }
    kick()
  }

  /** Project momentum forward, find the nearest ENABLED anchor to where it would
   *  land, and ease into it. It settles softly; it does not hard-stop. */
  function settle(): void {
    const projected = projectY(y, velocity)
    const week = weekAtY(projected + viewportH * SNAP_ALIGN, rowH, expanded)
    const anchorDay = nearestAnchor(host.mondayOf(week), modulus, 0)
    animateTo(snapTargetY(host.weekOf(anchorDay), rowH, expanded, viewportH))
  }

  function onPointerDown(e: PointerEvent): void {
    dragging = true; anim = null
    lastPointerY = e.clientY; lastT = performance.now(); velocity = 0
    root.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return
    const now = performance.now()
    const dy = e.clientY - lastPointerY
    const dt = Math.max(1, now - lastT)
    velocity = 0.7 * velocity + 0.3 * (-dy / dt)     // smoothed 0.7/0.3
    y -= dy                                           // drag is 1:1
    lastPointerY = e.clientY; lastT = now
    place()
  }
  function onPointerUp(e: PointerEvent): void {
    if (!dragging) return
    dragging = false
    root.releasePointerCapture(e.pointerId)
    settle()
  }
  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    anim = null
    y += e.deltaY * WHEEL_GAIN
    velocity = 0
    place()
    if (wheelTimer !== null) clearTimeout(wheelTimer)
    wheelTimer = setTimeout(() => { wheelTimer = null; settle() }, WHEEL_IDLE_MS)
  }
  // user-scalable=no does nothing on iOS; this is the working fix (DECISIONS).
  const stop = (e: Event) => e.preventDefault()

  root.addEventListener('pointerdown', onPointerDown)
  root.addEventListener('pointermove', onPointerMove)
  root.addEventListener('pointerup', onPointerUp)
  root.addEventListener('pointercancel', onPointerUp)
  root.addEventListener('wheel', onWheel, { passive: false })
  root.addEventListener('dblclick', stop)
  for (const g of ['gesturestart', 'gesturechange', 'gestureend']) root.addEventListener(g, stop)
  window.addEventListener('resize', measure)

  measure()

  return {
    goToWeek(week, animate) {
      const target = snapTargetY(week, rowH, expanded, viewportH)
      if (animate) { animateTo(target) } else { y = target; place(); host.onDock(dockedWeek()) }
    },
    setSnapStep(step) { modulus = step === 15 ? 1 : step === 30 ? 2 : 3 },
    invalidate(weeks) {
      if (weeks === undefined) { for (const s of assigned.keys()) assigned[s] = null }
      else for (const w of weeks) assigned[((w % POOL_SIZE) + POOL_SIZE) % POOL_SIZE] = null
      place()
    },
    destroy() {
      if (raf !== 0) cancelAnimationFrame(raf)
      if (wheelTimer !== null) clearTimeout(wheelTimer)
      window.removeEventListener('resize', measure)
      root.replaceChildren()
    },
  }
}
```

Extend the `./scroll.ts` value import to include what `mount` uses, and add `DayNumber` to the type-only import.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run selftest && npm run build`
Expected: `TSC_CLEAN`, `49/49`, build OK. `mount` is DOM; Task 11 supplies its evidence.

- [ ] **Step 4: Commit**

```bash
git add src/scroll.ts _references/SPEC.md
git commit -m "stage 03: virtualizer — recycler, drag and wheel physics, soft settle"
```

---

### Task 8: `main.ts` — wiring

**Files:** Modify `src/main.ts`.

**Interfaces:**
- Consumes: `scroll.mount`, `render.renderWeek`, `render.renderRange`, `state.{spansForWeek,dayAt,weekOf,today,ensureMonthsFor,onCacheChange,prefs,savePrefs}`.
- Produces: the mounted app. Task 9 adds the year container and the toggle's other half.

- [ ] **Step 1: Build the shell and wire the host**

Replace `main.ts`'s final `else` branch (the `app.textContent = 'Bramwell'` line) and the DEV harness so both the app AND the harness render. **Do not delete the harness** — it is stage 05's to remove and it is what makes a gate runnable (contract carry-forward).

```ts
} else {
  const hdr = document.createElement('div')
  hdr.className = 'hdr'
  const range = document.createElement('span')
  range.className = 'hdr-range'
  const spacer = document.createElement('span')
  spacer.className = 'hdr-spacer'
  const todayBtn = document.createElement('button')
  todayBtn.id = 'btn-today'
  todayBtn.textContent = 'Today'
  const modeBtn = document.createElement('button')
  modeBtn.id = 'btn-mode'
  modeBtn.textContent = 'Year'
  const avatar = document.createElement('span')
  avatar.className = 'hdr-avatar'          // reserved; stage 05 fills it
  hdr.append(range, spacer, todayBtn, modeBtn, avatar)

  const scroller = document.createElement('div')
  scroller.className = 'scroller'
  app.replaceChildren(hdr, scroller)

  const MON = asOffset(0)
  const ctl = scroll.mount(scroller, {
    fillRow: (node, week, rowH) => render.renderWeek(node, week, state.spansForWeek(week), rowH),
    mondayOf: week => state.dayAt(week, MON),
    weekOf: day => state.weekOf(day),
    onDock: week => {
      render.renderRange(range, week, asWeek(week + 6))
      state.savePrefs({ ...state.prefs(), lastDockedDay: state.dayAt(week, MON) })
    },
    onRangeChange: (first, last) => {
      // SPEC: months load as weeks come within ~8 weeks of the viewport, both ways.
      const weeks: WeekIndex[] = []
      for (let w = first - 8; w <= last + 8; w++) weeks.push(asWeek(w))
      state.ensureMonthsFor(weeks)
    },
  })

  ctl.setSnapStep(30)
  ctl.goToWeek(state.weekOf(state.today()), false)
  // SPEC "Layout details": Today goes to today WITHOUT changing the view —
  // the calendar scrolls and re-snaps; the year view pages back to this year.
  todayBtn.addEventListener('click', () => {
    if (yearRoot.hidden) ctl.goToWeek(state.weekOf(state.today()), true)
    else yearCtl?.setYear(dayToCivil(state.today()).y)
  })
  // A full refill is 14 fillRow calls — cheaper than mapping month keys to weeks.
  state.onCacheChange(() => ctl.invalidate())
}
```

Add `import { asOffset, asWeek } from './dates.ts'` and `import type { WeekIndex } from './types.ts'` to `main.ts`. Brand at the seam — never widen a branded type with a cast to make the wiring compile.

- [ ] **Step 2: Keep the DEV harness alive alongside the app**

Change the harness branch so it *appends* a dev bar instead of replacing the app:

```ts
if (import.meta.env.DEV) {
  const bar = document.createElement('div')
  bar.id = 'devbar'
  bar.append(connect, out, status)
  document.body.append(bar)
}
```
and give it a minimal style in `style.css`: `#devbar { position: fixed; bottom: 0; left: 0; z-index: 9; display: flex; gap: 6px; padding: 4px; background: var(--band-b); }`.

- [ ] **Step 3: Verify and commit**

Run: `npm run dev`, open `http://localhost:5173/`, sign in, and confirm weeks render with today ringed.
Run: `npx tsc --noEmit && npm run selftest && npm run build` → `TSC_CLEAN`, `49/49`, build OK.

```bash
git add src/main.ts src/style.css
git commit -m "stage 03: wire the calendar — host callbacks, lazy months, Today"
```

---

### Task 9: `year.ts` — the grid

**Files:** Modify `src/render.ts` (extract `assignLanes`), `src/year.ts`, `src/main.ts` (mode toggle), `src/style.css`.

**Interfaces:**
- Consumes: `assignLanes` from `render.ts`; `state.{eventsForMonth,today,ensureMonthsFor}`.
- Produces: `year.mount(root, host): YearController` with `{ setYear(y), invalidate(), destroy() }`; `YearHost = { onPickDay(day: DayNumber): void }`. Task 10 adds the hover panel.

- [ ] **Step 1: Extract the lane algorithm so the year view shares it**

In `src/render.ts`, factor the body of `packLanes` into a generic and have `packLanes` call it — the year view packs 28-column rows, not 7:

```ts
/** Longest-first first-fit over any column range. Shared by the week rows and
 *  the year grid so a multi-day event holds ONE lane across a row in both. */
export function assignLanes<T extends { from: number; to: number; id: string }>(items: T[]): (T & { lane: number })[] {
  const sorted = [...items].sort((a, b) =>
    (b.to - b.from) - (a.to - a.from) || a.from - b.from || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const lastUsed: number[] = []
  return sorted.map(it => {
    let lane = 0
    while (lane < lastUsed.length && (lastUsed[lane] ?? -1) >= it.from) lane++
    lastUsed[lane] = it.to
    return { ...it, lane }
  })
}

export function packLanes(spans: EventSpan[]): PackedSpan[] {
  const bars = spans.filter(s => s.event.allDay)
    .map(s => ({ span: s, from: s.from as number, to: s.to as number, id: s.event.id }))
  return assignLanes(bars).map(x => ({ ...x.span, lane: x.lane }))
}
```

- [ ] **Step 2: Re-run Task 4's test to prove the refactor changed nothing**

Run: `npm run selftest`
Expected: still `49/49`, with `render: lane packing is longest-first, compact and deterministic` passing. That existing case is the regression guard for this refactor — do not modify it.

- [ ] **Step 3: Implement the year grid**

```ts
// STAGE 03 — year view. 365/366 cells in one pass; no virtualization.
import type { DayNumber } from './types.ts'
import { asDay, civilToDay, dayToCivil, offsetOf } from './dates.ts'
import { assignLanes } from './render.ts'
import { eventsForMonth, ensureMonthsFor, today, weekOf } from './state.ts'

export type YearHost = { onPickDay(day: DayNumber): void }
export type YearController = { setYear(y: number): void; invalidate(): void; destroy(): void }

const WDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** 28 columns (four weeks) on desktop; 14 on tablets AND phones. Phones default
 *  to 14, not 7 — OPEN.md flags 7 as "a long scroll" and this stage's gate
 *  settles it. */
function columnsFor(width: number): number {
  return width >= 1100 ? 28 : width >= 420 ? 14 : 7
}

export function mount(root: HTMLElement, host: YearHost): YearController {
  let year = dayToCivil(today()).y

  function build(): void {
    const cols = columnsFor(root.clientWidth)
    const jan1 = civilToDay(year, 1, 1)
    const indent = offsetOf(jan1)                 // 0 = Mon, so every column is one weekday
    const dec31 = civilToDay(year, 12, 31)
    const t = today()

    const grid = document.createElement('div')
    grid.className = 'yr'
    grid.style.setProperty('--cols', String(cols))

    // Row-level lane assignment, so a multi-day run holds one lane across a row.
    const cells: HTMLElement[] = []
    for (let i = 0; i < indent; i++) {
      const pad = document.createElement('div')
      pad.className = 'yrcell'
      pad.dataset['pad'] = ''
      cells.push(pad)
    }
    for (let d = jan1; d <= dec31; d = asDay(d + 1)) {
      const { m, d: dom } = dayToCivil(d)
      const cell = document.createElement('div')
      cell.className = 'yrcell'
      cell.dataset['band'] = m % 2 === 0 ? 'a' : 'b'
      const off = offsetOf(d)
      if (off >= 5) cell.dataset['weekend'] = ''
      if (d === t) cell.dataset['today'] = ''
      cell.dataset['day'] = String(d)
      const wd = document.createElement('span'); wd.className = 'yrwd'; wd.textContent = WDAY[off] ?? ''
      const num = document.createElement('span'); num.className = 'yrnum'; num.textContent = String(dom)
      cell.append(wd, num)
      if (dom === 1) {
        const badge = document.createElement('span'); badge.className = 'badge'
        badge.textContent = new Date(Date.UTC(2000, m - 1, 1)).toLocaleString(undefined, { month: 'short', timeZone: 'UTC' })
        cell.append(badge)
      }
      cells.push(cell)
    }

    // Per row of `cols` cells, pack that row's all-day events into lanes 0..2.
    for (let start = 0; start < cells.length; start += cols) {
      const row = cells.slice(start, start + cols)
      const items: { from: number; to: number; id: string; cat: string }[] = []
      const seen = new Set<string>()
      row.forEach((cell, i) => {
        const dayAttr = cell.dataset['day']
        if (dayAttr === undefined) return
        const day = asDay(Number(dayAttr))
        for (const ev of eventsForMonth(monthKeyOf(day))) {
          if (!ev.allDay || seen.has(ev.id)) continue
          if (ev.end < day || ev.start > day) continue
          seen.add(ev.id)
          const from = i, to = Math.min(cols - 1, i + (ev.end - day))
          items.push({ from, to, id: ev.id, cat: ev.category })
        }
      })
      for (const it of assignLanes(items)) {
        if (it.lane > 2) continue                 // >3 are dropped in the grid; the panel lists all
        const bar = document.createElement('div')
        bar.className = 'yrbar'
        bar.dataset['cat'] = it.cat
        bar.style.gridColumn = `${it.from + 1} / ${it.to + 2}`
        bar.style.setProperty('--lane', String(it.lane))
        grid.append(bar)
      }
    }
    grid.prepend(...cells)
    root.replaceChildren(grid)
    ensureMonthsFor(monthsOfYear(year).map(k => weekOf(civilToDay(Number(k.slice(0, 4)), Number(k.slice(5, 7)), 1))))
  }

  function monthKeyOf(d: DayNumber): string {
    const c = dayToCivil(d)
    return `${c.y}-${String(c.m).padStart(2, '0')}`
  }
  function monthsOfYear(y: number): string[] {
    return Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`)
  }

  function onClick(e: Event): void {
    const cell = (e.target as HTMLElement).closest('.yrcell') as HTMLElement | null
    const d = cell?.dataset['day']
    if (d !== undefined) host.onPickDay(asDay(Number(d)))
  }
  root.addEventListener('click', onClick)
  window.addEventListener('resize', build)
  build()

  return {
    setYear(y) { year = y; build() },
    invalidate() { build() },
    destroy() { root.removeEventListener('click', onClick); window.removeEventListener('resize', build); root.replaceChildren() },
  }
}
```

- [ ] **Step 4: Add year styles and wire the toggle**

`style.css`:

```css
.yr { display: grid; grid-template-columns: repeat(var(--cols), 1fr); gap: 2px; padding: 8px; position: relative; }
.yrcell { position: relative; aspect-ratio: 1 / 1.25; border-radius: 6px; background: var(--band-a); padding: 2px 3px; min-width: 0; }
.yrcell[data-band="b"] { background: var(--band-b); }
.yrcell[data-weekend][data-band="a"] { background: var(--band-a-end); }
.yrcell[data-weekend][data-band="b"] { background: var(--band-b-end); }
.yrcell[data-pad] { background: none; }
.yrcell[data-today] { box-shadow: inset 0 0 0 2px var(--today); }
.yrcell[data-today] .yrnum { color: var(--today); font-weight: 700; }
.yrwd { font-size: 9px; color: var(--ink-dim); }
.yrnum { font-size: 11px; font-variant-numeric: tabular-nums; display: block; }
.yrbar { grid-row: 1; height: 3px; border-radius: 2px; background: var(--cat); margin-top: calc(26px + var(--lane) * 5px); pointer-events: none; }
```

In `main.ts`, add a year container and the toggle:

```ts
  const yearRoot = document.createElement('div')
  yearRoot.className = 'yearview'
  yearRoot.hidden = true
  app.append(yearRoot)
  let yearCtl: import('./year.ts').YearController | null = null
  let shownYear = dayToCivil(state.today()).y

  // Year steppers — header, year view only (SPEC "Layout details").
  const prevY = document.createElement('button'); prevY.id = 'btn-prev-year'; prevY.textContent = '‹'
  const nextY = document.createElement('button'); nextY.id = 'btn-next-year'; nextY.textContent = '›'
  prevY.hidden = true; nextY.hidden = true
  hdr.insertBefore(prevY, spacer)
  hdr.insertBefore(nextY, spacer)
  const step = (d: number) => { shownYear += d; yearCtl?.setYear(shownYear); range.textContent = String(shownYear) }
  prevY.addEventListener('click', () => step(-1))
  nextY.addEventListener('click', () => step(1))
  modeBtn.addEventListener('click', () => {
    const toYear = yearRoot.hidden
    yearRoot.hidden = !toYear
    scroller.hidden = toYear
    modeBtn.textContent = toYear ? 'Cal' : 'Year'
    modeBtn.setAttribute('aria-pressed', String(toYear))
    prevY.hidden = !toYear
    nextY.hidden = !toYear
    if (toYear) range.textContent = String(shownYear)
    if (toYear && yearCtl === null) {
      yearCtl = year.mount(yearRoot, { onPickDay: d => {
        yearRoot.hidden = true; scroller.hidden = false
        modeBtn.textContent = 'Year'; modeBtn.setAttribute('aria-pressed', 'false')
        ctl.goToWeek(state.weekOf(d), false)
      } })
    }
  })
```

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit && npm run selftest && npm run build` → `TSC_CLEAN`, `49/49`, build OK.

```bash
git add src/year.ts src/render.ts src/main.ts src/style.css
git commit -m "stage 03: year grid — week-aligned columns, row lanes, day pick"
```

---

### Task 10: `year.ts` — hover panel and touch flow

**Files:** Modify `src/year.ts`, `src/style.css`.

**Interfaces:** Consumes Task 9's grid. Produces no new exports.

- [ ] **Step 1: Implement the panel**

Append inside `mount`, before the `return`:

```ts
  const panel = document.createElement('div')
  panel.className = 'yrpanel'
  panel.hidden = true
  root.append(panel)
  let shown: DayNumber | null = null

  function fillPanel(day: DayNumber): void {
    const rows: string[] = []
    for (const d of [asDay(day - 1), day, asDay(day + 1)]) {
      const c = dayToCivil(d)
      const evs = eventsForMonth(monthKeyOf(d)).filter(e => e.start <= d && e.end >= d)
      rows.push(`${c.m}/${c.d}`)
      for (const e of evs) {
        const at = e.allDay ? '' : `${((e.startMin ?? 0) % 720) || 12}:${String((e.startMin ?? 0) % 60).padStart(2, '0')}${(e.startMin ?? 0) < 720 ? 'am' : 'pm'} `
        rows.push(`  ${at}${e.title}`)
      }
    }
    // Rebuilt IN PLACE and never hidden mid-repaint, so a background refresh
    // cannot make it flicker (DECISIONS "In force — scroll and render").
    panel.textContent = rows.join('\n')
  }

  function showPanel(cell: HTMLElement, day: DayNumber): void {
    fillPanel(day)
    panel.hidden = false
    const r = cell.getBoundingClientRect()
    const rr = root.getBoundingClientRect()
    const below = r.bottom - rr.top + 6
    const fits = below + panel.offsetHeight < rr.height
    panel.style.left = `${Math.min(r.left - rr.left, rr.width - panel.offsetWidth - 8)}px`
    panel.style.top = fits ? `${below}px` : `${r.top - rr.top - panel.offsetHeight - 6}px`
    shown = day
  }

  function onOver(e: Event): void {
    const cell = (e.target as HTMLElement).closest('.yrcell') as HTMLElement | null
    const d = cell?.dataset['day']
    if (d === undefined || cell === null) return
    showPanel(cell, asDay(Number(d)))
  }
  function onLeave(): void { panel.hidden = true; shown = null }
  root.addEventListener('pointerover', onOver)
  root.addEventListener('pointerleave', onLeave)
```

Change `onClick` so touch gets the two-tap flow — first tap raises the panel, a second tap on the *same* day opens it, a tap elsewhere dismisses:

```ts
  function onClick(e: Event): void {
    const cell = (e.target as HTMLElement).closest('.yrcell') as HTMLElement | null
    const d = cell?.dataset['day']
    if (d === undefined || cell === null) { onLeave(); return }
    const day = asDay(Number(d))
    const coarse = window.matchMedia('(hover: none)').matches
    if (coarse && shown !== day) { showPanel(cell, day); return }
    host.onPickDay(day)
  }
```

Add the listeners to `destroy()`.

- [ ] **Step 2: Style it**

```css
.yrpanel {
  position: absolute; z-index: 4; pointer-events: none;   /* SPEC: never intercepts */
  background: var(--band-b); color: var(--ink);
  border-radius: 8px; box-shadow: var(--el-open);
  padding: 8px 10px; font-size: 12px; white-space: pre; max-width: 280px;
}
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit && npm run selftest && npm run build` → `TSC_CLEAN`, `49/49`, build OK.

```bash
git add src/year.ts src/style.css
git commit -m "stage 03: year hover panel, edge flip, two-tap touch flow"
```

---

### Task 11: Headless evidence

The contract demands measurements at three viewports. Real data would make them non-reproducible, so the harness seeds `localStorage` with a crafted `ready` month and never touches the network or auth.

**Files:**
- Modify: `_references/SPEC.md` ("File layout" — add `scripts/`)
- Create: `scripts/shot.mjs`

- [ ] **Step 1: Add `scripts/` to the SPEC layout first**

The layout lacks it, and the rule is that a file the layout lacks goes into SPEC before it is created. Add under `/src/types.ts`:

```
/scripts/                 — node-only tooling, never bundled: selftest runner, headless evidence harness
```

- [ ] **Step 2: Write the harness**

```js
// scripts/shot.mjs — headless evidence. Node 26 has a global WebSocket, so CDP
// needs no dependency. Colour scheme is driven with Emulation.setEmulatedMedia:
// --blink-settings=preferredColorScheme=2 crashes Chrome 151 (CONVENTIONS).
import { spawn } from 'node:child_process'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const VIEWPORTS = [[390, 844], [1440, 900], [1920, 1200]]
const SCHEMES = ['light', 'dark']

// A month whose events exercise every claim: a 21-day run for the wrap test,
// and a month boundary inside a week for the band-split test.
const SEED = (() => {
  const day = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000
  const ev = (id, s, e, colorId) => ({ id, title: id, allDay: true, colorId, start: s, end: e })
  const months = {}
  for (const [key, list] of [
    ['2026-08', [ev('long-21', day(2026, 8, 10), day(2026, 8, 30), '9'), ev('solo', day(2026, 8, 4), day(2026, 8, 4), '10')]],
    ['2026-09', [ev('sept', day(2026, 9, 2), day(2026, 9, 3), '5')]],
  ]) months[key] = { state: 'ready', fetchedAt: Date.now(), events: list }
  return JSON.stringify({ v: 1, months })
})()

async function cdp(ws, method, params = {}, id = Math.floor(Math.random() * 1e9)) {
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise(res => {
    const on = e => {
      const m = JSON.parse(e.data)
      if (m.id === id) { ws.removeEventListener('message', on); res(m.result) }
    }
    ws.addEventListener('message', on)
  })
}

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9222', 'about:blank'])
await new Promise(r => setTimeout(r, 1500))
const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find(t => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r, { once: true }))
await cdp(ws, 'Page.enable')
await cdp(ws, 'Runtime.enable')

const results = []
for (const [w, h] of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    await cdp(ws, 'Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 })
    await cdp(ws, 'Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
    await cdp(ws, 'Page.navigate', { url: 'http://localhost:5173/' })
    await new Promise(r => setTimeout(r, 600))
    await cdp(ws, 'Runtime.evaluate', { expression: `localStorage.setItem('bramwell.cache.v1', ${JSON.stringify(SEED)})` })
    await cdp(ws, 'Page.navigate', { url: 'http://localhost:5173/' })
    await new Promise(r => setTimeout(r, 1200))
    const { result } = await cdp(ws, 'Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const rows = [...document.querySelectorAll('.week')]
        const tops = rows.map(r => r.getBoundingClientRect().top).sort((a,b)=>a-b)
        const gaps = tops.slice(1).map((t,i) => Math.round(t - tops[i]))
        const rowH = Math.round(rows[0].getBoundingClientRect().height)
        const titled = [...document.querySelectorAll('.bar')].filter(b => b.textContent.trim() === 'long-21')
        const contin = [...document.querySelectorAll('.bar[data-cont-before], .bar[data-cont-after]')]
        const bandsInARow = rows.map(r => new Set([...r.querySelectorAll('.day')].map(d => d.dataset.band)).size)
        const btn = document.getElementById('btn-today')
        const bb = btn.getBoundingClientRect()
        const hit = document.elementFromPoint(bb.left + bb.width/2, bb.top + bb.height/2)
        return {
          weekNodes: rows.length,
          rowH, gaps: [...new Set(gaps)],
          spacingEqualsHeight: gaps.every(g => Math.abs(g - rowH) <= 1),
          titledBars: titled.length,
          continuationBars: contin.length,
          rowsWithTwoBands: bandsInARow.filter(n => n > 1).length,
          todayHit: hit === btn || btn.contains(hit),
          scheme: getComputedStyle(document.body).backgroundColor,
        }
      })()`,
    })
    results.push({ viewport: \`\${w}x\${h}\`, scheme, ...result.value })
  }
}
console.log(JSON.stringify(results, null, 2))
ws.close(); chrome.kill()
```

Add to `package.json` scripts: `"shot": "node scripts/shot.mjs"`.

- [ ] **Step 3: Run it and check every claim**

```bash
npm run dev & sleep 3
npm run shot | tee /tmp/shot.json
kill %1
```

Every one of the six rows must show:
- `weekNodes: 14` — the pool never grows (contract: `.week` count stays 14).
- `spacingEqualsHeight: true` — row spacing equals row height at every viewport.
- `rowH` inside 74–190, and different between 390×844 and 1920×1200 (proportional within clamps).
- `titledBars: 1` — a 21-day event carries its title exactly once, on the true start.
- `continuationBars: 2` — it wraps three rows, so two of the three pieces are continuations.
- `rowsWithTwoBands: >= 1` — a week straddling Aug/Sep shows both bands, so the band splits mid-row.
- `todayHit: true` — `elementFromPoint` at the Today button's centre resolves to it, in **both** schemes.
- `scheme` differs between the light and dark runs at the same viewport, proving the emulation actually took.

- [ ] **Step 4: Commit**

```bash
git add scripts/shot.mjs package.json _references/SPEC.md
git commit -m "stage 03: headless evidence harness — seeded cache, CDP colour scheme"
```

---

### Task 12: `verification.md`

**Files:** Create `03_engine/output/verification.md`; modify `03_engine/CONTEXT.md` (Status).

- [ ] **Step 1: Write the record**

Follow `02_data/output/verification.md`. It must carry:

- **Automated criteria** with actual command output: `npm run selftest` (49/49), `npx tsc --noEmit`, `npm run build`, the `npm run shot` JSON for all six viewport×scheme combinations, and the motion-literal grep.
- **The variable-height-row evidence**: the Task 1 Step 5 result showing the round-trip test failing when `posOf`'s comparison is broken and passing when restored. This is what closes `OPEN.md`'s stop-and-revise clause with proof rather than assertion — say so explicitly.
- **Rulings the spec left open**, for promotion at gate close: the palette (fifty values plus the four non-mood tokens, and the fact that Warm's light ground moved off the seed `#f7f6f3` to make ladder headroom); `--today` reserved as teal; `renderWeek` gaining `rowH`; `ScrollHost` gaining `mondayOf`/`weekOf` to keep `scroll.ts` clear of `state.ts`; `assignLanes` shared between week rows and the year grid; the year view's phone default of 14 columns; `scripts/` added to the SPEC layout.
- **Not tested**, honestly: 60fps on a real mid-range phone (headless cannot measure it); the feel of the settle; haptics (off by decision); anything needing a real account, since the harness seeds `localStorage`; `prefers-reduced-motion` collapse; whether 14 columns actually beats 7 on a phone.
- **The tuned-by-feel table** the contract asks for — one row per constant, its SPEC value, the value after the gate, and why it moved.

- [ ] **Step 2: Flip the Status line**

Change `03_engine/CONTEXT.md` to `**Status: AWAITING GATE.**` with the date. The human runs the gate; the next stage does not open until they close it.

- [ ] **Step 3: Commit**

```bash
git add 03_engine/output/verification.md 03_engine/CONTEXT.md
git commit -m "stage 03: verification record, awaiting gate"
```
