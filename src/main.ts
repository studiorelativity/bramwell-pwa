// STAGE 02 — bootstrapping and wiring; owns the theme <style>.
import './style.css'
import './motion.css'
import * as auth from './auth.ts'
import * as categories from './categories.ts'
import * as gcal from './gcal.ts'
import * as render from './render.ts'
import * as scroll from './scroll.ts'
import * as state from './state.ts'
import * as year from './year.ts'
import { asOffset, asWeek, dayToCivil } from './dates.ts'
import type { WeekIndex } from './types.ts'

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
  const ctl = scroll.mount(scroller, {
    fillRow: (node, week, rowH) => render.renderWeek(node, week, state.spansForWeek(week), rowH),
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
    onExpandEnd: () => {},   // TEMPORARY: Task 6 replaces this with the real body.
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
      ctl.invalidate()
      if (inYear() && yearDirty) yearCtl?.invalidate()
      yearDirty = false
    })
  })

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
    ;(window as unknown as { bramwell: unknown }).bramwell = { auth, gcal, categories, state, applyTheme }
    // A quiet renewal on load is what the gate's "reload, no popup" criterion exercises.
    void auth.getToken().then(paint, paint)
  }
}
