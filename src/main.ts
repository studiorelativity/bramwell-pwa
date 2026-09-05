// STAGE 02 — bootstrapping and wiring; owns the theme <style>.
import './style.css'
import './motion.css'
import * as auth from './auth.ts'
import * as categories from './categories.ts'
import * as chrome from './chrome.ts'
import * as day from './day.ts'
import * as render from './render.ts'
import * as scroll from './scroll.ts'
import * as state from './state.ts'
import * as year from './year.ts'
import { addDays, asDay, asOffset, asWeek, dayToCivil, monthKey } from './dates.ts'
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
  // Centred on the header by CSS, so it is not a flex sibling competing with
  // the range label for space (SPEC "Layout details").
  const title = document.createElement('span')
  title.className = 'hdr-title'
  title.textContent = 'Bramwell'
  const avatar = document.createElement('span')
  avatar.className = 'hdr-avatar'          // filled by chrome.ts (avatar, reconnect pill, or nothing)
  // Year steppers — header, year view only (SPEC "Layout details").
  const prevY = document.createElement('button'); prevY.id = 'btn-prev-year'; prevY.textContent = '‹'
  const nextY = document.createElement('button'); nextY.id = 'btn-next-year'; nextY.textContent = '›'
  prevY.hidden = true; nextY.hidden = true
  // SPEC order: range, steppers, toggle, Today, avatar.
  hdr.append(range, prevY, nextY, spacer, title, modeBtn, todayBtn, avatar)

  const scroller = document.createElement('div')
  scroller.className = 'scroller'
  const yearRoot = document.createElement('div')
  yearRoot.className = 'yearview'
  yearRoot.hidden = true
  app.replaceChildren(hdr, scroller, yearRoot)

  const MON = asOffset(0)
  let lastRange = { first: NaN, last: NaN }

  /** The FAB's anchor in the calendar view (DECISIONS: mid-week day of the
   *  docked week). Local, not read back from prefs — lastDockedDay is written
   *  at dock and never read at launch (SPEC "Settings"). */
  let dockedWeek: WeekIndex = state.weekOf(state.today())

  /** DECISIONS: warmCache is computed from monthState over the render window.
   *  `ready` alone is not enough: a warm start loads months as `ready` from
   *  localStorage and then flips them to `loading`/`error` as the stale-token
   *  refresh fails — and the first-run screen must NEVER cover a warm cache
   *  (SPEC). Both of those states KEEP the prior events, so events-on-screen is
   *  the durable signal. A genuinely empty cached month reads as cold; recorded
   *  in verification.md as a known edge. */
  function warmCache(): boolean {
    if (!Number.isFinite(lastRange.first)) return false
    for (let w = lastRange.first; w <= lastRange.last; w++) {
      const mon = state.dayAt(asWeek(w), MON)
      for (const k of [monthKey(mon), monthKey(addDays(mon, 6))]) {
        const s = state.monthState(k)
        if (s === 'ready') return true
        if ((s === 'loading' || s === 'error') && state.eventsForMonth(k).length > 0) return true
      }
    }
    return false
  }

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
    // Armed on this ONE node — the row whose columns are about to clear —
    // never the pool: armAnim's pool-wide reach is for data-anim
    // (transform/height/column-gap), a different gate (SPEC "Scroll engine
    // API"). colsAnimKind is null for an unrelated refill (ordinary
    // recycling also reaches here), so most calls arm nothing.
    if (colsAnimKind !== null) ctl.armColsAnim(node, colsAnimKind)
    node.style.removeProperty('--expand-cols')
    node.removeAttribute('data-full')
    // .bars is NOT written here: its CSS is `grid-template-columns: inherit`
    // (style.css), so it already reads back to 7-equal the instant .week's
    // own property is removed — nothing to clear.
  }

  function applyColumns(node: HTMLElement, week: WeekIndex): void {
    if (openDay === null || !expandReady || state.weekOf(openDay) !== week) { clearColumns(node); return }
    const full = window.innerWidth <= render.PHONE_MAX_W
    const cols = render.columnsFor(asOffset(openDay - state.dayAt(week, MON)), full)
    // Written to the --expand-cols CUSTOM property, not grid-template-columns
    // itself: this Chrome build does not transition grid-template-columns
    // when it is set directly via inline style — the computed value jumps
    // straight to the new one, no interpolation, even with a correct gate,
    // transition-duration, and matching track-sizing function (confirmed in
    // isolation: an inline `el.style.gridTemplateColumns = ...` snaps;
    // toggling a CLASS that changes the same property, or writing a custom
    // property the CSS rule reads with var(), both interpolate). style.css's
    // rule is `grid-template-columns: var(--expand-cols, repeat(7, minmax(0,
    // 1fr)))`, so the property that's actually declared to transition is
    // never itself touched by JS.
    // Written ONLY on .week. .bars inherits the RESULT (style.css's `inherit`
    // reads .week's computed grid-template-columns, not --expand-cols) rather
    // than getting its own copy: inheritance resolves from .week's COMPUTED
    // value every frame, so a freshly-created .bars (renderWeek makes a new
    // one on every fill) tracks .week's in-flight transition immediately,
    // with nothing of its own to snap — writing the same value directly to a
    // brand-new node has no before-change style to interpolate FROM.
    // Despite all of this, the app's own grid-template-columns still does
    // not visibly interpolate — a known, unexplained gap (SPEC "Scroll
    // engine API").
    // Armed on this ONE node before the write, same reasoning as
    // clearColumns above — never via armAnim's pool loop.
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
      // The panel is attached by the invalidate above, so openAdd's precondition
      // (its day is the one shown) now holds. Called BEFORE the contentHeight
      // read below, so the first expansion is already sized for the open form
      // instead of growing again a frame later.
      if (pendingOpenAdd !== null && pendingOpenAdd === openDay) {
        const d = pendingOpenAdd
        pendingOpenAdd = null
        day.openAdd(d)
      }
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
   *  Note this chain still recurses ONCE, and that extra frame is not idle:
   *  the pendingFill branch's own `ctl.invalidate` above runs day.expand ->
   *  refresh -> onHeightChange, which calls back in here while heightRaf is
   *  already 0 (cleared just before `remeasure` was invoked), so it schedules
   *  one more frame. That next call finds `pendingFill` already false and
   *  takes the cheap branch — but the cheap branch still re-runs `remeasure`
   *  in full: it re-arms the gate (`ctl.armAnim`), reapplies the column
   *  template, and calls `ctl.setExpanded` again, which sweeps `data-anim`/
   *  `data-jump` across the whole 14-row pool a second time. So the
   *  recursion is exactly one extra frame that does real, bounded work — not
   *  a loop, and not a no-op either. */
  function scheduleRemeasure(animate: boolean): void {
    if (heightRaf !== 0) return
    heightRaf = requestAnimationFrame(() => { heightRaf = 0; remeasure(animate) })
  }

  function openDayAt(d: DayNumber): void {
    if (openDay === d) return
    // A held background repaint (see releaseHeldRepaint below) is bound to
    // the day that was open when it landed, not to the form specifically —
    // switching away from that day abandons whatever form it held just as
    // surely as closing the form does, and day.ts's own dropForm() (called
    // from expand()'s dayChanged branch, a few frames below this) fires no
    // callback of its own to release it. Released HERE, before openDay
    // changes, rather than from inside day.ts's dropForm: dropForm also
    // runs mid-way through openForm() replacing one form with another, and
    // releasing from there would run a full ctl.invalidate() in that
    // window for no reason tied to abandoning a day.
    releaseHeldRepaint()
    const prev = weekOfOpen()
    const week = state.weekOf(d)
    // expandReady starts false and is set true inside remeasure's pendingFill
    // branch, in the SAME task as the invalidate that writes the template —
    // never here, which is what the round-1 fix is about (see remeasure).
    expandReady = false
    openDay = d
    delta = 0
    // Any change of the open day disarms a pending add: the day it was armed
    // for is no longer the day that will be shown. Without this, a FAB tap
    // interrupted by a plain tap on another day leaves pendingOpenAdd armed
    // for the FAB's day, and a LATER ordinary tap back onto that day pops the
    // add form uninvited (review finding, task 6).
    pendingOpenAdd = null
    pendingFill = true
    pendingDetachWeek = prev !== null && prev !== week ? prev : null   // one day open at a time
    scheduleRemeasure(true)
  }

  function closeDay(): void {
    if (openDay === null) return
    pendingOpenAdd = null
    // See openDayAt's comment: collapsing the day abandons any form it was
    // holding a repaint for, same as switching days does. Escape always
    // closes the form first (day.isFormOpen() above), which already
    // releases via onFormClosed — this covers closeDay reached any other
    // way, and is a no-op if the release already happened.
    releaseHeldRepaint()
    const row = openRow()
    day.beginCollapse()
    openDay = null                      // before setExpanded: onExpandEnd reads it
    expandReady = false
    delta = 0
    // colsAnimKind is set BEFORE armAnim, not after: setAnim's first
    // statement can cancel a PENDING expand timer synchronously (Escape
    // pressed mid-expand, before the expand's own animTimer has fired), and
    // that cancellation fires onExpandEnd() right here, synchronously,
    // before the next line ever runs — which does a full ctl.invalidate()
    // -> applyColumns -> clearColumns for every row while openDay is
    // already null. If colsAnimKind is not already 'collapse' by then, that
    // cascade clears --expand-cols ungated, and the interrupted expand's
    // columns cannot animate closed no matter what runs afterward.
    colsAnimKind = 'collapse'
    ctl.armAnim('collapse')
    if (row !== null) clearColumns(row)
    colsAnimKind = null
    ctl.setExpanded(null, true)         // onExpandEnd detaches and repaints the row
  }

  /** Armed only by addHere, for the one day it just opened. Disarmed by
   *  openDayAt on any OTHER change of the open day (including one that
   *  interrupts the very open this armed), so it cannot survive to fire on a
   *  later, unrelated tap. Consumed by the first remeasure that finds it
   *  matching openDay, in the SAME task as the invalidate that attaches the
   *  panel. day.openAdd is documented to do nothing unless its day is already
   *  shown. */
  let pendingOpenAdd: DayNumber | null = null

  /** DECISIONS "FAB date": calendar → mid-week day of the docked week; year → today. */
  function fabDay(): DayNumber {
    return inYear() ? state.today() : state.dayAt(dockedWeek, asOffset(3))
  }

  function addHere(): void {
    // fabDay() is read BEFORE any view switch below: in the year view the anchor
    // is today, and leaving the year view first would make it read the calendar's
    // docked week instead (DECISIONS "FAB date").
    const d = fabDay()
    if (inYear()) {
      showYear(false)
      ctl.goToWeek(state.weekOf(d), false)   // the year's anchor is off-screen here
    }
    if (openDay === d) { day.openAdd(d); return }
    openDayAt(d)        // clears pendingOpenAdd as its first act, so...
    pendingOpenAdd = d  // ...only THIS call arms it, and only for this day
  }

  const ctl = scroll.mount(scroller, {
    fillRow: (node, week, rowH) => {
      render.renderWeek(node, week, state.spansForWeek(week), rowH)
      applyExpansion(node, week)
    },
    mondayOf: week => state.dayAt(week, MON),
    weekOf: day => state.weekOf(day),
    onDock: week => {
      dockedWeek = week
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

  ctl.setSnapStep(state.prefs().snapStepDays ?? 30)
  ctl.goToWeek(state.weekOf(state.today()), false)

  const chromeCtl = chrome.mount(app, {
    avatarSlot: avatar,
    warmCache,
    setSnapStep: step => ctl.setSnapStep(step),
    addHere,
    // Clearing the auth gate is only half the recovery: onRangeChange
    // short-circuits while the range is unchanged, so without resetting
    // lastRange nothing would ever ask for the suppressed months again.
    onConnected: () => {
      lastRange = { first: NaN, last: NaN }
      ctl.invalidate()
    },
    onPrefsChanged: () => {
      applyTheme()
      ctl.invalidate()
      yearCtl?.invalidate()
    },
    // Symmetric with day.ts's onFormClosed below: releaseHeldRepaint is a safe
    // no-op when nothing is held, and re-runs syncConnection so auth checked
    // behind a closed sheet is not lost.
    onSheetClosed: () => releaseHeldRepaint(),
  })

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

  // SPEC "Layout details": `n` opens the form on the centred date, ignored inside
  // inputs or with a day open. No modifier, so it cannot eat a browser shortcut.
  document.addEventListener('keydown', e => {
    if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return
    const t = e.target
    if (t instanceof HTMLElement && (t.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
    if (openDay !== null) return
    if (chromeCtl.isSheetOpen()) return   // the sheet is transient UI; n must not fire behind it
    if (!chromeCtl.isConnected()) return  // n is the FAB's keyboard twin; gate on the same fact
    e.preventDefault()
    addHere()
  })

  // The panel's natural height is width-dependent, so a resize re-derives the delta.
  window.addEventListener('resize', () => { if (openDay !== null) scheduleRemeasure(false) })

  // ---- year view: mounted lazily on first toggle ----
  let yearCtl: year.YearController | null = null
  let shownYear = dayToCivil(state.today()).y
  const inYear = () => !yearRoot.hidden

  function showYear(on: boolean): void {
    // Leaving the calendar collapses any open day, and this is load-bearing,
    // not tidiness. The expansion is calendar state; carried into the year
    // view it leaves TWO owners of the scroll position. showYear(false)'s own
    // synthetic resize below schedules a remeasure (the resize listener fires
    // whenever openDay !== null), which lands a frame LATER than
    // onPickDay's goToWeek and runs setExpanded -> fitY to keep the OLD
    // expanded row on screen — silently reverting the jump. Observed: picking
    // a day six months out set the header to the new range (onDock had fired)
    // while the calendar sat at the old position, with the stale day still
    // open. Collapsing on the way OUT removes the second owner at its source,
    // rather than making each future caller of goToWeek remember to close
    // first. SPEC's expansion rules ("one day open at a time", Escape
    // collapses, scrolling does not force-collapse) are silent on view
    // switches; a day expanded in a view you have left is not one of them.
    if (on) closeDay()
    if (!on) yearCtl?.exitMode()   // leaving the year view exits paint/erase mode (SPEC "Planning layer")
    yearRoot.hidden = !on
    scroller.hidden = on
    modeBtn.textContent = on ? 'Month' : 'Year'
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
  function openYear(): void {
    showYear(true)
    if (yearCtl === null) {
      // Mounted AFTER unhiding so columnsFor sees a real clientWidth.
      yearCtl = year.mount(yearRoot, { onPickDay: d => {
        // Clicking a day returns to the calendar ON that day (SPEC "Year view")
        // — positioned at its week AND expanded. Scrolling to the week alone
        // left the picked day indistinguishable from its six neighbours, which
        // reads as the pick not having taken.
        //
        // Order is load-bearing. goToWeek is synchronous and settles the week;
        // openDayAt defers its real work to a rAF, and the setExpanded that
        // follows runs fitY to keep the expanded row on screen. Both now want
        // the SAME week, so fitY refines the position instead of fighting it —
        // the opposite of the stale-expansion case showYear(true) collapses at
        // its source, where fitY was holding a row from a week nobody asked for.
        showYear(false)
        ctl.goToWeek(state.weekOf(d), false)   // onDock restores the range label
        openDayAt(d)
      }, toast: chrome.toast })
    }
  }
  modeBtn.addEventListener('click', () => {
    if (inYear()) showYear(false)
    else openYear()
  })

  // SPEC "Settings": defaultView IS read at launch, unlike lastDockedDay.
  if (state.prefs().defaultView === 'year') openYear()

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
      // open form. The repaint is HELD, not dropped — it runs when the form
      // closes (day.ts's closeForm -> onFormClosed), or the moment the shown
      // day is abandoned by switching or collapsing (openDayAt/closeDay,
      // below), whichever comes first. dropForm() alone — reached from
      // day.expand's dayChanged branch and from detach() — fires neither
      // callback, which is why the release also lives at the two main.ts
      // call sites that reach it, not only in day.ts.
      // CONVENTIONS: a background refresh must never destroy transient UI. The
      // settings sheet obeys the same rule as the form (DECISIONS).
      if (day.isFormOpen() || chromeCtl.isSheetOpen()) { heldRepaint = true; return }
      // A cache change is also how a withToken failure deep inside state.ts
      // reaches the pill: there is no auth event to subscribe to.
      chromeCtl.syncConnection()
      ctl.invalidate()
      if (inYear() && yearDirty) yearCtl?.invalidate()
      yearDirty = false
    })
  })

  /** Called from day.ts's close path (via onFormClosed) AND from main.ts's own
   *  openDayAt/closeDay, whichever tears the form down first — declared here
   *  because main.ts owns the repaint it is releasing. Safe to call more than
   *  once or when nothing is held: the guard makes every call after the first
   *  a no-op. */
  function releaseHeldRepaint(): void {
    if (!heldRepaint) return
    heldRepaint = false
    chromeCtl.syncConnection()
    ctl.invalidate()
  }

  // Quiet renewal on load. Real behaviour, not a harness: its outcome is what
  // decides first-run vs the reconnect pill, and its failure is what arms
  // state.ts's auth gate. A signed-out phone cannot recover from here — the
  // popup needs a gesture — so the pill and Connect are the only ways back.
  void auth.getToken().then(
    () => {
      state.clearAuthGate()
      chromeCtl.syncConnection()
      // Re-arm the window the gate suppressed while the renewal was in flight.
      lastRange = { first: NaN, last: NaN }
      ctl.invalidate()
    },
    () => { chromeCtl.syncConnection() },
  )

  // SPEC "PWA": production only. Headless Chrome hangs on registration
  // (CONVENTIONS), which is the other reason this never runs in dev.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js') })
  }

  if (import.meta.env.DEV) {
    // The DEV console seam scripts/shot.mjs drives. NOT a harness UI: #devbar and
    // the #harness-* buttons were deleted this stage, because the real first-run
    // screen is what they stood in for. Kept because shot.mjs reads `ctl` and
    // `day` directly (shot.mjs:429-430) and has no other way in. `addHere` is
    // exposed too: the FAB is disabled in every connection state the harness can
    // reach (headless Chrome cannot be signed in), so a synthetic click on it
    // exercises no real code path — a synthetic call to `addHere` here exercises
    // the pendingOpenAdd disarm logic through a route a real pointer can actually
    // reach once signed in. Same justification as `openSheet()` on
    // ChromeController. Stripped from production builds.
    // why: augmenting window for a dev-only test seam, without widening the global type
    ;(window as unknown as { bramwell: unknown }).bramwell = { ctl, day, chrome: chromeCtl, addHere }
  }
}
