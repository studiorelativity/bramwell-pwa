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
