// STAGE 02 — bootstrapping and wiring; owns the theme <style>.
import './style.css'
import './motion.css'
import * as auth from './auth.ts'
import * as categories from './categories.ts'
import * as gcal from './gcal.ts'
import * as render from './render.ts'
import * as scroll from './scroll.ts'
import * as state from './state.ts'
import { asOffset, asWeek } from './dates.ts'
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
      // CORRECTION: onDock reports the week at the viewport centre, and ~6.5
      // weeks are visible — so the header window is centred on the dock,
      // not anchored to it (the brief's `[week, week+6]` names a window
      // shifted three weeks below what is actually on screen).
      render.renderRange(range, asWeek(week - 3), asWeek(week + 3))
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
  // the calendar scrolls and re-snaps; the year view (task 9) pages back to
  // this year instead. Only the calendar-only behaviour is wired here — task
  // 9 introduces the year container/controller and branches this handler on
  // view mode. `modeBtn` is created (the header's shape is this task's job)
  // but intentionally left without a click handler for now.
  todayBtn.addEventListener('click', () => ctl.goToWeek(state.weekOf(state.today()), true))
  // A full refill is 14 fillRow calls — cheaper than mapping month keys to weeks.
  state.onCacheChange(() => ctl.invalidate())

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
