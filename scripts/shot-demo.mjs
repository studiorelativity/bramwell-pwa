// scripts/shot-demo.mjs — headless evidence for the stage-06 (demo) gate.
// Same CDP driver as shot.mjs, but deliberately WITHOUT its localStorage seed
// script: demo is the cold-profile path, and the gate's own wording is "in a
// private window". A fresh --user-data-dir per run is that private window.
//
// Network is captured for the whole run (Network.enable before the first
// navigation) so "zero requests to googleapis.com" is measured, not inferred.
// Every "this control works" field is an elementFromPoint hit at the control's
// centre (CONVENTIONS); element.click() is used only to ACT after the hit is
// recorded, never as the evidence.
//
// PORT: derived by whoever runs this, never assumed — several vite servers run
// on this machine (see shot.mjs's own note):
//   npm run dev >/tmp/bramwell-dev.log 2>&1 &
//   P=$(grep -oE 'localhost:[0-9]+' /tmp/bramwell-dev.log | head -1 | cut -d: -f2)
//   PORT=$P npm run shot:demo
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (process.env.PORT === undefined) { console.error('PORT is required (derive it from the dev server output)'); process.exit(2) }
const ORIGIN = `http://localhost:${process.env.PORT}`
const SHOT_DIR = process.env.SHOT_DIR ?? tmpdir()
const DEMO_MESSAGE = 'Demo — connect your Google Calendar to save.'

// ---- driver ----
const port = 9300 + Math.floor(Math.random() * 500)
const udd = mkdtempSync(`${tmpdir()}/shot-demo-`)
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--no-first-run',
  '--no-default-browser-check', `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore' })
process.on('exit', () => { try { chrome.kill('SIGKILL') } catch {} rmSync(udd, { recursive: true, force: true }) })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let page
for (let i = 0; i < 100 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page') } catch {}
  if (!page) await sleep(100)
}
if (!page) { console.error('no page target'); process.exit(3) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0; const pend = new Map(); let loaded = false
const requests = []
const exceptions = []
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
  if (m.method === 'Page.loadEventFired') loaded = true
  if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url)
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
}
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)
  return r.result?.result?.value
}
async function nav(url, settleMs = 1200) {
  loaded = false
  await send('Page.navigate', { url })
  for (let i = 0; i < 100 && !loaded; i++) await sleep(100)
  await sleep(settleMs)
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${SHOT_DIR}/${name}.png`, Buffer.from(r.result.data, 'base64'))
}
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')

// CONVENTIONS: a control "works" only if elementFromPoint at its centre resolves to it.
const HIT = `(sel) => {
  const el = document.querySelector(sel)
  if (el === null) return { found: false }
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return { found: true, sized: false }
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return { found: true, sized: true, hits: hit !== null && (hit === el || el.contains(hit)), disabled: el.disabled === true }
}`

const STORAGE = `(() => { try { return { length: localStorage.length, keys: Object.keys(localStorage) } } catch (e) { return { error: String(e) } } })()`

/** Probe 1: /?demo is populated, the pill and a Settings avatar are hit-testable, the FAB
 *  is live, the URL was scrubbed, nothing on first-run covers it. Both colour schemes. */
async function probeEntry(scheme) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
  await nav(`${ORIGIN}/?demo`)
  const r = await evalJs(`(() => {
    const HIT = ${HIT}
    const b = window.bramwell
    const fr = document.getElementById('firstrun')
    const now = b.state.today()
    const mk = d => { const t = new Date(d * 86400000); return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') }
    const yv = document.querySelector('.yearview')
    return {
      isDemo: b.state.isDemo(),
      search: location.search, path: location.pathname,
      yearVisible: yv !== null && !yv.hidden,
      hint: document.querySelector('.planhint')?.textContent ?? null,
      cells: document.querySelectorAll('.yrcell[data-day]').length,
      bars: document.querySelectorAll('.yrbar').length,
      firstRunAbsentOrHidden: fr === null || fr.hidden,
      pill: HIT('#demo-pill'), pillText: document.getElementById('demo-pill')?.textContent ?? null,
      avatar: HIT('#avatar'), avatarHasDot: document.querySelector('#avatar .set-avatar-dot') !== null,
      reconnectPresent: document.getElementById('reconnect') !== null,
      fab: HIT('#fab'),
      thisMonth: b.state.monthState(mk(now)),
      farMonth: b.state.monthState(mk(now - 900)),
      scheme: getComputedStyle(document.body).backgroundColor,
      storage: ${STORAGE},
    }
  })()`)
  await shot(`demo-${scheme}`)
  return r
}

/** Probe 2: a save in demo is refused with the demo message, before any optimistic paint.
 *  Runs in the page already entered by probeEntry (dark). */
