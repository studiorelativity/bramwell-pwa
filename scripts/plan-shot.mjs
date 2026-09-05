// scripts/plan-shot.mjs — headless evidence for the planning layer (iteration
// A, 2026-09-05). A sibling of shot.mjs, not an extension of it: shot.mjs is
// shared with the other iteration sessions and is already 900 lines. Same
// driver shape — Node's global WebSocket over CDP, colour scheme driven with
// Emulation.setEmulatedMedia (CONVENTIONS) and the coarse pointer with
// Emulation.setTouchEmulationEnabled (hover/pointer are not media features
// setEmulatedMedia honours — the first run proved that), localStorage seeded
// before the app boots, never the network or auth.
//
// Reads process.env.PORT and tests whatever answers there. Derive it from the
// dev server actually started, every run (several vite servers run here):
//
//   npm run dev >/tmp/bramwell-dev.log 2>&1 &
//   P=$(grep -oE 'localhost:[0-9]+' /tmp/bramwell-dev.log | head -1 | cut -d: -f2)
//   PORT=$P node scripts/plan-shot.mjs
//
// The instrument returns BOTH answers in one run (CONVENTIONS): a blocked run
// that must be refused, then an allowed run that must be applied; a hover panel
// that must be inert under (hover: hover) and tappable under (hover: none).
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL_ = `http://localhost:${process.env.PORT ?? 5173}/`

const day = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000
// The displayed year is today()'s year — 2026 while this file is current.
const D = {
  vacStart: day(2026, 8, 3), vacEnd: day(2026, 8, 7),        // a 5-day Vacation run
  blkStart: day(2026, 8, 13), blkEnd: day(2026, 8, 15),      // a 3-day Blackout run
  rec: day(2026, 8, 20),                                     // a recurring instance
  blockedFrom: day(2026, 8, 12), blockedTo: day(2026, 8, 16),// crosses the blackout
  freeFrom: day(2026, 9, 7), freeTo: day(2026, 9, 11),       // a clear Mon-Fri
}
const SEED_CACHE = (() => {
  const ev = (id, s, e, colorId, extra = {}) => ({ id, title: id, allDay: true, colorId, start: s, end: e, ...extra })
  const months = {
    '2026-08': { state: 'ready', fetchedAt: Date.now(), events: [
      ev('vac-5', D.vacStart, D.vacEnd, '7'),
      ev('blk-3', D.blkStart, D.blkEnd, '11'),
      ev('rec-1', D.rec, D.rec, '9', { recurringEventId: 'rec' }),
    ] },
    '2026-09': { state: 'ready', fetchedAt: Date.now(), events: [] },
  }
  return JSON.stringify({ v: 1, months })
})()
// The seed categories with a budget on Vacation, as Settings would write them.
const SEED_PREFS = JSON.stringify({
  defaultView: 'cal',
  categories: [
    { name: 'work', label: 'Work', colorId: '9', displayHex: '#3056D3' },
    { name: 'personal', label: 'Personal', colorId: '10', displayHex: '#17925A' },
    { name: 'financial', label: 'Financial', colorId: '5', displayHex: '#D97706' },
    { name: 'vacation', label: 'Vacation', colorId: '7', displayHex: '#0E86C4', budgetDays: 30 },
    { name: 'blackout', label: 'Blackout', colorId: '11', displayHex: '#B3261E', blocks: true },
    { name: 'other', label: 'Other', colorId: '8', displayHex: '#64748B' },
  ],
})

// ---- driver ----
const port = 9300 + Math.floor(Math.random() * 500)
const udd = mkdtempSync(`${tmpdir()}/plan-shot-`)
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
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
  if (m.method === 'Page.loadEventFired') loaded = true
  if (m.method === 'Runtime.exceptionThrown') console.error('EXC', m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
}
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)
  return r.result?.result?.value
}
await send('Page.enable'); await send('Runtime.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source:
  `localStorage.setItem('bramwell.cache.v1', ${JSON.stringify(SEED_CACHE)});` +
  `localStorage.setItem('bramwell.prefs.v1', ${JSON.stringify(SEED_PREFS)}); (function uncover(){ const b = window.bramwell; if (b && b.chrome && b.chrome.uncover) b.chrome.uncover(); else setTimeout(uncover, 20) })()` })

