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

/** Scroll offset that keeps the expanded row fully on screen: shift up by however
 *  much its bottom overruns the viewport, but NEVER past its own top edge, and
 *  pull it back down if it starts above the fold. Pure — no layout read, so the
 *  scroll-to-fit ride is decided before a single pixel moves and rides the same
 *  transition as the expansion itself. */
export function fitY(y: number, ex: Expanded, rowH: number, viewportH: number): number {
  if (ex === null) return y
  const top = posOf(ex.week, rowH, ex) - y
  const bottom = top + heightOf(ex.week, rowH, ex)
  if (top < 0) return y + top
  if (bottom > viewportH) return y + Math.min(bottom - viewportH, top)
  return y
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
  /** The expand/collapse transition is over. Fired for a non-animated set too. */
  onExpandEnd(): void
}
export type ScrollController = {
  goToWeek(week: WeekIndex, animate: boolean): void
  setSnapStep(step: 15 | 30 | 45): void
  setExpanded(ex: Expanded, animate: boolean): void
  /** Raises `data-anim` on its own — no timer, no geometry, no `place()` — so a
   *  caller can open the gate BEFORE writing the column template, not merely in
   *  the same task as it (SPEC "Scroll engine API"): this engine will not start
   *  a `grid-template-columns` transition for a value that already reached its
   *  target before the property became eligible, even one statement earlier
   *  with no yield in between. `setExpanded` still calls `setAnim` itself, so
   *  arming again inside it is simply idempotent. */
  armAnim(kind: 'expand' | 'collapse'): void
  /** The UNEXPANDED row height. Consumers derive the delta from this rather than
   *  measuring a DOM node, which mid-animation would read an interpolated height. */
  rowHeight(): number
  invalidate(weeks?: WeekIndex[]): void
  destroy(): void
}

