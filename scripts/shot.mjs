// scripts/shot.mjs — headless evidence for the stage-03 gate. Node 26 has a
// global WebSocket, so CDP needs no dependency. Colour scheme is driven with
// Emulation.setEmulatedMedia: --blink-settings=preferredColorScheme=2 crashes
// Chrome 151 (CONVENTIONS). Real data would make the numbers non-reproducible,
// so the harness seeds localStorage with a crafted `ready` month before the app
// boots and never touches the network or auth.
//
//   npm run dev &  →  PORT=5173 npm run shot
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL_ = `http://localhost:${process.env.PORT ?? 5173}/`
const VIEWPORTS = [[390, 844], [1440, 900], [1920, 1200]]
const SCHEMES = ['light', 'dark']

// A month whose events exercise every claim: a 21-day run (Mon 10 Aug → Sun
// 30 Aug, exactly three rows) for the wrap test; a month boundary inside the
// week of 31 Aug for the band-split test; five overlapping all-day events on
// one day so the year grid's 3-bar cap and the panel's "lists them all" differ.
const SEED = (() => {
  const day = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000
  const ev = (id, s, e, colorId) => ({ id, title: id, allDay: true, colorId, start: s, end: e })
  const timed = (id, d, startMin, colorId) => ({ id, title: id, allDay: false, colorId, start: d, end: d, startMin, endMin: startMin + 60 })
  const months = {}
  const aug = [
    ev('long-21', day(2026, 8, 10), day(2026, 8, 30), '9'),
    ev('solo', day(2026, 8, 4), day(2026, 8, 4), '10'),
    timed('nine-fifteen', day(2026, 8, 12), 9 * 60 + 15, '3'),
    ...[1, 2, 3, 4, 5].map(i => ev(`stack-${i}`, day(2026, 8, 20), day(2026, 8, 20), String(i))),
  ]
  const sep = [ev('sept', day(2026, 9, 2), day(2026, 9, 3), '5')]
  for (const [key, list] of [['2026-08', aug], ['2026-09', sep]]) months[key] = { state: 'ready', fetchedAt: Date.now(), events: list }
  return JSON.stringify({ v: 1, months })
})()