async function navigate(w, h, mobile, media) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  // (hover: none) / (pointer: coarse) are not media FEATURES setEmulatedMedia
  // honours; touch emulation is what flips them in Chrome.
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 })
  await send('Emulation.setEmulatedMedia', { features: media })
  loaded = false
  await send('Page.navigate', { url: URL_ })
  for (let i = 0; i < 100 && !loaded; i++) await sleep(100)
  await sleep(900)
}

// Shared in-page helpers. Every "works" claim is elementFromPoint at the
// control's centre resolving to it or a descendant (CONVENTIONS).
const HELPERS = `
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const frames = async n => { for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(r)) }
  const centre = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }
  const HIT = sel => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel
    if (el === null) return { found: false }
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return { found: true, sized: false }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { found: true, sized: true, hits: hit !== null && (hit === el || el.contains(hit)) }
  }
  const cell = d => document.querySelector('.yrcell[data-day="' + d + '"]')
  const pev = (type, el, x, y, pointerType = 'mouse') =>
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType, isPrimary: true }))
  const toasts = () => [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent)
  const fig = name => document.querySelector('.planchip[data-cat="' + name + '"] .planchip-fig')?.textContent ?? null
  const painted = () => [...document.querySelectorAll('.yrcell[data-paint]')]
  const hasEv = d => cell(d)?.dataset.hasEv !== undefined
  const yv = () => document.querySelector('.yearview')
  // With no client id in this worktree, getToken() rejects in the SAME microtask
  // queue as createEvent's optimistic notify, so main.ts's rAF-coalesced repaint
  // never sees the pending state. year.ts's own resize listener is synchronous:
  // dispatching it right after pointerup, before yielding, repaints the strip
  // and the grid from the cache as it is at that instant — the optimistic state.
  const repaintNow = () => window.dispatchEvent(new Event('resize'))
  const yr = () => document.querySelector('.yr')
  const openYear = () => { if (yv().hidden) document.getElementById('btn-mode').click() }
  /** A drag from one cell centre to another, in-page, stopping before pointerup so mid-drag state can be read. */
  const dragTo = (from, to) => {
    const a = cell(from), b = cell(to)
    const [ax, ay] = centre(a); const [bx, by] = centre(b)
    pev('pointerdown', a, ax, ay)
    pev('pointermove', a, (ax + bx) / 2, (ay + by) / 2)
    pev('pointermove', a, bx, by)
    return { a, b, bx, by }
  }
`