async function probeSaveRefused() {
  return await evalJs(`(async () => {
    const HIT = ${HIT}
    const frame = () => new Promise(r => requestAnimationFrame(r))
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    // Demo opens the year (SPEC 2026-09-10). This probe is a month-view save.
    if (!document.querySelector('.yearview').hidden) document.getElementById('btn-mode').click()
    await sleep(400)
    const onScreen = c => { const r = c.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2
      return x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight && document.elementFromPoint(x, y) !== null }
    const pick = [...document.querySelectorAll('.day[data-day]')].filter(onScreen)[3] ?? null
    if (pick === null) return { ok: false, why: 'no on-screen cell' }
    const pr = pick.getBoundingClientRect()
    const o = { bubbles: true, cancelable: true, clientX: pr.left + pr.width / 2, clientY: pr.top + pr.height / 2, pointerId: 1, pointerType: 'mouse', isPrimary: true }
    pick.dispatchEvent(new PointerEvent('pointerdown', o)); pick.dispatchEvent(new PointerEvent('pointerup', o))
    let cell = null
    for (let i = 0; i < 90 && cell === null; i++) { await frame(); cell = document.querySelector('.day[data-open]') }
    if (cell === null) return { ok: false, why: 'tap did not open a day' }
    for (let i = 0; i < 40; i++) await frame()
    const evBefore = cell.querySelectorAll('.dp-ev').length
    const addHit = HIT('.dp-add')
    cell.querySelector('.dp-add').click()
    await sleep(500)
    const form = document.querySelector('.dp-form')
    if (form === null) return { ok: false, why: 'no form', addHit }
    const saveHit = HIT('.dp-save')
    const title = 'demo-probe-' + Date.now().toString(36)
    form.querySelector('.dp-title').value = title
    const barsBefore = document.querySelectorAll('.bar, .chip').length
    form.querySelector('.dp-save').click()
    // Poll frames: the toast appears in the same task the write rejects; the optimistic
    // overlay, if one ever existed, would paint in the next repaint frame.
    let toast = null, leaked = false, err = null
    for (let i = 0; i < 60; i++) {
      await frame()
      if (toast === null) toast = document.querySelector('.toast')?.textContent ?? null
      if ([...document.querySelectorAll('.bar, .chip')].some(n => n.textContent.includes(title))) leaked = true
      const e = document.querySelector('.dp-err'); if (e !== null && !e.hidden && e.textContent !== '') err = e.textContent
    }
    const stillOpen = document.querySelector('.dp-form') !== null
    const evAfter = document.querySelector('.day[data-open]')?.querySelectorAll('.dp-ev').length ?? -1
    // Close the form and the day so later probes start from rest.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await sleep(300)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await sleep(600)
    return { ok: true, addHit, saveHit, toast, toastIsDemoMessage: toast === ${JSON.stringify(DEMO_MESSAGE)}, formError: err,
      formStaysOpen: stillOpen, overlayEverPainted: leaked, evCountUnchanged: evBefore === evAfter,
      barsUnchanged: document.querySelectorAll('.bar, .chip').length === barsBefore, storage: ${STORAGE} }
  })()`)
}

/** Probe 3: the year view over the seed — 365/366 cells, the overflow day capped at three
 *  bars with its panel listing all five, and (if session A has landed) the plan strip. */