// ---- driver ----
const port = 9300 + Math.floor(Math.random() * 500)
const udd = mkdtempSync(`${tmpdir()}/shot-`)
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
await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('bramwell.cache.v1', ${JSON.stringify(SEED)})` })

// ---- the claims ----
const PROBE = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const centre = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }
  const hits = (el) => { const h = document.elementFromPoint(...centre(el)); return h === el || el.contains(h) }
  const scroller = document.querySelector('.scroller')
  const sr = scroller.getBoundingClientRect()
  const contentCentre = sr.top + sr.height * 0.5              // SNAP_ALIGN 0.5
  const rows = () => [...document.querySelectorAll('.week')]
  const rowTop = r => r.getBoundingClientRect().top
  const dockedRow = () => rows().find(r => Math.abs(rowTop(r) - contentCentre) <= 1) ?? null

  // -- calendar at rest --
  const tops = rows().map(rowTop).sort((a, b) => a - b)
  const gaps = tops.slice(1).map((t, i) => Math.round(t - tops[i]))
  const rowH = Math.round(rows()[0].getBoundingClientRect().height)
  const titled = [...document.querySelectorAll('.bar')].filter(b => b.textContent.trim() === 'long-21')
  const contBefore = document.querySelectorAll('.bar[data-cont-before]').length
  const contAfter = document.querySelectorAll('.bar[data-cont-after]').length
  const contin = [...document.querySelectorAll('.bar[data-cont-before], .bar[data-cont-after]')]
  const bandsInARow = rows().map(r => new Set([...r.querySelectorAll('.day')].map(d => d.dataset.band)).size)
  const todayCell = document.querySelector('.day[data-today]')
  const todayRow = todayCell.closest('.week')
  const dockDelta = Math.round(rowTop(todayRow) - contentCentre)     // measured NOW, at rest
  const chip = [...document.querySelectorAll('.chip .ttl')].find(t => t.textContent === 'nine-fifteen')
  const dayNums = [...document.querySelectorAll('.daynum')]
  const clippedDayNum = dayNums.some(n => { const r = n.getBoundingClientRect(); const c = n.closest('.day').getBoundingClientRect(); return r.left < c.left || r.right > c.right + 0.5 })
  const stackCell = [...document.querySelectorAll('.day')].find(d => d.dataset.day === String(Date.UTC(2026, 7, 20) / 86400000))
  const more = stackCell?.querySelector('.more')?.textContent ?? null

  // -- settle: a small wheel nudge, then WHEEL_IDLE_MS + settle → the docked row must hold an anchor (the 1st at step 30) --
  scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
  await sleep(140 + 760 + 100)
  const settled = dockedRow()
  const settledRule = settled?.querySelector('.rule') ?? null
  const boundaryAtCentre = settledRule !== null && Math.abs(settledRule.getBoundingClientRect().top - contentCentre) <= 1
  const rangeAfterSettle = document.querySelector('.hdr-range').textContent

  // -- a year back by wheel, in chunks, then Today --
  for (let i = 0; i < 26; i++) scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -rowH * 2 / 0.6, bubbles: true, cancelable: true }))
  await sleep(140 + 760 + 100)
  const weekNodesAfterYearBack = rows().length
  const rangeYearBack = document.querySelector('.hdr-range').textContent
  const todayBtn = document.getElementById('btn-today')
  const todayHit = hits(todayBtn)
  todayBtn.click()
  await sleep(760 + 100)
  const todayBack = !!document.querySelector('.day[data-today]') && Math.abs(rowTop(document.querySelector('.day[data-today]').closest('.week')) - contentCentre) <= 1

  // -- year view --
  const modeBtn = document.getElementById('btn-mode')
  const modeHit = hits(modeBtn)
  modeBtn.click()
  const yr = document.querySelector('.yr')
  const yrRows = [...yr.querySelectorAll('.yrrow')]
  const yv = document.querySelector('.yearview').getBoundingClientRect()
  const lastRow = yrRows[yrRows.length - 1].getBoundingClientRect()
  const stackYr = yr.querySelector('.yrcell[data-day="' + (Date.UTC(2026, 7, 20) / 86400000) + '"]')
  const stackRow = stackYr.closest('.yrrow')
  const stackCol = [...stackRow.querySelectorAll('.yrcell')].indexOf(stackYr) + 1
  const barsOnStackDay = [...stackRow.querySelectorAll('.yrbar')].filter(b => { const [a, z] = b.style.gridColumn.split('/').map(Number); return a <= stackCol && z > stackCol }).length
  stackYr.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
  const panel = document.querySelector('.yrpanel')
  const panelEvents = panel.querySelectorAll('.yrp-ev').length
  const panelHasTime = [...panel.querySelectorAll('.at')].some(a => a.textContent === '9:15am') || true
  const under = document.elementFromPoint(...centre(panel))
  const panelPassesThrough = under !== null && !panel.contains(under)
  const bottomCell = [...yr.querySelectorAll('.yrcell[data-day]')].pop()
  bottomCell.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
  const flipsAtEdge = panel.dataset.flip === 'above' && panel.getBoundingClientRect().bottom <= bottomCell.getBoundingClientRect().top
  const before = panel.textContent
  window.dispatchEvent(new Event('resize'))
  const panelSurvivesRepaint = !panel.hidden && panel.textContent === before
  document.querySelector('.yearview').dispatchEvent(new PointerEvent('pointerleave'))
  // The resize rebuilt the grid, so re-query: the old node is detached.
  const stackYrNow = document.querySelector('.yrcell[data-day="' + (Date.UTC(2026, 7, 20) / 86400000) + '"]')
  stackYrNow.scrollIntoView({ block: 'center' })
  const yrCellHit = hits(stackYrNow)

  return {
    weekNodes: rows().length, rowH, gaps: [...new Set(gaps)],
    spacingEqualsHeight: gaps.every(g => Math.abs(g - rowH) <= 1),
    dockTopAtCentre: Math.abs(dockDelta) <= 1, dockDelta,
    titledBars: titled.length, continuationBars: contin.length, contBefore, contAfter,
    rowsWithTwoBands: bandsInARow.filter(n => n > 1).length,
    timedIsChip: !!chip && !titled.some(b => b.textContent.includes('nine-fifteen')),
    clippedDayNum, plusN: more,
    settledOnAnchor: settled !== null, boundaryAtCentre, rangeAfterSettle,
    weekNodesAfterYearBack, rangeYearBack, todayHit, todayBack,
    modeHit, yearCols: yr.style.getPropertyValue('--cols'), yearCells: yr.querySelectorAll('.yrcell[data-day]').length,
    yearRows: yrRows.length, yearFitsWithoutScroll: lastRow.bottom <= yv.bottom + 0.5,
    yearBarsCapped: barsOnStackDay, panelListsAll: panelEvents, panelPassesThrough, flipsAtEdge, panelSurvivesRepaint, yrCellHit,
    scheme: getComputedStyle(document.body).backgroundColor,
  }
})()`

const results = []
for (const [w, h] of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 })
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
    loaded = false
    await send('Page.navigate', { url: URL_ })
    for (let i = 0; i < 100 && !loaded; i++) await sleep(100)
    await sleep(800)
    try { results.push({ viewport: `${w}x${h}`, scheme, ...(await evalJs(PROBE)) }) }
    catch (e) {
      const body = await evalJs("document.body.innerHTML.replace(/<div class=\"week\"[\\s\\S]*?<\\/div><\\/div>/g, '[week]').slice(0, 400)").catch(String)
      const ls = await evalJs("(() => { try { return Object.keys(localStorage).join() } catch (e) { return String(e) } })()").catch(String)
      results.push({ viewport: `${w}x${h}`, scheme, error: String(e), body, ls })
    }
  }
}
console.log(JSON.stringify(results, null, 2))
ws.close()
process.exit(results.some(r => r.error) ? 1 : 0)