export function mount(root: HTMLElement, host: ScrollHost): ScrollController {
  const pool: HTMLElement[] = []
  const assigned: (number | null)[] = []
  let expanded: Expanded = null
  let animTimer: ReturnType<typeof setTimeout> | null = null
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
  // One AbortController for every listener bound below: destroy() calls
  // abort() once instead of pairing ten removeEventListener calls by hand,
  // which is how this class of leak comes back.
  const ac = new AbortController()

  for (let i = 0; i < POOL_SIZE; i++) {
    const n = document.createElement('div')
    n.className = 'week'
    pool.push(n)
    assigned.push(null)
    root.append(n)
  }

  function measure(): void {
    // A hidden root (main.ts hides the scroller under the year view) reads
    // clientHeight 0, which rowHeightFor clamps to MIN_ROW_H — a real height,
    // not an error, so nothing downstream would notice it is wrong. Bailing
    // here, at the one place a bad reading enters, is what stops it rather
    // than requiring every future caller of a 'resize'-driven remeasure to
    // remember the root might be hidden (round 5 review: a resize dispatched
    // while the year view was showing pinned rowH at 74 until the NEXT
    // resize with the scroller visible, which could be much later or never).
    if (root.clientHeight === 0) return
    viewportH = root.clientHeight
    const header = root.previousElementSibling as HTMLElement | null
    rowH = rowHeightFor(viewportH + (header?.offsetHeight ?? 0), header?.offsetHeight ?? 0)
    for (const s of assigned.keys()) assigned[s] = null   // force a refill at the new height
    place()
  }

  /** The transition gate. `null` clears it, and every path that moves `y` clears
   *  it first so a drag is never transitioned.
   *
   *  A pending `animTimer` being cancelled here means the timeout that would
   *  have fired `onExpandEnd()` never runs — so this function fires it in that
   *  timer's place, before touching any dataset. Safe to call synchronously:
   *  `setAnim` is the FIRST statement of `onPointerDown`/`onWheel`/`goToWeek`/
   *  `setExpanded` (a genuine drag, wheel, or programmatic scroll always
   *  clears the gate before it does anything else), and — since round 4 — of
   *  `frame` ONLY while `frame` has an actual kinetic animation to advance;
   *  a `frame` tick with nothing to animate leaves the gate alone rather than
   *  clobbering one `setExpanded` just set (see `frame`'s own comment). None
   *  of these ever call `place()` before `setAnim` — never nested inside one.
   *  It fires at most once per cancelled timer (`animTimer` is nulled
   *  immediately, so a timer that goes on to fire normally finds nothing
   *  left to cancel here).
   *
   *  The jump stamps are cleared on EVERY call, not only when clearing to
   *  null: `setExpanded(ex, true)` immediately followed by `setExpanded(null,
   *  true)` (a double-tap toggle) switches `kind` directly from 'expand' to
   *  'collapse' without ever passing through null, and a stamp left over from
   *  the interrupted expand would freeze that row's transition-property at
   *  'none' for the collapse too (motion.css). */
  function setAnim(kind: 'expand' | 'collapse' | null): void {
    if (animTimer !== null) { clearTimeout(animTimer); animTimer = null; host.onExpandEnd() }
    for (const n of pool) delete n.dataset['jump']
    if (kind !== null) { root.dataset['anim'] = kind; return }
    if (root.dataset['anim'] !== undefined) delete root.dataset['anim']
  }

  /** The effective duration motion.css just applied, read back off the element.
   *  This is why no expand duration exists in this file: the value has one home,
   *  and reduced motion's 80ms arrives here without a second code path. */
  function animMs(node: HTMLElement): number {
    const cs = getComputedStyle(node)
    const longest = (v: string) => Math.max(0, ...v.split(',').map(s => parseFloat(s) || 0))
    return (longest(cs.transitionDuration) + longest(cs.transitionDelay)) * 1000
  }

  /** Two style writes per row. No layout READS here — that is the thrash SPEC forbids. */
  function place(): void {
    // One property read, no layout read: the stamp is only meaningful while an
    // animation is running, so steady-state rows keep exactly two style writes.
    const animating = root.dataset['anim'] !== undefined
    const first = weekAtY(y, rowH, expanded)
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = asWeek(first + i)
      const slot = ((w % POOL_SIZE) + POOL_SIZE) % POOL_SIZE
      const node = pool[slot]!
      const prev = assigned[slot]
      if (prev !== w) {
        assigned[slot] = w
        // Recycled INTO view FROM A DIFFERENT WEEK, mid-animation: without this
        // it slides in from its previous position, 14 rows away. `prev` must be
        // non-null and different from `w` — a `null` previous value means this
        // slot's assignment was merely CLEARED (a full invalidate() resets every
        // slot to force a refill of the SAME week at the SAME position, which is
        // not a recycle and must not disable that row's own in-flight transition
        // — round 3 review: a background cache refresh landing mid-expand used
        // to stamp every visible row, including the one genuinely expanding).
        if (animating && prev !== null && prev !== w) node.dataset['jump'] = ''
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

  /** setAnim(null) moved INSIDE the "there is actually a kinetic animation"
   *  branch (round 4 review): the old unconditional call at the top fired on
   *  EVERY tick this function was ever invoked for, including a trailing
   *  tick whose `anim` a concurrent `setExpanded` had just cleared — so it
   *  clobbered an expand's gate that setExpanded had only just set, one
   *  frame later, even after setExpanded cancels the pending rAF (belt and
   *  suspenders: a defensive gate-clear for a callback that fires anyway
   *  should still be a no-op, not an active clobber). A GENUINE drag/wheel/
   *  goToWeek still clears the gate before it ever reaches here — see
   *  setAnim's own doc comment. */
  function frame(now: number): void {
    raf = 0
    if (anim !== null) {
      setAnim(null)
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
    const target = snapTargetY(host.weekOf(anchorDay), rowH, expanded, viewportH)
    // Already docked: skip the no-op animation instead of running a full
    // SETTLE_BASE_MS easing that lands back where it started.
    if (Math.abs(target - y) < 1) { host.onDock(dockedWeek()); return }
    animateTo(target)
  }

  function onPointerDown(e: PointerEvent): void {
    setAnim(null)
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
    setAnim(null)
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

  root.addEventListener('pointerdown', onPointerDown, { signal: ac.signal })
  root.addEventListener('pointermove', onPointerMove, { signal: ac.signal })
  root.addEventListener('pointerup', onPointerUp, { signal: ac.signal })
  root.addEventListener('pointercancel', onPointerUp, { signal: ac.signal })
  root.addEventListener('wheel', onWheel, { passive: false, signal: ac.signal })
  root.addEventListener('dblclick', stop, { signal: ac.signal })
  for (const g of ['gesturestart', 'gesturechange', 'gestureend']) {
    root.addEventListener(g, stop, { signal: ac.signal })
  }
  window.addEventListener('resize', measure, { signal: ac.signal })

  measure()

  return {
    goToWeek(week, animate) {
      setAnim(null)
      const target = snapTargetY(week, rowH, expanded, viewportH)
      if (animate) { animateTo(target) } else { y = target; place(); host.onDock(dockedWeek()) }
    },
    setSnapStep(step) { modulus = step === 15 ? 1 : step === 30 ? 2 : 3 },
    setExpanded(ex, animate) {
      // The expand takes over positioning itself (fitY, below) — a kinetic
      // settle still gliding toward its own target would fight it over `y`
      // (round 4 review: an ordinary tap-while-gliding, via the SAME
      // pointerdown/pointerup this scroller's own drag handling reacts to,
      // could kick off a settle that raced the expand and, together with the
      // old unconditional setAnim(null) in frame(), snapped it — see frame's
      // comment for the other half of this fix). Cancel it outright rather
      // than rely on frame() to notice next tick.
      if (raf !== 0) { cancelAnimationFrame(raf); raf = 0 }
      anim = null
      setAnim(animate ? (ex === null ? 'collapse' : 'expand') : null)
      // The maths jump; CSS carries the pixels. Moving y IS writing transforms,
      // so the row growing and the view sliding to fit it are one transition.
      expanded = ex
      y = fitY(y, ex, rowH, viewportH)
      place()
      if (!animate) { host.onExpandEnd(); return }
      const ms = animMs(pool[0]!)
      animTimer = setTimeout(() => { animTimer = null; setAnim(null); host.onExpandEnd() }, ms)
    },
    armAnim(kind) { setAnim(kind) },
    rowHeight() { return rowH },
    invalidate(weeks) {
      if (weeks === undefined) { for (const s of assigned.keys()) assigned[s] = null }
      else for (const w of weeks) assigned[((w % POOL_SIZE) + POOL_SIZE) % POOL_SIZE] = null
      place()
    },
    destroy() {
      if (raf !== 0) cancelAnimationFrame(raf)
      if (wheelTimer !== null) clearTimeout(wheelTimer)
      if (animTimer !== null) clearTimeout(animTimer)
      ac.abort()
      root.replaceChildren()
    },
  }
}
