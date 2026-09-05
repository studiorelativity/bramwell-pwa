// _iteration/output/polish-probe.mjs — evidence for iteration C (polish).
// Same driver shape as scripts/shot.mjs (CDP over the global WebSocket, colour
// scheme and reduced motion via Emulation.setEmulatedMedia, a seeded cache so
// nothing touches the network). Differences, all deliberate:
//   - a FAKE GIS is installed before boot on every seeded run and the real
//     accounts.google.com script is blocked, so the signed-out state is
//     reached in milliseconds (the fake's error_callback fires at once) instead
//     of after GIS's 10s load timeout — months settle to `error`, not `loading`;
//   - `--connected` scenarios install a fake GIS that ISSUES a token and a
//     fetch stub that answers googleapis.com with `{ items: [] }` and logs the
//     URL, which is the only way to watch ensureMonthsFor from the outside;
//   - every scenario writes PNGs to polish-shots/<tag>-<scenario>-<detail>.png
//     and a results JSON next to them.
// PORT has no default here on purpose: derive it from the dev server's own
// output every run (scripts/shot.mjs header).
//   node _iteration/output/polish-probe.mjs <tag> [scenario ...]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = process.env.PORT
if (PORT === undefined) { console.error('PORT is required'); process.exit(2) }
const URL_ = `http://localhost:${PORT}/`
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'polish-shots')
mkdirSync(OUT, { recursive: true })
const [tag = 'run', ...only] = process.argv.slice(2)

// ---- seeds ----
const day = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000
const ev = (id, s, e, colorId) => ({ id, title: id, allDay: true, colorId, start: s, end: e })
const timed = (id, d, startMin, colorId) => ({ id, title: id, allDay: false, colorId, start: d, end: d, startMin, endMin: startMin + 60 })
function seedCache(monthsSpec) {
  const months = {}
  for (const [key, list] of Object.entries(monthsSpec)) months[key] = { state: 'ready', fetchedAt: Date.now(), events: list }
  return JSON.stringify({ v: 1, months })
}
const AUG = [
  ev('long-21', day(2026, 8, 10), day(2026, 8, 30), '9'),
  ev('solo', day(2026, 8, 4), day(2026, 8, 4), '10'),
  timed('nine-fifteen', day(2026, 8, 12), 9 * 60 + 15, '3'),
  ...[1, 2, 3, 4, 5].map(i => ev(`stack-${i}`, day(2026, 8, 20), day(2026, 8, 20), String(i))),
]
const SEP = [ev('sept', day(2026, 9, 2), day(2026, 9, 3), '5'), timed('lunch', day(2026, 9, 8), 12 * 60, '7')]
const JUL = [ev('july-week', day(2026, 7, 6), day(2026, 7, 12), '8')]
const SEED_DEFAULT = seedCache({ '2026-08': AUG, '2026-09': SEP })
const SEED_PARTIAL = seedCache({ '2026-07': JUL, '2026-08': AUG, '2026-09': SEP })
const ELEVEN = JSON.stringify({
  categories: Array.from({ length: 11 }, (_, i) => ({ name: `cat${i + 1}`, label: ['Work', 'Vacation', 'Blackout', 'Family', 'Health', 'Travel', 'Money', 'Study', 'Social', 'Home', 'Other'][i], colorId: String(i + 1) })),
  fallbackCategory: 'cat11',
})

const GIS_FAIL = `Object.defineProperty(window, 'google', { value: Object.freeze({ accounts: Object.freeze({ oauth2: Object.freeze({
  initTokenClient: cfg => ({ requestAccessToken: () => setTimeout(() => cfg.error_callback({ type: 'popup_failed' }), 0) }),
  revoke: (t, done) => { if (done) done() },
}) }) }), writable: false, configurable: false })`
const GIS_OK = `Object.defineProperty(window, 'google', { value: Object.freeze({ accounts: Object.freeze({ oauth2: Object.freeze({
  initTokenClient: cfg => ({ requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: 'tk', expires_in: 3600 }), 0) }),
  revoke: (t, done) => { if (done) done() },
}) }) }), writable: false, configurable: false })
window.__fetchLog = []
const __realFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = String(input)
  if (url.includes('googleapis.com')) {
    window.__fetchLog.push(url)
    return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
  }
  return __realFetch(input, init)
}`