async function probeYear() {
  return await evalJs(`(async () => {
    const HIT = ${HIT}
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const modeHit = HIT('#btn-mode')
    if (document.querySelector('.yearview').hidden) document.getElementById('btn-mode').click()
    await sleep(400)
    const hintAtRest = document.querySelector('.planhint')?.textContent ?? null
    const yr = document.querySelector('.yr')
    if (yr === null) return { ok: false, why: 'no year grid' }
    const b = window.bramwell
    const overflowDay = b.state.today() + 3
    const cell = yr.querySelector('.yrcell[data-day="' + overflowDay + '"]')
    let barsOnOverflow = null, panelLists = null
    if (cell !== null) {
      const row = cell.closest('.yrrow')
      const col = [...row.querySelectorAll('.yrcell')].indexOf(cell) + 1
      barsOnOverflow = [...row.querySelectorAll('.yrbar')].filter(bar => { const [a, z] = bar.style.gridColumn.split('/').map(Number); return a <= col && z > col }).length
      cell.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      await sleep(100)
      panelLists = document.querySelector('.yrpanel')?.querySelectorAll('.yrp-ev').length ?? null
      document.querySelector('.yearview').dispatchEvent(new PointerEvent('pointerleave'))
    }
    const out = { ok: true, modeHit, hintAtRest, cells: yr.querySelectorAll('.yrcell[data-day]').length, barsOnOverflow, panelLists }
    // The planning layer (iteration A, merged under this branch): the strip reads the
    // demo's in-memory budget, and a paint is refused with the demo message BEFORE any
    // optimistic paint — the strip's figure and the grid's bars are unchanged after it.
    const frame = () => new Promise(r => requestAnimationFrame(r))
    const strip = document.querySelector('.planstrip')
    out.stripPresent = strip !== null
    if (strip !== null) {
      const chipSel = '.planchip[data-cat="vacation"]'
      const chip = strip.querySelector(chipSel)
      out.vacationChipHit = HIT(chipSel)
      out.vacationFigure = chip?.querySelector('.planchip-fig')?.textContent ?? null
      out.blackoutFigure = strip.querySelector('.planchip[data-cat="blackout"] .planchip-fig')?.textContent ?? null
      out.chips = [...strip.querySelectorAll('.planchip')].map(c => c.textContent)
      chip.click()
      await sleep(100)
      out.modeAfterChip = document.querySelector('[data-mode]')?.dataset.mode ?? null
      out.hintAfterChip = document.querySelector('.planhint')?.textContent ?? null
      // Two consecutive free days (no all-day event on either), both on screen.
      const st = window.bramwell.state
      const t = st.today()
      const mk = d => { const x = new Date(d * 86400000); return x.getUTCFullYear() + '-' + String(x.getUTCMonth() + 1).padStart(2, '0') }
      const free = d => st.eventsForMonth(mk(d)).every(e => !(e.allDay && e.start <= d && e.end >= d))
      const centre = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }
      const onScreen = el => { const [x, y] = centre(el); const h = document.elementFromPoint(x, y); return h !== null && (h === el || el.contains(h)) }
      let a = null, b = null
      for (let d = t + 14; d < t + 240 && a === null; d++) {
        const ca = yr.querySelector('.yrcell[data-day="' + d + '"]'), cb = yr.querySelector('.yrcell[data-day="' + (d + 1) + '"]')
        if (ca && cb && free(d) && free(d + 1) && onScreen(ca) && onScreen(cb)) { a = ca; b = cb }
      }
      if (a === null) { out.paint = { ok: false, why: 'no two free on-screen days' } }
      else {
        const barsBefore = yr.querySelectorAll('.yrbar').length
        const [ax, ay] = centre(a), [bx, by] = centre(b)
        const ev = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: 'mouse', isPrimary: true })
        a.dispatchEvent(ev('pointerdown', ax, ay))
        b.dispatchEvent(ev('pointermove', bx, by))
        const paintedMidDrag = document.querySelectorAll('.yrcell[data-paint]').length
        b.dispatchEvent(ev('pointerup', bx, by))
        let toast = null
        for (let i = 0; i < 60; i++) { await frame(); if (toast === null) toast = document.querySelector('.toast')?.textContent ?? null }
        const figAfter = document.querySelector(chipSel + ' .planchip-fig')?.textContent ?? null
        out.paint = { ok: true, days: [a.dataset.day, b.dataset.day], paintedMidDrag, toast, toastIsDemoMessage: toast === ${JSON.stringify(DEMO_MESSAGE)},
          figureBefore: out.vacationFigure, figureAfter: figAfter, figureUnchanged: figAfter === out.vacationFigure,
          barsUnchanged: yr.querySelectorAll('.yrbar').length === barsBefore || document.querySelectorAll('.yrbar').length === barsBefore,
          paintedAfter: document.querySelectorAll('.yrcell[data-paint]').length,
          overlayEverPainted: [...document.querySelectorAll('.yrbar')].some(n => n.textContent === 'Vacation' && Number(n.dataset.day ?? -1) === Number(a.dataset.day)) }
      }
      // Leave paint mode the way the user does: click the chip again.
      document.querySelector(chipSel)?.click()
      await sleep(100)
      out.modeAfterSecondClick = document.querySelector('[data-mode]')?.dataset.mode ?? null
    }
    document.getElementById('btn-mode').click()
    await sleep(400)
    return out
  })()`)
}

/** Probe 4: customization works in memory — the sheet opens from the avatar, a mood change
 *  repaints, and localStorage stays empty. */
async function probeSettingsInMemory() {
  return await evalJs(`(async () => {
    const HIT = ${HIT}
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const avatarHit = HIT('#avatar')
    document.getElementById('avatar').click()
    await sleep(400)
    const sheet = document.getElementById('sheet')
    if (sheet === null || sheet.hidden) return { ok: false, why: 'sheet did not open', avatarHit }
    const before = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()
    const dusk = sheet.querySelector('[data-mood="dusk"]')
    const duskHit = HIT('[data-mood="dusk"]')
    dusk.click()
    await sleep(300)
    const after = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()
    const moodInPrefs = window.bramwell.state.prefs().mood
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await sleep(400)
    return { ok: true, avatarHit, duskHit, surfaceBefore: before, surfaceAfter: after, surfaceChanged: before !== after, moodInPrefs, storage: ${STORAGE} }
  })()`)
}

