// STAGE 02 — bootstrapping and wiring; owns the theme <style>.
import './style.css'
import './motion.css'
import * as auth from './auth.ts'
import * as categories from './categories.ts'
import * as chrome from './chrome.ts'
import * as day from './day.ts'
import * as gcal from './gcal.ts'
import * as render from './render.ts'
import * as scroll from './scroll.ts'
import * as state from './state.ts'
import * as year from './year.ts'
import { asDay, asOffset, asWeek, dayToCivil } from './dates.ts'
import type { DayNumber, WeekIndex } from './types.ts'

const app = document.getElementById('app')
if (!app) throw new Error('STAGE 02: #app missing')

// The single <style> for runtime colour. categories.ts returns a string and never touches the DOM.
const themeStyle = document.createElement('style')
themeStyle.id = 'bramwell-theme'
document.head.append(themeStyle)

/** main.ts is the single writer of category state: at bootstrap and on every prefs change. */
function applyTheme(): void {
  const p = state.prefs()
  categories.configure(p)
  themeStyle.textContent = categories.themeCss(p.mood ?? 'warm')
}

applyTheme()

if (new URLSearchParams(location.search).has('selftest')) {
  const { selfTest } = await import('./selftest.ts')
  const results = await selfTest()
  const passed = results.filter(r => r.pass).length
  const pre = document.createElement('pre')
  pre.textContent =
    results.map(r => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : ' — ' + r.detail}`).join('\n') +
    `\n\n${passed}/${results.length}`
  pre.dataset['selftest'] = passed === results.length ? 'pass' : 'fail'
  app.replaceChildren(pre)
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
  // Year steppers — header, year view only (SPEC "Layout details").
  const prevY = document.createElement('button'); prevY.id = 'btn-prev-year'; prevY.textContent = '‹'
  const nextY = document.createElement('button'); nextY.id = 'btn-next-year'; nextY.textContent = '›'
  prevY.hidden = true; nextY.hidden = true
  // SPEC order: range, steppers, toggle, Today, avatar.
  hdr.append(range, prevY, nextY, spacer, modeBtn, todayBtn, avatar)

  const scroller = document.createElement('div')
  scroller.className = 'scroller'
  const yearRoot = document.createElement('div')
  yearRoot.className = 'yearview'
  yearRoot.hidden = true
  app.replaceChildren(hdr, scroller, yearRoot)

  const MON = asOffset(0)
  let lastRange = { first: NaN, last: NaN }

  // ---- inline day expansion (SPEC "Inline day expansion") ----
  // One day open at a time; main.ts is the only owner of that fact.
  let openDay: DayNumber | null = null
  let delta = 0
  let heldRepaint = false
  let heightRaf = 0
  /** False from the tap until remeasure's deferred frame. A CSS transition
   *  interpolates from the style at the LAST recalc, so the column template
   *  has to change in the SAME task as the height (see remeasure/pendingFill)
   *  — write it a task early and the columns snap while the height animates. */
  let expandReady = false
  /** A pointer that travels further than this was a drag, not a tap. */
  const TAP_SLOP = 6

  const weekOfOpen = (): WeekIndex | null => openDay === null ? null : state.weekOf(openDay)
  const openRow = (): HTMLElement | null =>
    scroller.querySelector<HTMLElement>('.day[data-open]')?.closest<HTMLElement>('.week') ?? null

  function clearColumns(node: HTMLElement): void {
    // Armed on this ONE node only, never the pool (round 7 review): this
    // engine will not start a grid-template-columns transition when its
    // gate is written to more than one element in the same batch, which is
    // exactly what armAnim's pool-wide reach would do for this property.
    // colsAnimKind is null for an unrelated refill (ordinary recycling also
    // reaches here), so most calls arm nothing.
    if (colsAnimKind !== null) ctl.armColsAnim(node, colsAnimKind)
    node.style.removeProperty('--expand-cols')
    node.removeAttribute('data-full')
    // .bars is NOT written here: its CSS is `grid-template-columns: inherit`
    // (style.css), so it already reads back to 7-equal the instant .week's
    // own property is removed — nothing to clear (round 2 review).
  }

  function applyColumns(node: HTMLElement, week: WeekIndex): void {
    if (openDay === null || !expandReady || state.weekOf(openDay) !== week) { clearColumns(node); return }
    const full = window.innerWidth <= render.PHONE_MAX_W
    const cols = render.columnsFor(asOffset(openDay - state.dayAt(week, MON)), full)
    // Written to the --expand-cols CUSTOM property, not grid-template-columns itself
    // (round 4 review): this Chrome build does not transition
    // grid-template-columns when it is set directly via inline style — the
    // computed value jumps straight to the new one, no interpolation, even
    // with data-anim, the transition-duration, and a matching track-sizing
    // function all correct (confirmed in isolation: an inline `el.style.
    // gridTemplateColumns = ...` snaps; toggling a CLASS that changes the
    // same property, or writing a custom property the CSS rule reads with
    // var(), both interpolate). style.css's rule is `grid-template-columns:
    // var(--expand-cols, repeat(7, minmax(0, 1fr)))`, so the property that's
    // actually declared to transition is never itself touched by JS.
    // Written ONLY on .week. .bars inherits the RESULT (style.css's `inherit`
    // reads .week's computed grid-template-columns, not --expand-cols) rather than
    // getting its own copy: inheritance resolves from .week's COMPUTED value
    // every frame, so a freshly-created .bars (renderWeek makes a new one on
    // every fill) tracks .week's in-flight transition immediately, with
    // nothing of its own to snap — writing the same value directly to a
    // brand-new node has no before-change style to interpolate FROM
    // (round 2 review).
    // Armed on this ONE node before the write, same reasoning as
    // clearColumns above (round 7 review) — never via armAnim's pool loop.
    if (colsAnimKind !== null) ctl.armColsAnim(node, colsAnimKind)
    node.style.setProperty('--expand-cols', cols)
    if (full) { node.dataset['full'] = '' } else { node.removeAttribute('data-full') }
  }

  /** The fillRow seam: render.ts draws the week, then the open day is substituted
   *  here — neither scroll.ts nor render.ts learns that day.ts exists. */
  function applyExpansion(node: HTMLElement, week: WeekIndex): void {
    applyColumns(node, week)
    if (openDay === null || state.weekOf(openDay) !== week) return
    const cell = node.querySelector<HTMLElement>(`.day[data-day="${openDay}"]`)
    if (cell === null) return
    cell.dataset['open'] = ''
    day.expand(openDay, cell)
  }

  /** True for exactly the remeasure that follows an open/switch: that frame's
   *  fillRow (which attaches the panel — possibly to a NEW cell, on a
   *  same-week switch — and writes the column template) must land in the
   *  SAME task as setExpanded below it, or the template has nothing left to
   *  interpolate when data-anim appears a task later (round 1 review: a
   *  same-week switch used to write the template synchronously in
   *  openDayAt, a whole frame before data-anim existed, so it snapped).
   *  Consumed once so the resize/onHeightChange callers below — which also
   *  route through this same function — get the cheap path instead of a
   *  fresh render.renderWeek on every keystroke a form will someday cause. */
  let pendingFill = false

  /** Set by openDayAt only on a cross-week switch: the OLD week's row still
   *  needs its columns cleared. Consumed by the SAME remeasure() call that
   *  does the new week's fill, ahead of it, so the old row's clear and the
   *  new row's write both land in the task that raises data-anim (round 2
   *  review: this used to run synchronously in openDayAt, a task before
   *  data-anim existed, so the old row's columns snapped back to equal a
   *  frame before its height animated down). */
  let pendingDetachWeek: WeekIndex | null = null

  /** Threads the CURRENT geometry-gate kind into applyColumns/clearColumns,
   *  which fillRow calls with a fixed signature (SPEC "Scroll engine API")
   *  that has no room for an extra parameter. Bracketed tightly by remeasure()
   *  and closeDay() — set immediately before the ctl.invalidate()/
   *  clearColumns() call(s) it is meant for, reset to null immediately after
   *  — so an UNRELATED refill (ordinary wheel-scroll recycling also calls
   *  fillRow -> applyExpansion -> applyColumns for every row that changes)
   *  never sees a stale value and arms a column gate nothing asked for. null
   *  means "no column change is expected this task, do not arm". */
  let colsAnimKind: 'expand' | 'collapse' | null = null

  /** The delta comes from scroll's own rowHeight, never from a DOM read — mid
   *  animation a measured row height is an interpolated one. Columns and height
   *  are written in ONE task, under the gates armAnim/armColsAnim raise, so
   *  both interpolate instead of one snapping. */
  function remeasure(animate: boolean): void {
    const week = weekOfOpen()
    if (week === null) return
    expandReady = true
    // Arm the gate BEFORE any column write below, not merely in the same task
    // as it: this engine needs data-anim present at the moment the column
    // template's value actually changes, or grid-template-columns is not
    // transition-eligible even one statement later (SPEC "Scroll engine API"
    // — armAnim; round 5 review, overturning an earlier same-task assumption
    // a repro disproved). Only when animate: a plain resize-driven remeasure
    // (animate=false) wants no transition at all.
    if (animate) ctl.armAnim('expand')
    // Brackets applyColumns/clearColumns's read of colsAnimKind (see its own
    // declaration) to exactly this remeasure() call: set before the
    // invalidate()/applyColumns calls below that may change a column
    // template, reset to null once they're done so a LATER, unrelated
    // refill (ordinary scrolling) never reads a stale value.
    colsAnimKind = animate ? 'expand' : null
    if (pendingFill) {
      pendingFill = false
      if (pendingDetachWeek !== null) {
        // The panel leaves the old cell through day.ts's own teardown path
        // BEFORE that row's DOM is torn down by renderWeek's
        // replaceChildren(), rather than being implicitly orphaned as a
        // side effect of its ancestor's removal.
        day.detach()
        ctl.invalidate([pendingDetachWeek])   // fillRow -> applyExpansion clears its columns
        pendingDetachWeek = null
      }
      // fillRow -> applyExpansion -> day.expand: attaches the panel to
      // openDay's cell and writes its column template, in this same task.
      ctl.invalidate([week])
    } else {
      // A plain remeasure (resize, or a height change from the panel
      // itself): the row is already showing the right day, so just
      // refresh the template's `full`/offset instead of rebuilding it.
      const row = openRow()
      if (row !== null) applyColumns(row, week)
    }
    colsAnimKind = null
    delta = Math.max(0, day.contentHeight() - ctl.rowHeight())
    ctl.setExpanded({ week, delta }, animate)
  }

  /** ALWAYS deferred by a frame, and this is load-bearing, not a tidy-up: the
   *  height-change signal originates inside `place()` (fillRow -> applyExpansion
   *  -> day.expand -> refresh), and `setExpanded` calls `place()`. Measuring
   *  synchronously would re-enter `place()` from inside its own row loop. The
   *  frame breaks that chain and coalesces a burst of height changes into one
   *  expansion — the same pattern the cache-change repaint already uses.
   *
   *  Note this chain still recurses ONCE, harmlessly: the pendingFill branch's
   *  own `ctl.invalidate` above runs day.expand -> refresh -> onHeightChange,
   *  which calls back in here while heightRaf is already 0 (cleared just
   *  before `remeasure` was invoked), so it schedules one more frame. That
   *  next call finds `pendingFill` already false and takes the cheap branch,
   *  so the recursion is exactly one extra, idle frame — not a loop. */
  function scheduleRemeasure(animate: boolean): void {
    if (heightRaf !== 0) return
    heightRaf = requestAnimationFrame(() => { heightRaf = 0; remeasure(animate) })
  }

  function openDayAt(d: DayNumber): void {
    if (openDay === d) return
    const prev = weekOfOpen()
    const week = state.weekOf(d)
    // expandReady starts false and is set true inside remeasure's pendingFill
    // branch, in the SAME task as the invalidate that writes the template —
    // never here, which is what the round-1 fix is about (see remeasure).
    expandReady = false
    openDay = d
    delta = 0
    pendingFill = true
    pendingDetachWeek = prev !== null && prev !== week ? prev : null   // one day open at a time
    scheduleRemeasure(true)
  }

  function closeDay(): void {
    if (openDay === null) return
    const row = openRow()
    day.beginCollapse()
    openDay = null                      // before setExpanded: onExpandEnd reads it
    expandReady = false
    delta = 0
    // Arm BEFORE clearing the template, not merely in the same task as it —
    // the same rule as remeasure() above, and verified to matter here too
    // (round 5 review): being in the same task as setExpanded's own
    // setAnim call is not enough, because the column value has already
    // reached its target (the rest state) by the time that call runs.
    // colsBackToRest only ever checked the FINAL value, which a snap also
    // reaches — it passed on every prior round even while this genuinely
    // snapped instead of animating, confirmed by sampling mid-collapse.
    ctl.armAnim('collapse')
    // Brackets clearColumns's read of colsAnimKind to exactly this call,
    // same reasoning as remeasure() (see colsAnimKind's own declaration).
    colsAnimKind = 'collapse'
    if (row !== null) clearColumns(row)
    colsAnimKind = null
    ctl.setExpanded(null, true)         // onExpandEnd detaches and repaints the row
  }

  const ctl = scroll.mount(scroller, {
    fillRow: (node, week, rowH) => {
      render.renderWeek(node, week, state.spansForWeek(week), rowH)
      applyExpansion(node, week)
    },
    mondayOf: week => state.dayAt(week, MON),
    weekOf: day => state.weekOf(day),
    onDock: week => {
      // CORRECTION: onDock reports the week at the viewport centre, and ~6.5
      // weeks are visible — so the header window is centred on the dock,
      // not anchored to it (the brief's `[week, week+6]` names a window
      // shifted three weeks below what is actually on screen).
      render.renderRange(range, asWeek(week - 3), asWeek(week + 3))
      state.savePrefs({ ...state.prefs(), lastDockedDay: state.dayAt(week, MON) })
    },
    onExpandEnd: () => {
      if (openDay !== null) return
      // The collapse is over: drop the panel and repaint the row it was in.
      const stale = scroller.querySelector<HTMLElement>('.day[data-open]')
      day.detach()
      stale?.removeAttribute('data-open')
      ctl.invalidate()
    },
    onRangeChange: (first, last) => {
      // SPEC: months load as weeks come within ~8 weeks of the viewport, both ways.
      // Only when the range actually moves: place() reports it on every
      // repaint, and a repaint is what a cache change triggers. Without this
      // guard a signed-out session loops — error → notify → invalidate →
      // place → onRangeChange → ensureMonthsFor refetches the error month →
      // error … — as one unbroken microtask chain that starves the renderer.
      if (first === lastRange.first && last === lastRange.last) return
      lastRange = { first, last }
      const weeks: WeekIndex[] = []
      for (let w = first - 8; w <= last + 8; w++) weeks.push(asWeek(w))
      state.ensureMonthsFor(weeks)
    },
  })

  ctl.setSnapStep(30)
  ctl.goToWeek(state.weekOf(state.today()), false)

  day.configure({
    toast: chrome.toast,
    onHeightChange: () => scheduleRemeasure(true),
    onFormClosed: () => releaseHeldRepaint(),
  })

  // Taps are read from the pointer sequence, not `click`: scroll.ts captures the
  // pointer, which retargets click to the scroller. elementFromPoint at the press
  // point is the hit test CONVENTIONS demands anyway.
  let tapX = 0, tapY = 0
  let tapCell: HTMLElement | null = null
  scroller.addEventListener('pointerdown', e => {
    tapX = e.clientX; tapY = e.clientY
    const hit = document.elementFromPoint(e.clientX, e.clientY)
    // Backstop, not the mechanism: day.ts's own pointerdown stopPropagation
    // is what actually keeps a panel press from ever reaching this listener.
    // Kept anyway as defence in depth against a future panel control that
    // forgets to stop it.
    tapCell = hit?.closest('.dp') != null ? null : hit?.closest<HTMLElement>('.day') ?? null
  })
  scroller.addEventListener('pointerup', e => {
    const cell = tapCell
    tapCell = null
    if (cell === null) return
    if (Math.hypot(e.clientX - tapX, e.clientY - tapY) > TAP_SLOP) return   // a drag
    const raw = Number(cell.dataset['day'])
    if (!Number.isFinite(raw)) return
    if (openDay === raw) return               // tapping the open day keeps it open
    openDayAt(asDay(raw))
  })

  // Escape collapses. Scrolling does NOT (SPEC): nothing in the scroll path
  // touches openDay, which is what the harness asserts rather than this comment.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    // Escape unwinds one layer at a time: the form first, then the expansion.
    if (day.isFormOpen()) { e.preventDefault(); day.closeForm(); return }
    if (openDay === null) return
    e.preventDefault()
    closeDay()
  })

  // The panel's natural height is width-dependent, so a resize re-derives the delta.
  window.addEventListener('resize', () => { if (openDay !== null) scheduleRemeasure(false) })

  // ---- year view: mounted lazily on first toggle ----
  let yearCtl: year.YearController | null = null
  let shownYear = dayToCivil(state.today()).y
  const inYear = () => !yearRoot.hidden

  function showYear(on: boolean): void {
    yearRoot.hidden = !on
    scroller.hidden = on
    modeBtn.textContent = on ? 'Cal' : 'Year'
    modeBtn.setAttribute('aria-pressed', String(on))
    prevY.hidden = !on
    nextY.hidden = !on
    if (on) range.textContent = String(shownYear)
    // Returning to the calendar: the scroller was hidden (clientHeight 0)
    // for however long the year view was open, so scroll.ts's own cached
    // row height may now be stale if the window was resized during that
    // time (its measure() bails on a hidden root rather than trusting a
    // zero reading — scroll.ts, round 5 review). A synthetic 'resize' is
    // the least-invasive way to reach that EXISTING, already-documented
    // listener with the scroller visible again, rather than adding a new
    // public method for what is, from scroll.ts's side, exactly the event
    // it already knows how to handle.
    if (!on) window.dispatchEvent(new Event('resize'))
  }
  const step = (d: number) => { shownYear += d; yearCtl?.setYear(shownYear); range.textContent = String(shownYear) }
  prevY.addEventListener('click', () => step(-1))
  nextY.addEventListener('click', () => step(1))
  modeBtn.addEventListener('click', () => {
    const toYear = !inYear()
    showYear(toYear)
    if (toYear && yearCtl === null) {
      // Mounted AFTER unhiding so columnsFor sees a real clientWidth.
      yearCtl = year.mount(yearRoot, { onPickDay: d => {
        // Clicking a day returns to the calendar on that day (SPEC "Year view").
        showYear(false)
        ctl.goToWeek(state.weekOf(d), false)   // onDock restores the range label
      } })
    }
  })

  // SPEC "Layout details": Today goes to today WITHOUT changing the view —
  // the calendar scrolls and re-snaps; the year view pages back to this year.
  todayBtn.addEventListener('click', () => {
    if (inYear()) {
      shownYear = dayToCivil(state.today()).y
      yearCtl?.setYear(shownYear)
      range.textContent = String(shownYear)
    } else {
      ctl.goToWeek(state.weekOf(state.today()), true)
    }
  })

  // A full refill is 14 fillRow calls — cheaper than mapping month keys to
  // weeks. The year view filters by year before repainting (SPEC "Year view").
  // Coalesced to one repaint per frame: opening a range starts a dozen month
  // fetches, each of which notifies as it flips to 'loading'.
  let repaint = 0
  let yearDirty = false
  state.onCacheChange(months => {
    if (months.some(k => k.startsWith(`${shownYear}-`))) yearDirty = true
    if (repaint !== 0) return
    repaint = requestAnimationFrame(() => {
      repaint = 0
      // CONVENTIONS transient-UI rule: a background refresh must never wipe an
      // open form. The repaint is HELD, not dropped — it runs when the form closes.
      if (day.isFormOpen()) { heldRepaint = true; return }
      ctl.invalidate()
      if (inYear() && yearDirty) yearCtl?.invalidate()
      yearDirty = false
    })
  })

  /** Task 7 calls this from the form's close path; declared here because main.ts
   *  owns the repaint it is releasing. */
  function releaseHeldRepaint(): void {
    if (!heldRepaint) return
    heldRepaint = false
    ctl.invalidate()
  }

  if (import.meta.env.DEV) {
    // STAGE 02 HARNESS — deleted in stage 05, which builds the real first-run screen.
    // GIS needs real user activation, which a devtools call does not have, so the gate
    // needs a button that a human actually clicks.
    const status = document.createElement('p')
    status.id = 'harness-status'
    const connect = document.createElement('button')
    connect.id = 'harness-connect'
    connect.textContent = 'Connect Google Calendar'
    const paint = () => { status.textContent = auth.isSignedIn() ? 'Connected' : 'Not connected' }
    connect.addEventListener('click', () => {
      status.textContent = 'Connecting…'
      void auth.signIn().then(paint, (e: Error) => { status.textContent = `Sign-in failed: ${e.message}` })
    })
    const out = document.createElement('button')
    out.id = 'harness-signout'
    out.textContent = 'Sign out'
    out.addEventListener('click', () => { void auth.signOut().then(paint) })
    const bar = document.createElement('div')
    bar.id = 'devbar'
    bar.append(connect, out, status)
    document.body.append(bar)
    paint()
    // why: augmenting window for a dev-only console handle, without widening the global type
    ;(window as unknown as { bramwell: unknown }).bramwell = { auth, gcal, categories, state, applyTheme, ctl, day }
    // A quiet renewal on load is what the gate's "reload, no popup" criterion exercises.
    void auth.getToken().then(paint, paint)
  }
}
