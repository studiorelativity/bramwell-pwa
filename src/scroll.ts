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
  // The expanded row's region boundaries come from posOf/heightOf, not
  // reconstructed arithmetic, so a change to either propagates here
  // automatically. Only the division that INVERTS a position is exempt —
  // there is no primitive for that.
  const top = posOf(ex.week, rowH, ex)
  const bottom = top + heightOf(ex.week, rowH, ex)
  if (y < top) return asWeek(Math.floor(y / rowH))
  if (y < bottom) return ex.week
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

// ---------- Mount ----------

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