const PROBE_DESKTOP = `(async () => {
  ${HELPERS}
  const out = {}
  const modeBtn = document.getElementById('btn-mode')
  out.modeBtnHit = HIT(modeBtn)
  openYear()
  await frames(2)

  // -- the strip --
  const chips = [...document.querySelectorAll('.planchip')]
  out.chipCount = chips.length
  out.chipOrder = chips.map(c => c.dataset.cat ?? 'erase')
  out.chipHits = chips.map(c => HIT(c).hits === true)
  out.figVacation = fig('vacation')
  out.figBlackout = fig('blackout')
  out.figWork = fig('work')
  out.figPersonalAbsent = document.querySelector('.planchip[data-cat="personal"] .planchip-fig') === null
  out.stripAboveGrid = document.querySelector('.planstrip').getBoundingClientRect().bottom <= yr().getBoundingClientRect().top + 0.5
  out.stretchDesktop = [...document.querySelectorAll('.yrrow')].some(r => r.style.getPropertyValue('--yr-cols').includes('2.2fr'))

  // -- hover panel under (hover: hover): inert, no tap line (the negative control for the touch probe) --
  const vacCell = cell(${D.vacStart})
  vacCell.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
  const panel = document.querySelector('.yrpanel')
  out.hoverPanelShown = !panel.hidden
  out.hoverPanelPointerEvents = getComputedStyle(panel).pointerEvents
  out.hoverPanelHasTapLine = panel.querySelector('.yrpanel-open') !== null
  yv().dispatchEvent(new PointerEvent('pointerleave'))

  // -- paint mode on --
  const vacChip = document.querySelector('.planchip[data-cat="vacation"]')
  vacChip.click()
  out.modeAfterChip = yv().dataset.mode ?? null
  out.chipPressed = vacChip.getAttribute('aria-pressed')
  out.touchActionInMode = getComputedStyle(yr()).touchAction
  out.cursorInMode = getComputedStyle(yr()).cursor
  // The panel is suppressed for the whole mode.
  vacCell.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
  out.panelSuppressedInMode = panel.hidden

  // -- a BLOCKED run: Aug 12-16 across the Aug 13-15 blackout --
  const before = toasts().length
  const figBefore = fig('vacation')
  const d1 = dragTo(${D.blockedFrom}, ${D.blockedTo})
  out.blockedMidDragPainted = painted().length
  out.blockedMidDragCats = [...new Set(painted().map(c => c.dataset.cat))]
  out.blockedMidDragTint = painted()[0] ? getComputedStyle(painted()[0]).backgroundImage !== 'none' : null
  pev('pointerup', d1.a, d1.bx, d1.by)
  await frames(3)
  out.blockedToast = toasts().slice(before)
  out.blockedPaintCleared = painted().length
  out.blockedNothingWritten = !hasEv(${D.blockedFrom}) && !hasEv(${D.blockedTo})
  out.blockedFigUnchanged = fig('vacation') === figBefore

  // -- an ALLOWED run: Sep 7-11 --
  const before2 = toasts().length
  const d2 = dragTo(${D.freeFrom}, ${D.freeTo})
  out.allowedMidDragPainted = painted().length
  pev('pointerup', d2.a, d2.bx, d2.by)
  out.allowedPaintCleared = painted().length
  repaintNow()
  out.allowedHasEvOptimistic = [${D.freeFrom}, ${D.freeFrom + 2}, ${D.freeTo}].every(hasEv)
  out.allowedFigOptimistic = fig('vacation')
  out.allowedToastBeforeYield = toasts().slice(before2)
  await frames(3)
  out.allowedToastAfterFrames = toasts().slice(before2)
  // Signed out, the write fails after the optimistic apply and rolls back on its own — recorded, not asserted.
  await sleep(1500)
  out.allowedRollbackFig = fig('vacation')
  out.allowedRollbackToast = toasts().slice(before2)

  // -- Escape exits; scrolling restored --
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  out.modeAfterEscape = yv().dataset.mode ?? null
  out.touchActionAfterEscape = getComputedStyle(yr()).touchAction
  out.chipsAllUnpressed = [...document.querySelectorAll('.planchip')].every(c => c.getAttribute('aria-pressed') === 'false')

  // -- Escape MID-DRAG abandons the run and writes nothing --
  vacChip.click()
  const before3 = toasts().length
  const d3 = dragTo(${D.freeFrom}, ${D.freeTo})
  out.midDragPaintedBeforeEscape = painted().length
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  out.midDragPaintedAfterEscape = painted().length
  pev('pointerup', d3.a, d3.bx, d3.by)
  await frames(3)
  out.midDragEscapeMode = yv().dataset.mode ?? null
  out.midDragEscapeToasts = toasts().slice(before3)

  // -- Erase: recurring first (no write), then the run --
  const eraseChip = document.querySelector('.planchip[data-erase]')
  out.eraseChipHit = HIT(eraseChip)
  eraseChip.click()
  out.modeErase = yv().dataset.mode ?? null
  const before4 = toasts().length
  const rc = cell(${D.rec}); const [rx, ry] = centre(rc)
  out.recLane0 = rc.dataset.lane0 ?? null
  pev('pointerdown', rc, rx, ry); pev('pointerup', rc, rx, ry)
  await frames(2)
  out.eraseRecurringToast = toasts().slice(before4)
  out.eraseRecurringStillThere = hasEv(${D.rec})
  // A day with nothing under it does nothing.
  const empty = cell(${D.freeTo + 7}); const [ex, ey] = centre(empty)
  const before5 = toasts().length
  pev('pointerdown', empty, ex, ey); pev('pointerup', empty, ex, ey)
  await frames(2)
  out.eraseEmptyNoToast = toasts().length === before5
  // A moved pointer is a drag, not a click: nothing erased.
  const vc = cell(${D.vacStart + 1}); const [vx, vy] = centre(vc)
  out.vacLane0 = vc.dataset.lane0 ?? null
  pev('pointerdown', vc, vx, vy); pev('pointerup', vc, vx + 40, vy)
  await frames(2)
  out.eraseDragIgnored = hasEv(${D.vacStart + 1}) && fig('vacation') === figBefore
  // The click: the whole run goes, optimistic.
  pev('pointerdown', vc, vx, vy); pev('pointerup', vc, vx + 2, vy + 2)
  repaintNow()
  out.eraseRunGoneOptimistic = [${D.vacStart}, ${D.vacStart + 1}, ${D.vacEnd}].every(d => !hasEv(d))
  out.eraseFigOptimistic = fig('vacation')
  await frames(3)
  await sleep(1500)
  out.eraseRollbackFig = fig('vacation')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

  // -- Painting a blocks category over existing plans is allowed (the other direction of the rule) --
  const blkChip = document.querySelector('.planchip[data-cat="blackout"]')
  blkChip.click()
  const before6 = toasts().length
  const d4 = dragTo(${D.vacStart}, ${D.vacEnd})
  pev('pointerup', d4.a, d4.bx, d4.by)
  out.blackoutOverPlanToastBeforeYield = toasts().slice(before6)
  repaintNow()
  out.blackoutOverPlanFigOptimistic = fig('blackout')
  await frames(3)
  out.blackoutOverPlanToastAfter = toasts().slice(before6)
  out.blackoutOverPlanFigAfterRollback = fig('blackout')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

  // -- Leaving the view exits the mode --
  blkChip.click()
  out.modeBeforeLeave = yv().dataset.mode ?? null
  document.getElementById('btn-mode').click()
  out.modeAfterLeave = yv().dataset.mode ?? null
  out.yearHiddenAfterLeave = yv().hidden
  return out
})()`

