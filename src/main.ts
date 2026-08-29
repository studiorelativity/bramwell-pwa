// STAGE 02 — bootstrapping and wiring; owns the theme <style>.
import './style.css'
import './motion.css'
import * as auth from './auth.ts'
import * as categories from './categories.ts'
import * as gcal from './gcal.ts'
import * as state from './state.ts'

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
} else if (import.meta.env.DEV) {
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
  app.replaceChildren(connect, out, status)
  paint()
  // why: augmenting window for a dev-only console handle, without widening the global type
  ;(window as unknown as { bramwell: unknown }).bramwell = { auth, gcal, categories, state, applyTheme }
  // A quiet renewal on load is what the gate's "reload, no popup" criterion exercises.
  void auth.getToken().then(paint, paint)
} else {
  app.textContent = 'Bramwell'
}
