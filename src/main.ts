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
  /** False for the one frame between attaching the panel and the first measure.
   *  A CSS transition interpolates from the style at the LAST recalc, so the
   *  column template has to change in the same task as the height — write it a
   *  frame early and the columns snap while the height animates. */
  let expandReady = false
  /** A pointer that travels further than this was a drag, not a tap. */
  const TAP_SLOP = 6

  const weekOfOpen = (): WeekIndex | null => openDay === null ? null : state.weekOf(openDay)
  const openRow = (): HTMLElement | null =>
    scroller.querySelector<HTMLElement>('.day[data-open]')?.closest<HTMLElement>('.week') ?? null

  function clearColumns(node: HTMLElement): void {
    node.style.removeProperty('grid-template-columns')
    node.removeAttribute('data-full')
    node.querySelector<HTMLElement>('.bars')?.style.removeProperty('grid-template-columns')
  }

  function applyColumns(node: HTMLElement, week: WeekIndex): void {
    if (openDay === null || !expandReady || state.weekOf(openDay) !== week) { clearColumns(node); return }
    const full = window.innerWidth <= render.PHONE_MAX_W
    const cols = render.columnsFor(asOffset(openDay - state.dayAt(week, MON)), full)
    // Set on the row AND its bar overlay so the two interpolate in lockstep
    // rather than relying on an inherited value mid-transition.
    node.style.gridTemplateColumns = cols
    const bars = node.querySelector<HTMLElement>('.bars')
    if (bars !== null) bars.style.gridTemplateColumns = cols
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

  /** The delta comes from scroll's own rowHeight, never from a DOM read — mid
   *  animation a measured row height is an interpolated one. Columns and height
   *  are written in ONE task, under the data-anim gate setExpanded raises, so
   *  both interpolate instead of one snapping. */
  function remeasure(animate: boolean): void {
    const week = weekOfOpen()
    if (week === null) return
    delta = Math.max(0, day.contentHeight() - ctl.rowHeight())
    expandReady = true
    const row = openRow()
    if (row !== null) applyColumns(row, week)
    ctl.setExpanded({ week, delta }, animate)
  }

  /** ALWAYS deferred by a frame, and this is load-bearing, not a tidy-up: the
   *  height-change signal originates inside `place()` (fillRow -> applyExpansion
   *  -> day.expand -> refresh), and `setExpanded` calls `place()`. Measuring
   *  synchronously would re-enter `place()` from inside its own row loop. The
   *  frame breaks that chain and coalesces a burst of height changes into one
   *  expansion — the same pattern the cache-change repaint already uses. */
  function scheduleRemeasure(animate: boolean): void {
    if (heightRaf !== 0) return
    heightRaf = requestAnimationFrame(() => { heightRaf = 0; remeasure(animate) })
  }

  function openDayAt(d: DayNumber): void {
    if (openDay === d) return
    const prev = weekOfOpen()
    const week = state.weekOf(d)
    // Moving within one week keeps the row expanded, so the columns animate from
    // the old pick to the new one instead of collapsing and rebuilding.
    expandReady = prev !== null && prev === week
    openDay = d
    delta = 0
    if (prev !== null && prev !== week) { day.detach(); ctl.invalidate([prev]) }  // one day open at a time
    ctl.invalidate([week])              // fillRow -> applyExpansion -> day.expand
    scheduleRemeasure(true)
  }

  function closeDay(): void {
    if (openDay === null) return
    const row = openRow()
    day.beginCollapse()
    openDay = null                      // before setExpanded: onExpandEnd reads it
    expandReady = false
    delta = 0
    // Clearing the template in the same task as setExpanded is what makes the
    // columns animate BACK rather than snap at the end of the collapse.
    if (row !== null) clearColumns(row)
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