const PROBE_SETTINGS = `(async () => {
  ${HELPERS}
  const out = {}
  const prefs = () => JSON.parse(localStorage.getItem('bramwell.prefs.v1'))
  const row = name => document.querySelector('.plan-row[data-cat="' + name + '"]')
  window.bramwell.chrome.openSheet()
  await sleep(150)
  out.budHit = HIT(row('vacation').querySelector('.plan-bud'))
  out.blocksHit = HIT(row('vacation').querySelector('.plan-blocks'))
  out.vacBudgetShown = row('vacation').querySelector('.plan-bud').value
  out.blackoutPressed = row('blackout').querySelector('.plan-blocks').getAttribute('aria-pressed')
  out.personalPressedBefore = row('personal').querySelector('.plan-blocks').getAttribute('aria-pressed')
  // Blocks on Personal: prefs gain the field, the rebuilt row shows it pressed.
  row('personal').querySelector('.plan-blocks').click()
  await sleep(50)
  out.personalBlocksInPrefs = prefs().categories.find(c => c.name === 'personal').blocks
  out.personalPressedAfter = row('personal').querySelector('.plan-blocks').getAttribute('aria-pressed')
  // Toggle off: the field is deleted, not written false.
  row('personal').querySelector('.plan-blocks').click()
  await sleep(50)
  out.personalBlocksAfterOff = 'blocks' in prefs().categories.find(c => c.name === 'personal')
  // Budget on Personal.
  let bud = row('personal').querySelector('.plan-bud')
  bud.value = '20'; bud.dispatchEvent(new Event('change', { bubbles: true }))
  await sleep(50)
  out.personalBudgetInPrefs = prefs().categories.find(c => c.name === 'personal').budgetDays
  out.personalBudgetShown = row('personal').querySelector('.plan-bud').value
  // Out of range is refused and reverts; prefs untouched.
  bud = row('personal').querySelector('.plan-bud')
  bud.value = '400'; bud.dispatchEvent(new Event('change', { bubbles: true }))
  await sleep(50)
  out.outOfRangeRefused = prefs().categories.find(c => c.name === 'personal').budgetDays === 20 && row('personal').querySelector('.plan-bud').value === '20'
  // Blank deletes.
  bud = row('personal').querySelector('.plan-bud')
  bud.value = ''; bud.dispatchEvent(new Event('change', { bubbles: true }))
  await sleep(50)
  out.blankDeletes = !('budgetDays' in prefs().categories.find(c => c.name === 'personal'))
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(100)
  // The strip picks the change up: a budget set here shows in the year view.
  bud = null
  window.bramwell.chrome.openSheet(); await sleep(100)
  bud = row('work').querySelector('.plan-bud'); bud.value = '12'; bud.dispatchEvent(new Event('change', { bubbles: true }))
  await sleep(50)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(100)
  openYear(); await frames(2)
  out.stripAfterSettingsWork = fig('work')
  return out
})()`