// ---- driver ----
const port = 9300 + Math.floor(Math.random() * 500)
const udd = mkdtempSync(`${tmpdir()}/polish-`)
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--no-first-run',
  '--no-default-browser-check', '--hide-scrollbars', `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore' })
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
const exceptions = []
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
  if (m.method === 'Page.loadEventFired') loaded = true
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
}
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
async function js(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)
  return r.result?.result?.value
}
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
await send('Network.setBlockedURLs', { urls: ['*accounts.google.com*'] })

let scripts = []
async function nav({ seed = SEED_DEFAULT, prefs = null, gis = GIS_FAIL, w = 1440, h = 900, scheme = 'dark', motion = 'no-preference', coarse = false, extra = '' } = {}) {
  for (const s of scripts) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: s })
  scripts = []
  const src = [
    'try { localStorage.clear() } catch {}',
    seed === null ? '' : `localStorage.setItem('bramwell.cache.v1', ${JSON.stringify(seed)})`,
    prefs === null ? '' : `localStorage.setItem('bramwell.prefs.v1', ${JSON.stringify(prefs)})`,
    gis ?? '',
    extra,
  ].join('\n')
  scripts.push((await send('Page.addScriptToEvaluateOnNewDocument', { source: src })).result.identifier)
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 })
  await send('Emulation.setTouchEmulationEnabled', { enabled: coarse, maxTouchPoints: coarse ? 5 : 1 })
  const features = [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: motion }]
  await send('Emulation.setEmulatedMedia', { features })
  loaded = false
  await send('Page.navigate', { url: URL_ })
  for (let i = 0; i < 100 && !loaded; i++) await sleep(100)
  await sleep(900)
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const file = join(OUT, `${tag}-${name}.png`)
  writeFileSync(file, Buffer.from(r.result.data, 'base64'))
  return file
}
const centre = sel => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
async function tap(sel) {
  await js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const r = el.getBoundingClientRect()
    const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'mouse', isPrimary: true }
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new PointerEvent('pointerup', o)) })()`)
}
const hit = sel => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'missing'
  const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return h !== null && (h === el || el.contains(h)) })()`)
async function openDayWithForm() {
  // A cell with the 'sept' bar: Wed 2 Sep 2026. Open it, then + Add.
  await js("document.getElementById('btn-today').click()")
  await sleep(900)
  const ok = await js(`(() => { const c = document.querySelector('.day[data-day="${day(2026, 9, 2)}"]'); if (!c) return false
    const r = c.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'mouse', isPrimary: true }
    c.dispatchEvent(new PointerEvent('pointerdown', o)); c.dispatchEvent(new PointerEvent('pointerup', o)); return true })()`)
  if (!ok) return false
  await sleep(700)
  await js("document.querySelector('.dp-add')?.click()")
  await sleep(300)
  return await js("document.querySelector('.dp-form') !== null")
}
async function raiseToast() {
  // A WRITE error is the toast's surface (day.ts toasts write failures; a
  // validation error stays in the form). Signed out, Save rejects through the
  // fake GIS within a tick and the optimistic apply rolls back.
  await js("document.querySelector('.dp-title').value = 'probe-toast'; document.querySelector('.dp-save').click()")
  await sleep(400)
  return await js("document.querySelector('.toast') !== null")
}
const pressKey = async (key, code, keyCode) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode })
}
const focusInfo = () => js(`(() => { const a = document.activeElement; if (!a || a === document.body) return null
  const cs = getComputedStyle(a); return { tag: a.tagName, id: a.id, cls: a.className, text: (a.textContent || a.value || '').slice(0, 24),
  focusVisible: a.matches(':focus-visible'), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor + ' off=' + cs.outlineOffset, boxShadow: cs.boxShadow } })()`)

const results = {}
const want = s => only.length === 0 || only.includes(s)

// ---------------- Ticket 1 / 6: first-run at three widths, both schemes ----------------
if (want('firstrun')) {
  const r = {}
  for (const [w, h] of [[390, 844], [1440, 900]]) for (const scheme of ['light', 'dark']) {
    await nav({ seed: null, w, h, scheme })
    r[`${w}-${scheme}`] = {
      shot: await shot(`firstrun-${w}-${scheme}`),
      lines: await js("[...document.querySelectorAll('.set-fr-lines li')].map(l => l.textContent)"),
      desc: await js("document.querySelector('.set-fr-desc')?.textContent"),
      connectHit: await hit('#fr-connect'),
      cardInView: await js("(() => { const r = document.querySelector('.set-fr-card').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })()"),
    }
  }
  results.firstrun = r
}

// ---------------- Ticket 2: view switch motion ----------------
if (want('switch')) {
  const r = {}
  for (const motion of ['no-preference', 'reduce']) {
    await nav({ motion })
    const sample = await js(`(async () => {
      const frame = () => new Promise(r => requestAnimationFrame(r))
      const yv = document.querySelector('.yearview'); const sc = document.querySelector('.scroller')
      document.getElementById('btn-mode').click()
      const t0 = performance.now()
      await frame()
      const early = { op: getComputedStyle(yv).opacity, tr: getComputedStyle(yv).transform, ms: Math.round(performance.now() - t0), hidden: yv.hidden, hasEnter: yv.classList.contains('enter'), dataIn: yv.hasAttribute('data-in') }
      const tp = getComputedStyle(yv).transitionProperty, td = getComputedStyle(yv).transitionDuration
      await new Promise(r => setTimeout(r, 400))
      const late = { op: getComputedStyle(yv).opacity, tr: getComputedStyle(yv).transform, hidden: yv.hidden }
      document.getElementById('btn-mode').click()
      await frame()
      const back = { op: getComputedStyle(sc).opacity, hidden: sc.hidden, yearHidden: yv.hidden }
      await new Promise(r => setTimeout(r, 400))
      const backLate = { op: getComputedStyle(sc).opacity, hidden: sc.hidden }
      return { early, transitionProperty: tp, transitionDuration: td, late, back, backLate }
    })()`)
    r[motion] = sample
    // A mid-transition frame for the record.
    await js("document.getElementById('btn-mode').click()")
    await sleep(60)
    r[motion].midShot = await shot(`switch-${motion}-mid`)
    await sleep(400)
    r[motion].endShot = await shot(`switch-${motion}-end`)
  }
  results.switch = r
}

// ---------------- Ticket 3: year note ----------------
if (want('yrnote')) {
  const r = {}
  for (const [w, h] of [[390, 844], [1440, 900]]) for (const scheme of ['light', 'dark']) {
    await nav({ seed: SEED_PARTIAL, w, h, scheme })
    await sleep(600)                             // let the fake GIS fail every month in range
    await js("document.getElementById('btn-mode').click()")
    await sleep(500)
    await js("document.querySelector('.yearview').scrollTop = 1e6")
    await sleep(100)
    r[`${w}-${scheme}`] = {
      shot: await shot(`yrnote-${w}-${scheme}`),
      note: await js("(() => { const n = document.querySelector('.yrnote'); if (!n) return null; const cs = getComputedStyle(n); return { text: n.textContent, hidden: n.hidden, color: cs.color, fontSize: cs.fontSize, inView: (() => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })() } })()"),
      tokens: await js("(() => { const cs = getComputedStyle(document.documentElement); return { dim: cs.getPropertyValue('--ink-dim').trim(), today: cs.getPropertyValue('--today').trim(), past: cs.getPropertyValue('--past').trim() } })()"),
    }
  }
  // The note must be absent while a month is still loading: a GIS that never answers.
  await nav({ seed: SEED_PARTIAL, gis: `window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken: () => {} }), revoke: (t, d) => d && d() } } }` })
  await js("document.getElementById('btn-mode').click()")
  await sleep(300)
  r.whileLoading = await js("(() => { const n = document.querySelector('.yrnote'); return { present: n !== null && !n.hidden, text: n?.textContent ?? null } })()")
  // And in a fully-loaded year it says nothing.
  await nav({ gis: GIS_OK })
  await sleep(800)
  await js("document.getElementById('btn-mode').click()")
  await sleep(300)
  r.whenLoaded = await js("(() => { const n = document.querySelector('.yrnote'); return { present: n !== null && !n.hidden, text: n?.textContent ?? null, fetched: window.__fetchLog.length } })()")
  results.yrnote = r
}

// ---------------- Ticket 4: keyboard focus ----------------
if (want('focus')) {
  const r = { firstrun: [], header: [], sheet: [], form: [] }
  await nav({ seed: null, w: 1440, h: 900 })
  for (let i = 0; i < 4; i++) { await pressKey('Tab', 'Tab', 9); r.firstrun.push(await focusInfo()) }
  r.firstrunShot = await shot('focus-firstrun-connect')
  await nav({ w: 1440, h: 900 })
  await sleep(2700)                                   // the reconnect pill's grace
  for (let i = 0; i < 3; i++) { await pressKey('Tab', 'Tab', 9); r.header.push(await focusInfo()) }
  r.headerShot = await shot('focus-header')
  await js('window.bramwell.chrome.openSheet()')
  await sleep(400)
  await js("document.getElementById('signout').focus()")
  r.sheet.push(await focusInfo())
  await pressKey('Tab', 'Tab', 9); r.sheet.push(await focusInfo())
  await pressKey('Tab', 'Tab', 9); r.sheet.push(await focusInfo())
  r.sheetShot = await shot('focus-sheet')
  for (let i = 0; i < 6; i++) await pressKey('Tab', 'Tab', 9)
  r.sheet.push(await focusInfo())
  r.sheetCatShot = await shot('focus-sheet-cat')
  await pressKey('Escape', 'Escape', 27)
  await sleep(200)
  if (await openDayWithForm()) {
    await js("document.querySelector('.dp-title').focus()")
    r.form.push(await focusInfo())
    await pressKey('Tab', 'Tab', 9); r.form.push(await focusInfo())
    r.formShot = await shot('focus-form')
  }
  results.focus = r
}

// ---------------- Ticket 5: eleven categories at 390 ----------------
if (want('sheet11')) {
  const r = {}
  for (const scheme of ['light', 'dark']) {
    await nav({ prefs: ELEVEN, w: 390, h: 844, scheme })
    await js('window.bramwell.chrome.openSheet()')
    await sleep(400)
    const top = await shot(`sheet11-390-${scheme}-top`)
    const m = await js(`(() => {
      const sheet = document.getElementById('sheet'); const sr = sheet.getBoundingClientRect()
      const rows = [...sheet.querySelectorAll('.set-cat')]
      const clipped = rows.filter(row => [...row.children].some(c => { const cr = c.getBoundingClientRect(); return cr.right > sr.right + 0.5 || cr.left < sr.left - 0.5 })).length
      const overflowX = rows.filter(row => row.scrollWidth > row.clientWidth + 0.5).length
      sheet.scrollTop = 1e6
      // The LAST Remove button: the fallback row has none (it shows "Fallback").
      const last = [...sheet.querySelectorAll('.set-cat-del')].pop() ?? null
      const lr = last ? last.getBoundingClientRect() : null
      const hitLast = lr ? (() => { const h = document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2); return h === last || last.contains(h) })() : null
      return { rows: rows.length, clipped, overflowX, sheetScrolls: sheet.scrollHeight > sheet.clientHeight, sheetH: sr.height, innerH: innerHeight,
        docScrolls: document.scrollingElement.scrollHeight > innerHeight + 0.5, removeInView: lr ? lr.bottom <= innerHeight && lr.top >= 0 : null, removeHit: hitLast,
        rowHeights: rows.map(x => Math.round(x.getBoundingClientRect().height)) }
    })()`)
    await sleep(100)
    const bottom = await shot(`sheet11-390-${scheme}-bottom`)
    r[scheme] = { top, bottom, ...m }
  }
  results.sheet11 = r
}

// ---------------- Ticket 6: light pass (+ dark for reference) ----------------
if (want('light')) {
  const r = {}
  for (const [w, h] of [[390, 844], [1440, 900], [1920, 1200]]) for (const scheme of ['light', 'dark']) {
    await nav({ w, h, scheme })
    await sleep(2000)
    const k = `${w}-${scheme}`
    r[k] = { month: await shot(`light-${k}-month`) }
    await js("document.getElementById('btn-mode').click()"); await sleep(500)
    r[k].year = await shot(`light-${k}-year`)
    await js("document.getElementById('btn-mode').click()"); await sleep(500)
    await js('window.bramwell.chrome.openSheet()'); await sleep(400)
    r[k].sheet = await shot(`light-${k}-sheet`)
    await pressKey('Escape', 'Escape', 27); await sleep(200)
    if (await openDayWithForm()) {
      r[k].form = await shot(`light-${k}-form`)
      if (await raiseToast()) r[k].toast = await shot(`light-${k}-toast`)
    }
  }
  results.light = r
}

// ---------------- Ticket 7: toast placement ----------------
if (want('toast')) {
  const r = {}
  for (const scheme of ['dark']) {
    await nav({ w: 390, h: 844, scheme })
    if (await openDayWithForm() && await raiseToast()) {
      r[scheme] = await js(`(() => { const t = document.querySelector('.toast').getBoundingClientRect(); const f = document.getElementById('fab').getBoundingClientRect()
        const cs = getComputedStyle(document.getElementById('toasts'))
        const overlap = !(t.right < f.left || t.left > f.right || t.bottom < f.top || t.top > f.bottom)
        return { toast: [t.left, t.top, t.right, t.bottom].map(Math.round), fab: [f.left, f.top, f.right, f.bottom].map(Math.round), overlapsFab: overlap, bottom: cs.bottom, gapBelow: Math.round(innerHeight - t.bottom) } })()`)
      r[scheme].shot = await shot(`toast-390-${scheme}`)
    }
  }
  results.toast = r
}

// ---------------- Ticket 8: header buttons under CDP mouse and touch ----------------
if (want('hdrpointer')) {
  await nav({ w: 1440, h: 900 })
  const LOG = `window.__evlog = []; for (const id of ['btn-mode', 'btn-today']) { const b = document.getElementById(id)
    for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click']) b.addEventListener(t, e => window.__evlog.push(id + ':' + t + ':' + (e.pointerType ?? '')), { capture: true }) }`
  await js(LOG)
  const r = {}
  const [mx, my] = await centre('#btn-mode')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mx, y: my, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mx, y: my, button: 'left', clickCount: 1 })
  await sleep(300)
  r.mouseYear = { log: await js('window.__evlog.splice(0)'), inYear: await js("!document.querySelector('.yearview').hidden"), under: await js(`document.elementsFromPoint(${mx}, ${my}).map(e => e.tagName + (e.id ? '#' + e.id : '') + '.' + e.className).slice(0, 4)`) }
  const [tx, ty] = await centre('#btn-today')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tx, y: ty })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tx, y: ty, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', clickCount: 1 })
  await sleep(300)
  r.mouseToday = { log: await js('window.__evlog.splice(0)'), range: await js("document.querySelector('.hdr-range').textContent") }
  // Back to the month view with a mouse click, then touch.
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mx, y: my, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mx, y: my, button: 'left', clickCount: 1 })
  await sleep(300)
  await js('window.__evlog.splice(0)')
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mx, y: my }] })
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(400)
  r.touchYear = { log: await js('window.__evlog.splice(0)'), inYear: await js("!document.querySelector('.yearview').hidden") }
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty }] })
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(400)
  r.touchToday = { log: await js('window.__evlog.splice(0)'), range: await js("document.querySelector('.hdr-range').textContent") }
  await send('Emulation.setTouchEmulationEnabled', { enabled: false })
  results.hdrpointer = r
}

