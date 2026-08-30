// scripts/shot.mjs — headless evidence for the stage-03 and stage-04 gates.
// Node 26 has a global WebSocket, so CDP needs no dependency. Colour scheme
// is driven with Emulation.setEmulatedMedia: --blink-settings=preferredColorScheme=2
// crashes Chrome 151 (CONVENTIONS). Real data would make the numbers
// non-reproducible, so the harness seeds localStorage with a crafted `ready`
// month before the app boots and never touches the network or auth.
// Stage 04 adds a second emulated-media axis, prefers-reduced-motion, driven
// the same CDP way as colour scheme — for the same reason: no sanctioned
// flag forces it, and the two must vary independently to prove motion.css's
// reduced-motion block only strips duration, never behaviour.
//
//   npm run dev &  →  PORT=5173 npm run shot   (PORT MUST match the dev
//   server actually listening — several vite servers run on this machine)
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL_ = `http://localhost:${process.env.PORT ?? 5173}/`
const VIEWPORTS = [[390, 844], [1440, 900], [1920, 1200]]
const SCHEMES = ['light', 'dark']
// One extra pass: reduced motion is a gate criterion, not a variant of colour.
const MOTION = ['no-preference', 'reduce']

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
  const tap = el => {
    const [x, y] = centre(el)
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true }
    el.dispatchEvent(new PointerEvent('pointerdown', opts))
    el.dispatchEvent(new PointerEvent('pointerup', opts))
  }
  const waitFrame = () => new Promise(r => requestAnimationFrame(r))
  // openDayAt defers its real work to a requestAnimationFrame (main.ts's
  // scheduleRemeasure), so data-anim is not set until that frame runs. A fixed
  // sleep after tap() risks reading transitionDuration before the browser has
  // applied it (reads the CSS default 0s, not what motion.css actually set) —
  // poll, bounded, rather than assume one frame is always enough headless.
  const waitForAnim = async (scrollerEl, maxFrames = 10) => {
    for (let i = 0; i < maxFrames && scrollerEl.dataset.anim === undefined; i++) await waitFrame()
    return scrollerEl.dataset.anim ?? null
  }
  // Two independently-laid-out grids (.week in flow, .bars position:absolute)
  // can legitimately resolve a shared 1fr/0fr track list ~0.01-0.02px apart
  // per track from Chrome's own fractional-pixel rounding, even when nothing
  // is wrong — exact string equality is too strict. 0.05px is three orders of
  // magnitude below the ~12px/track gap the real .bars column-gap bug produced,
  // so it still catches genuine divergence.
  const TRACK_TOL_PX = 0.05
  const colsClose = (a, b) => {
    const pa = a.trim().split(/\s+/).map(parseFloat)
    const pb = b.trim().split(/\s+/).map(parseFloat)
    return pa.length === pb.length && pa.every((v, i) => Math.abs(v - pb[i]) <= TRACK_TOL_PX)
  }
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

  // ---- inline day expansion ----
  const cols = n => getComputedStyle(n).gridTemplateColumns
  const pickDay = Date.UTC(2026, 8, 2) / 86400000                    // Wed 2 Sep, has 'sept'
  // The year-view probes above left the app in year view: come back to the calendar first.
  if (!document.querySelector('.yearview').hidden) document.getElementById('btn-mode').click()
  document.getElementById('btn-today').click()
  await sleep(900)
  let target = document.querySelector('.day[data-day="' + pickDay + '"]')
  if (target === null) { target = document.querySelector('.day:not([data-today])') }
  const targetRow = target.closest('.week')
  const restRowH = Math.round(targetRow.getBoundingClientRect().height)
  const restCellW = target.getBoundingClientRect().width
  const restCols = cols(targetRow)
  const barsMatchAtRest = colsClose(cols(targetRow.querySelector('.bars')), restCols)
  const dayHitBeforeOpen = hits(target)

  // The duration motion.css actually applied — the bound on the click-during-
  // animation tradeoff, reported rather than assumed. Wait for data-anim to
  // actually land (openDayAt defers to a requestAnimationFrame) before reading
  // transitionDuration off it — reading immediately after tap() races the
  // frame that sets it and always reads 0.
  tap(target)
  const animAttr = await waitForAnim(document.querySelector('.scroller'))
  const animDurMs = Math.round((parseFloat(getComputedStyle(targetRow).transitionDuration) +
                                parseFloat(getComputedStyle(targetRow).transitionDelay)) * 1000)
  // Mid-flight: the column width must be strictly between its start and end, which
  // is what distinguishes interpolation from a snap.
  await sleep(Math.max(20, Math.round(animDurMs / 2)))
  const openCellNow = document.querySelector('.day[data-open]')
  const midW = openCellNow === null ? 0 : openCellNow.getBoundingClientRect().width
  // (c) .bars is a brand-new node every fill (render.renderWeek), tracking .week only
  // via grid-template-columns: inherit (style.css). At rest the two strings agreeing
  // is easy; mid-transition is the real test, because inherit must re-resolve every
  // frame against .week's currently-interpolating computed value, not a value copied
  // once at creation. Sampled at the same instant as midW above.
  const midRow = openCellNow === null ? null : openCellNow.closest('.week')
  const midWeekCols = midRow === null ? null : cols(midRow)
  const midBarsCols = midRow === null ? null : cols(midRow.querySelector('.bars'))
  const barsTrackDuringAnim = midRow !== null && midBarsCols !== null && colsClose(midBarsCols, midWeekCols)
  await sleep(animDurMs + 200)

  const openCell = document.querySelector('.day[data-open]')
  const openRow = openCell === null ? null : openCell.closest('.week')
  const openRowH = openRow === null ? 0 : Math.round(openRow.getBoundingClientRect().height)
  // Named dpPanel, not panel: the year-view probes above already bind the name
  // "panel" to .yrpanel in this same PROBE scope, and the brief's snippet reused it.
  const dpPanel = document.querySelector('.dp')
  const endW = openCell === null ? 0 : openCell.getBoundingClientRect().width
  // Strictly between the resting width and the open width is what separates
  // interpolation from a snap — measured, not assumed from the browser version.
  const columnsInterpolated = midW > Math.min(restCellW, endW) + 1 && midW < Math.max(restCellW, endW) - 1
  const barsTrackColumns = openRow !== null && colsClose(cols(openRow.querySelector('.bars')), cols(openRow))
  const neighbours = openRow === null ? [] : [...openRow.querySelectorAll('.day')]
    .filter(d => d !== openCell).map(d => Math.round(d.getBoundingClientRect().width))
  const rowsBelow = [...document.querySelectorAll('.week')]
    .filter(r => r !== openRow && rowTop(r) > rowTop(openRow))
    .sort((a, b) => rowTop(a) - rowTop(b))[0] ?? null
  const gapBelow = rowsBelow === null ? 0 : Math.round(rowTop(rowsBelow) - rowTop(openRow))
  const expandedRowFitsViewport = openRow === null ? false
    : openRow.getBoundingClientRect().bottom <= sr.bottom + 1

  // (b) Switch to a NEIGHBOUR day in the SAME week row (no cross-week jump): the
  // column template must animate to the new day, not snap. This was a real bug
  // (fixed by moving the column write into setExpanded's own task) verified only
  // by hand-tracing until now. openRow is still targetRow here — same week — so
  // this exercises the same-row branch of openDayAt, not the cross-week one the
  // scroll/jump probes below exercise.
  const rowDaysForSwitch = openRow === null ? [] : [...openRow.querySelectorAll('.day')]
  const switchIdx = rowDaysForSwitch.indexOf(openCell)
  const switchTarget = switchIdx < 0 ? null : (rowDaysForSwitch[switchIdx + 1] ?? rowDaysForSwitch[switchIdx - 1] ?? null)
  const switchRestNarrowW = switchTarget === null ? 0 : switchTarget.getBoundingClientRect().width
  const switchRestWideW = endW                                   // the currently-open (wide) resting width
  if (switchTarget !== null) tap(switchTarget)
  await sleep(Math.max(20, Math.round(animDurMs / 2)))
  const switchMidCell = document.querySelector('.day[data-open]')
  const switchMidW = switchMidCell === null ? 0 : switchMidCell.getBoundingClientRect().width
  await sleep(animDurMs + 200)
  const switchEndCell = document.querySelector('.day[data-open]')
  const switchEndW = switchEndCell === null ? 0 : switchEndCell.getBoundingClientRect().width
  const switchStillSameRow = switchEndCell !== null && switchEndCell.closest('.week') === targetRow
  const sameWeekSwitchAnimated = switchTarget !== null &&
    switchMidW > Math.min(switchRestNarrowW, switchRestWideW) + 1 &&
    switchMidW < Math.max(switchRestNarrowW, switchRestWideW) - 1
  const sameWeekSwitchWidths = {
    restNarrowW: Math.round(switchRestNarrowW), restWideW: Math.round(switchRestWideW),
    midW: Math.round(switchMidW), endW: Math.round(switchEndW),
  }

  // The guard must not leak: a steady-state refill never carries data-jump.
  const jumpDuringSteadyState = (() => {
    for (let i = 0; i < 6; i++) scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true }))
    return document.querySelectorAll('.week[data-jump]').length
  })()
  await sleep(140 + 760 + 100)
  const stillOpenAfterScroll = document.querySelector('.day[data-open]') !== null
  const jumpAfterSettle = document.querySelectorAll('.week[data-jump]').length
  const animAttrAfterScroll = document.querySelector('.scroller').dataset.anim ?? null

  // ---- the form: every control hit-tested at its centre ----
  document.querySelector('.dp-add').scrollIntoView({ block: 'center' })
  // hits() is the evidence the control is reachable; click() is what opens the form.
  // The panel stops pointerdown from reaching the scroller, so tap() would not fire it.
  const addHit = hits(document.querySelector('.dp-add'))
  document.querySelector('.dp-add').click()
  await sleep(animDurMs + 300)
  const form = document.querySelector('.dp-form')
  const controlSel = ['.dp-title', '.dp-allday', '.dp-start', '.dp-end', '.dp-repeat', '.dp-notes', '.dp-save', '.dp-cancel']
  const controlHits = {}
  for (const sel of controlSel) {
    const c = form === null ? null : form.querySelector(sel)
    controlHits[sel] = c === null ? 'missing' : (c.offsetParent === null ? 'hidden' : hits(c))
  }
  const chipCount = form === null ? 0 : form.querySelectorAll('.dp-chip').length
  const chipHit = form === null ? false : hits(form.querySelector('.dp-chip'))
  const chipsAreLabels = form === null ? false
    : [...form.querySelectorAll('.dp-chip')].every(c => c.textContent !== c.dataset.cat)
  const repeatEnabledOnAdd = form === null ? null : !form.querySelector('.dp-repeat').disabled

  // Validation surfaces in the form.
  form.querySelector('.dp-title').value = ''
  form.querySelector('.dp-save').click()
  await sleep(100)
  const emptyTitleBlocked = !form.querySelector('.dp-err').hidden

  // ---- the transient-UI rule: a full refill must not touch typed text ----
  const typed = 'half-written title'
  form.querySelector('.dp-title').value = typed
  form.querySelector('.dp-notes').value = 'and some notes'
  const formOpenSeen = window.bramwell.day.isFormOpen()
  window.bramwell.ctl.invalidate()                      // harsher than a real cache change
  window.dispatchEvent(new Event('resize'))
  await sleep(200)
  const survivor = document.querySelector('.dp-title')
  const typedTextSurvives = survivor !== null && survivor.value === typed
  const notesSurvive = document.querySelector('.dp-notes')?.value === 'and some notes'

  // ---- Escape collapses ----
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(animDurMs + 400)
  const collapsedByEscape = document.querySelector('.day[data-open]') === null
  const panelDetached = document.querySelector('.dp') === null
  const rowBackToRest = Math.abs(Math.round(targetRow.getBoundingClientRect().height) - restRowH) <= 1
  const colsBackToRest = cols(targetRow) === restCols

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

    dayHitBeforeOpen, animAttr, animDurMs, restRowH, openRowH, restCellW: Math.round(restCellW),
    expandedGrew: openRowH > restRowH, panelPresent: dpPanel !== null,
    columnsInterpolated, barsMatchAtRest, barsTrackColumns, barsTrackDuringAnim, midWeekCols, midBarsCols,
    neighbourWidths: [...new Set(neighbours)], gapBelowEqualsOpenRow: gapBelow === openRowH,
    expandedRowFitsViewport, stillOpenAfterScroll, animAttrAfterScroll,
    jumpDuringSteadyState, jumpAfterSettle,
    sameWeekSwitchAnimated, sameWeekSwitchWidths, switchStillSameRow,
    addHit, chipCount, chipHit, chipsAreLabels, repeatEnabledOnAdd, controlHits,
    emptyTitleBlocked, formOpenSeen, typedTextSurvives, notesSurvive,
    collapsedByEscape, panelDetached, rowBackToRest, colsBackToRest,
  }
})()`

const results = []
for (const [w, h] of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    for (const motion of MOTION) {
      if (motion === 'reduce' && scheme === 'light') continue   // one reduced pass per viewport
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 })
      await send('Emulation.setEmulatedMedia', { features: [
        { name: 'prefers-color-scheme', value: scheme },
        { name: 'prefers-reduced-motion', value: motion },
      ] })
      loaded = false
      await send('Page.navigate', { url: URL_ })
      for (let i = 0; i < 100 && !loaded; i++) await sleep(100)
      await sleep(800)
      try { results.push({ viewport: `${w}x${h}`, scheme, motion, ...(await evalJs(PROBE)) }) }
      catch (e) {
        const body = await evalJs("document.body.innerHTML.replace(/<div class=\"week\"[\\s\\S]*?<\\/div><\\/div>/g, '[week]').slice(0, 400)").catch(String)
        const ls = await evalJs("(() => { try { return Object.keys(localStorage).join() } catch (e) { return String(e) } })()").catch(String)
        results.push({ viewport: `${w}x${h}`, scheme, motion, error: String(e), body, ls })
      }
    }
  }
}
console.log(JSON.stringify(results, null, 2))
ws.close()
process.exit(results.some(r => r.error) ? 1 : 0)