const PROBE_TOUCH = `(async () => {
  ${HELPERS}
  const out = {}
  out.hoverNone = matchMedia('(hover: none)').matches
  openYear(); await frames(2)
  out.stretchPhone = (() => { const rows = [...document.querySelectorAll('.yrrow')].map(r => r.style.getPropertyValue('--yr-cols')); return { has135: rows.some(v => v.includes('1.35fr')), has22: rows.some(v => v.includes('2.2fr')) } })()
  const strip = document.querySelector('.planstrip')
  out.stripScrollsX = getComputedStyle(strip).overflowX === 'auto' && strip.scrollWidth > strip.clientWidth
  // "Always visible": the year view is the scroller here, and the strip must
  // stay at its top after the grid scrolls under it. Both readings: before and after.
  out.stripTopBeforeScroll = Math.round(strip.getBoundingClientRect().top - yv().getBoundingClientRect().top)
  yv().scrollTop = 400
  await frames(1)
  out.stripTopAfterScroll = Math.round(strip.getBoundingClientRect().top - yv().getBoundingClientRect().top)
  out.gridMovedUnderStrip = yv().scrollTop >= 300
  out.stripChipHitAfterScroll = HIT(strip.querySelector('.planchip[data-cat="vacation"]'))
  yv().scrollTop = 0
  await frames(1)
  // First tap raises the panel with the line; the line hit-tests; the panel is tappable.
  const c = cell(${D.vacStart}); c.scrollIntoView({ block: 'center' })
  const [x, y] = centre(c)
  pev('pointerdown', c, x, y, 'touch'); pev('pointerup', c, x, y, 'touch')
  c.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }))
  await frames(1)
  const panel = document.querySelector('.yrpanel')
  out.panelShown = !panel.hidden
  out.panelPointerEvents = getComputedStyle(panel).pointerEvents
  const line = panel.querySelector('.yrpanel-open')
  out.tapLineText = line?.textContent ?? null
  if (line === null) { out.yearHiddenNow = yv().hidden; return out }
  out.tapLineHit = HIT(line)
  out.tapLineDim = getComputedStyle(line).color
  out.dimToken = getComputedStyle(document.documentElement).getPropertyValue('--ink-dim').trim()
  // A tap on the panel opens the day in the calendar.
  line.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await frames(3)
  await sleep(300)
  out.yearHiddenAfterPanelTap = yv().hidden
  out.dayOpenAfterPanelTap = document.querySelector('.day[data-open]')?.dataset.day ?? null
  out.dayOpenIsTapped = out.dayOpenAfterPanelTap === String(${D.vacStart})
  // Phone paint mode: a finger paints, and exiting restores scrolling.
  openYear(); await frames(2)
  document.querySelector('.planchip[data-cat="vacation"]').click()
  out.phoneTouchActionInMode = getComputedStyle(yr()).touchAction
  const d = dragTo(${D.freeFrom}, ${D.freeFrom + 2})
  out.phoneMidDragPainted = painted().length
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  pev('pointerup', d.a, d.bx, d.by)
  out.phoneTouchActionAfterExit = getComputedStyle(yr()).touchAction
  return out
})()`

const results = {}
const HOVER = [{ name: 'hover', value: 'hover' }, { name: 'pointer', value: 'fine' }]
const COARSE = [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }]
for (const scheme of ['light', 'dark']) {
  await navigate(1440, 900, false, [{ name: 'prefers-color-scheme', value: scheme }, ...HOVER])
  results[`desktop-${scheme}`] = await evalJs(PROBE_DESKTOP).catch(e => ({ error: String(e) }))
}
await navigate(1440, 900, false, [{ name: 'prefers-color-scheme', value: 'light' }, ...HOVER])
results.settings = await evalJs(PROBE_SETTINGS).catch(e => ({ error: String(e) }))
await navigate(390, 844, true, [{ name: 'prefers-color-scheme', value: 'dark' }, ...COARSE])
results['phone-coarse'] = await evalJs(PROBE_TOUCH).catch(e => ({ error: String(e) }))
console.log(JSON.stringify(results, null, 2))
process.exit(0)