// ---------------- Ticket 9: press feedback ----------------
if (want('active')) {
  const r = {}
  for (const motion of ['no-preference', 'reduce']) {
    await nav({ w: 1440, h: 900, motion })
    const [x, y] = await centre('#btn-today')
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await sleep(200)
    const held = await js("(() => { const b = document.getElementById('btn-today'); const cs = getComputedStyle(b); return { active: b.matches(':active'), transform: cs.transform, transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration } })()")
    r[motion] = { held, shot: await shot(`active-today-${motion}`) }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await sleep(200)
    r[motion].released = await js("getComputedStyle(document.getElementById('btn-today')).transform")
    // The FAB too, disabled here (signed out): a disabled control must not press.
    const [fx, fy] = await centre('#fab')
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fx, y: fy })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fx, y: fy, button: 'left', clickCount: 1 })
    await sleep(200)
    r[motion].fabDisabledHeld = await js("(() => { const b = document.getElementById('fab'); return { disabled: b.disabled, transform: getComputedStyle(b).transform } })()")
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: fx, y: fy, button: 'left', clickCount: 1 })
    await sleep(100)
  }
  results.active = r
}

// ---------------- Ticket 10: last-used view ----------------
if (want('lastview')) {
  const r = {}
  await nav({ w: 1440, h: 900 })
  r.launch1 = await js("({ inYear: !document.querySelector('.yearview').hidden, prefs: localStorage.getItem('bramwell.prefs.v1') })")
  await js("document.getElementById('btn-mode').click()"); await sleep(300)
  r.afterSwitch = await js("({ inYear: !document.querySelector('.yearview').hidden, prefs: localStorage.getItem('bramwell.prefs.v1') })")
  // Reload WITHOUT the seed script clearing localStorage: read prefs back and re-seed them.
  const kept = await js("localStorage.getItem('bramwell.prefs.v1')")
  await nav({ w: 1440, h: 900, prefs: kept })
  r.reload1 = { inYear: await js("!document.querySelector('.yearview').hidden"), shot: await shot('lastview-reload-year') }
  await js('window.bramwell.chrome.openSheet()'); await sleep(300)
  r.segment = await js("[...document.querySelectorAll('.set-row')].find(r => r.textContent.startsWith('Default view'))?.querySelectorAll('.set-segb').length")
  r.segmentLabels = await js("[...([...document.querySelectorAll('.set-row')].find(r => r.textContent.startsWith('Default view'))?.querySelectorAll('.set-segb') ?? [])].map(b => b.textContent + ':' + b.getAttribute('aria-pressed'))")
  r.sheetShot = await shot('lastview-sheet')
  await js("[...document.querySelectorAll('.set-segb')].find(b => b.textContent === 'Month')?.click()")
  await sleep(100)
  const kept2 = await js("localStorage.getItem('bramwell.prefs.v1')")
  r.afterPickMonth = kept2
  await nav({ w: 1440, h: 900, prefs: kept2 })
  r.reload2 = { inYear: await js("!document.querySelector('.yearview').hidden"), shot: await shot('lastview-reload-month') }
  results.lastview = r
}