/** Probe 5: the pill leaves demo and starts sign-in. Headless Chrome cannot complete a GIS
 *  popup; the observable exit is isDemo() false, the pill gone, the demo prefs dropped, and
 *  the shell landing on first-run (cold cache) behind the attempted sign-in. */
async function probeExit() {
  return await evalJs(`(async () => {
    const HIT = ${HIT}
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const pillHit = HIT('#demo-pill')
    document.getElementById('demo-pill').click()
    // Synchronous, before any frame: exitDemo has run, nothing has repainted yet.
    // Any key that appears LATER is the normal app's own dock write, not the demo's.
    const storageAtClick = ${STORAGE}
    const isDemoAtClick = window.bramwell.state.isDemo()
    let fr = null
    for (let i = 0; i < 30 && (fr === null || fr.hidden); i++) { await sleep(100); fr = document.getElementById('firstrun') }
    await sleep(1500)   // let a rejected sign-in surface its toast
    return { ok: true, pillHit, isDemoAtClick, storageAtClick, isDemo: window.bramwell.state.isDemo(), pillGone: document.getElementById('demo-pill') === null,
      prefsAfterExit: (() => { try { return localStorage.getItem('bramwell.prefs.v1') } catch { return null } })(),
      moodAfterExit: window.bramwell.state.prefs().mood ?? null,
      firstRunVisible: fr !== null && !fr.hidden, toast: document.querySelector('.toast')?.textContent ?? null,
      bars: document.querySelectorAll('.bar').length, storage: ${STORAGE} }
  })()`)
}

/** Probe 6: a reload of what began as /?demo lands on first-run, and the first-run button
 *  enters demo from there. */
async function probeReloadAndButton() {
  await nav(`${ORIGIN}/?demo`)
  const beforeReload = await evalJs(`({ isDemo: window.bramwell.state.isDemo(), search: location.search })`)
  loaded = false
  await send('Page.reload')
  for (let i = 0; i < 100 && !loaded; i++) await sleep(100)
  await sleep(1200)
  const afterReload = await evalJs(`(() => {
    const HIT = ${HIT}
    const fr = document.getElementById('firstrun')
    return { isDemo: window.bramwell.state.isDemo(), search: location.search, firstRunVisible: fr !== null && !fr.hidden,
      demoButton: HIT('#fr-demo'), demoButtonText: document.getElementById('fr-demo')?.textContent ?? null,
      laterReleaseNote: document.body.textContent.includes('later release'), bars: document.querySelectorAll('.bar').length, storage: ${STORAGE} }
  })()`)
  const viaButton = await evalJs(`(async () => {
    const HIT = ${HIT}
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    document.getElementById('fr-demo').click()
    await sleep(800)
    const fr = document.getElementById('firstrun')
    return { isDemo: window.bramwell.state.isDemo(), firstRunHidden: fr === null || fr.hidden,
      yearVisible: document.querySelector('.yearview') !== null && !document.querySelector('.yearview').hidden,
      hint: document.querySelector('.planhint')?.textContent ?? null,
      pill: HIT('#demo-pill'), fab: HIT('#fab'), storage: ${STORAGE} }
  })()`)
  return { beforeReload, afterReload, viaButton }
}

/** Control: a plain cold visit to /, no demo anywhere. Whatever storage holds after it is
 *  the app's OWN baseline write (the dock writes lastDockedDay), so a key seen after
 *  leaving demo can be attributed correctly. Storage is cleared afterwards so the demo
 *  probes still run over a cold profile. */
async function probeColdControl() {
  await nav(`${ORIGIN}/`)
  const r = await evalJs(`(() => { const fr = document.getElementById('firstrun')
    return { isDemo: window.bramwell.state.isDemo(), firstRunVisible: fr !== null && !fr.hidden, storage: ${STORAGE},
      prefs: (() => { try { return localStorage.getItem('bramwell.prefs.v1') } catch { return null } })() } })()`)
  await evalJs('localStorage.clear()')
  return r
}

// ---- run ----
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
const out = {}
out.coldControl = await probeColdControl()
out.entryLight = await probeEntry('light')
out.entryDark = await probeEntry('dark')
out.saveRefused = await probeSaveRefused()
out.year = await probeYear()
out.settings = await probeSettingsInMemory()
out.storageAfterSession = await evalJs(STORAGE)
out.exit = await probeExit()
out.reload = await probeReloadAndButton()
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
out.entryPhone = await probeEntry('dark')
const hosts = [...new Set(requests.map(u => { try { return new URL(u).host } catch { return u } }))]
out.network = { total: requests.length, hosts, googleapis: requests.filter(u => /googleapis\.com/.test(u)).length }
out.exceptions = exceptions
console.log(JSON.stringify(out, null, 2))
process.exit(0)