// ---------------- Ticket 11: coarse pointer field sizes ----------------
if (want('coarse')) {
  const r = {}
  for (const coarse of [false, true]) {
    await nav({ w: 390, h: 844, coarse })
    const k = coarse ? 'coarse' : 'fine'
    r[k] = { matches: await js("({ coarse: matchMedia('(pointer: coarse)').matches, hoverNone: matchMedia('(hover: none)').matches })") }
    if (await openDayWithForm()) {
      r[k].form = await js("Object.fromEntries(['.dp-title', '.dp-allday', '.dp-start', '.dp-startt', '.dp-repeat', '.dp-notes'].map(s => [s, getComputedStyle(document.querySelector(s)).fontSize]))")
      r[k].formFits = await js("(() => { const f = document.querySelector('.dp-form').getBoundingClientRect(); return { right: Math.round(f.right), innerWidth, docScrollW: document.scrollingElement.scrollWidth } })()")
      r[k].formShot = await shot(`coarse-${k}-form`)
      await pressKey('Escape', 'Escape', 27); await sleep(100)
      await pressKey('Escape', 'Escape', 27); await sleep(400)
    }
    await js('window.bramwell.chrome.openSheet()'); await sleep(300)
    r[k].sheet = await js("Object.fromEntries(['.set-cat-lab', '.set-cat-cid', '.set-cat-hex'].map(s => [s, getComputedStyle(document.querySelector(s)).fontSize]))")
    r[k].sheetFits = await js("(() => { const s = document.getElementById('sheet'); const rows = [...s.querySelectorAll('.set-cat')]; const sr = s.getBoundingClientRect(); return { clipped: rows.filter(row => [...row.children].some(c => c.getBoundingClientRect().right > sr.right + .5)).length, rows: rows.length } })()")
    r[k].sheetShot = await shot(`coarse-${k}-sheet`)
    await pressKey('Escape', 'Escape', 27); await sleep(200)
    await js("document.getElementById('btn-mode').click()"); await sleep(400)
    r[k].yearFits = await js("({ docScrollW: document.scrollingElement.scrollWidth, innerWidth })")
  }
  results.coarse = r
}

// ---------------- Ticket 12: foreground refresh ----------------
if (want('foreground')) {
  await nav({ w: 1440, h: 900, gis: GIS_OK })
  await sleep(1500)
  const r = { bootFetches: await js('window.__fetchLog.length'), bootMonths: await js("[...new Set(window.__fetchLog.map(u => u.match(/timeMin=(\\d{4}-\\d{2})/)?.[1]))]") }
  r.formOpen = await openDayWithForm()
  await js("document.querySelector('.dp-title').value = 'typed-while-open'")
  const fire = async (what) => {
    await js('window.__fetchLog.length = 0')
    await js(what)
    await sleep(400)
    return await js("({ fetches: window.__fetchLog.length, months: [...new Set(window.__fetchLog.map(u => u.match(/timeMin=(\\d{4}-\\d{2})/)?.[1]))], formAlive: document.querySelector('.dp-form') !== null, titleKept: document.querySelector('.dp-title')?.value ?? null, sheetOpen: window.bramwell.chrome.isSheetOpen() })")
  }
  r.visibleFresh = await fire("document.dispatchEvent(new Event('visibilitychange'))")
  r.focusFresh = await fire("window.dispatchEvent(new Event('focus'))")
  r.onlineFresh = await fire("window.dispatchEvent(new Event('online'))")
  // Six minutes later (Date.now shifted; the 5-minute rule reads it), the same events must fetch.
  await js('const __real = Date.now; window.__realNow = __real; Date.now = () => __real() + 6 * 60 * 1000')
  r.visibleStale = await fire("document.dispatchEvent(new Event('visibilitychange'))")
  r.formShotAfter = await shot('foreground-form-after-refresh')
  await js('Date.now = window.__realNow')
  // A visibilitychange to HIDDEN must not trigger it: the listener reads
  // visibilityState. Spoofed on the document, then removed. (Page.
  // setWebLifecycleState was tried first and left visibilityState at
  // 'hidden' after 'active', so it is not a faithful foreground transition.)
  await js('const __r2 = Date.now; window.__realNow2 = __r2; Date.now = () => __r2() + 12 * 60 * 1000')
  await js("Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })")
  r.hiddenStale = await fire("document.dispatchEvent(new Event('visibilitychange'))")
  r.hiddenState = await js('document.visibilityState')
  await js("delete document.visibilityState")
  r.visibleAgainStale = await fire("document.dispatchEvent(new Event('visibilitychange'))")
  await js('Date.now = window.__realNow2')
  // The instrument's own control: a plain resize with the form open (the
  // path shot.mjs already trusts) must leave the form alive too.
  r.resizeControl = await fire("window.dispatchEvent(new Event('resize'))")
  results.foreground = r
}

results.exceptions = exceptions
writeFileSync(join(OUT, `${tag}.results.json`), JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
ws.close()
process.exit(0)
