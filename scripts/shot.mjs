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
// This script has NO safety net of its own around PORT: it reads
// process.env.PORT (defaulting to 5173, below) and will happily test
// whatever is listening there, matching app or not — there is no derivation
// or verification here, only in whatever invoked it. Several vite servers
// run on this machine, so hardcoding PORT=5173 is how this went wrong once
// already (verification.md, "How the evidence was produced"). Derive it from
// the dev server actually started, every run:
//
//   npm run dev >/tmp/bramwell-dev.log 2>&1 &
//   P=$(grep -oE 'localhost:[0-9]+' /tmp/bramwell-dev.log | head -1 | cut -d: -f2)
//   PORT=$P npm run shot
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
// jumpstack (Sep 13, 150 events, its own day, untouched by any other check)
// is for probeJumpStamp below: expanding a day is the only way to move `y`
// without clearing the animation gate first, but fitY caps the shift at
// `top` — the row's OWN distance from the viewport's top edge (scroll.ts:
// "keeps the expanded row on screen without pushing its top off") — so a
// bigger delta alone does not help once bottom - viewportH exceeds top;
// only the row's POSITION does, and it must still be ON SCREEN for a tap
// to land at all (elementFromPoint sees nothing below the viewport). Two
// weeks after "Today" (which docks near vertical centre) is far enough
// down for a large top, close enough to stay visible at all three tested
// viewports — confirmed directly (6 rows stamped, every time, at each).
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
  const sep = [
    ev('sept', day(2026, 9, 2), day(2026, 9, 3), '5'),
    ...Array.from({ length: 150 }, (_, i) => ev(`jumpstack-${i}`, day(2026, 9, 13), day(2026, 9, 13), String(i % 10))),
  ]
  for (const [key, list] of [['2026-08', aug], ['2026-09', sep]]) months[key] = { state: 'ready', fetchedAt: Date.now(), events: list }
  return JSON.stringify({ v: 1, months })
})()
const JUMPSTACK_DAY = Date.UTC(2026, 8, 13) / 86400000
// SEED puts the timed 'nine-fifteen' here, under 'long-21' which spans Aug 10-30 —
// so this one day exercises BOTH collapsed layers the panel has to stand down:
// a .chip inside the cell, and a .bar crossing it from the row's overlay.
const DUAL_LAYER_DAY = Date.UTC(2026, 7, 12) / 86400000

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
// Kept as its own const (not inlined) so probeFirstRunCold below can remove and
// re-add exactly this script around the one navigation that must NOT see it.
const SEED_SCRIPT = `localStorage.setItem('bramwell.cache.v1', ${JSON.stringify(SEED)})`
let seedScriptId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: SEED_SCRIPT })).result.identifier

// The positive jump-stamp case (Important 4): jumpDuringSteadyState/
// jumpAfterSettle only prove the guard never leaks, never that data-jump
// can fire at all — every user-facing path that moves the scroll position
// (pointerdown, wheel, goToWeek) clears the gate as its OWN first
// statement, so none of them can ever exercise the stamp while data-anim
// is set. A window resize looked like the one remaining path (it
// recomputes rowH without touching the gate), but measure() resets EVERY
// slot's own bookkeeping before refilling — the same full-reset shape
// invalidate() uses, which the guard is already, correctly, exempt from
// (a slot whose `prev` was just cleared to null can never look "recycled
// from a different week"). Confirmed by direct instrumentation: a real
// CDP viewport change during an expand reassigns pool slots but never
// stamps any of them.
// The one path that DOES leave `prev` intact while moving what a slot
// resolves to: setExpanded's own `y = fitY(...)` repositioning, right
// after the open row's height changes — invalidate() only reset ONE slot
// (the day being opened), so every other slot's assigned[] is untouched
// when fitY's shift lands. An ordinary day's content is far too small to
// move it; jumpstack (SEED above) is sized and positioned specifically to
// reassign multiple slots — see the SEED comment for why both matter.
async function probeJumpStamp() {
  // A fresh navigation, not reusing PROBE's page state: whether fitY's
  // shift crosses a row boundary is sensitive to the exact sub-pixel
  // scroll position, and PROBE leaves the page well-scrolled-through
  // (settle, year-back, two Todays, wheel drags, an escape sequence) —
  // confirmed directly that reusing that state, vs. a clean reload, is the
  // difference between this reliably reassigning a pool slot and not.
  loaded = false
  await send('Page.navigate', { url: URL_ })
  for (let i = 0; i < 100 && !loaded; i++) await sleep(100)
  await sleep(1200)
  await evalJs("document.getElementById('btn-today').click()")
  await sleep(1500)
  const tapped = await evalJs(`(() => {
    const centre = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }
    const target = document.querySelector('.day[data-day="${JUMPSTACK_DAY}"]')
    if (target === null) return false
    const [x, y] = centre(target)
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true }
    target.dispatchEvent(new PointerEvent('pointerdown', opts))
    target.dispatchEvent(new PointerEvent('pointerup', opts))
    return true
  })()`)
  if (!tapped) return null
  // Polled across several animation frames, not a flat sleep: the
  // reassignment happens inside setExpanded's own fitY-then-place() call,
  // one frame after the tap, and the stamp is cleared again the moment
  // anything next calls setAnim.
  return await evalJs(`(async () => {
    const waitFrame = () => new Promise(r => requestAnimationFrame(r))
    for (let i = 0; i < 30; i++) {
      await waitFrame()
      if (document.querySelectorAll('.week[data-anim][data-jump]').length > 0) return true
    }
    return false
  })()`)
}

// Task 7 (stage 05): CONVENTIONS — a control "works" only if elementFromPoint at
// its CENTRE resolves to it (or to a descendant). element.click() bypasses hit
// testing entirely and would report success on a control no user could reach.
const HIT = `(sel) => {
  const el = document.querySelector(sel)
  if (el === null) return { found: false }
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return { found: true, sized: false }
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return { found: true, sized: true, hits: hit !== null && (hit === el || el.contains(hit)) }
}`

/** Probe 1 (Task 7): first-run over a COLD cache. The harness's own SEED script
 *  (Page.addScriptToEvaluateOnNewDocument, above) makes warmCache() true from the
 *  very first navigation onward, so the "stale" state exercised everywhere else in
 *  this file is the harness's steady state, not first-run — SPEC's first-run
 *  screen only ever shows over a cold cache. This probe removes the seed script
 *  for exactly one navigation to see it, then restores the seed before anything
 *  else runs. Isolated on its own navigation, like probeJumpStamp below, so
 *  nothing else in the run inherits this browsing context's cleared localStorage.
 */
async function probeFirstRunCold() {
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedScriptId })
  loaded = false
  await send('Page.navigate', { url: URL_ })
  for (let i = 0; i < 100 && !loaded; i++) await sleep(100)
  await sleep(300)
  // Belt and braces against a reused profile carrying a stale cache forward:
  // force it empty and reload, still without the seed script, before reading the DOM.
  await evalJs('localStorage.clear()')
  loaded = false
  await send('Page.navigate', { url: URL_ })
  for (let i = 0; i < 100 && !loaded; i++) await sleep(100)
  await sleep(500)
  const result = await evalJs(`(() => {
    const HIT = ${HIT}
    const fr = document.getElementById('firstrun')
    return {
      found: fr !== null,
      visible: fr !== null && !fr.hidden,
      connectHit: HIT('#fr-connect'),
    }
  })()`)
  const reAdd = await send('Page.addScriptToEvaluateOnNewDocument', { source: SEED_SCRIPT })
  seedScriptId = reAdd.result.identifier
  return result
}

/** Probe 9's other half (Task 7): main.ts's heldRepaint gate only engages on a
 *  REAL state.ts cache-change (state.onCacheChange's listener) — a direct
 *  window.bramwell.ctl.invalidate() call, used elsewhere in this file (see the
 *  "transient-UI rule" probe below and SHEET_SURVIVES further down) as a harsher
 *  stand-in for a cache change, bypasses that listener entirely and so can never
 *  exercise the gate. createEvent() (state.ts) applies its optimistic update and
 *  calls notify() BEFORE it ever awaits the network, so saving a form fires one
 *  synchronously even signed out — the network call afterward rejects and rolls
 *  back harmlessly on its own. Isolated on its own navigation, like
 *  probeFirstRunCold above: an offline save is exactly the kind of side effect
 *  (a stuck form, a rejected promise) that should not leak into any other probe.
 */
async function probeHeldRepaint() {
  loaded = false
  await send('Page.navigate', { url: URL_ })
  for (let i = 0; i < 100 && !loaded; i++) await sleep(100)
  await sleep(1200)
  return await evalJs(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const b = window.bramwell
    const day0 = document.querySelector('.day[data-day]')
    if (day0 === null) return { ok: false, why: 'no day cell' }
    const r = day0.getBoundingClientRect()
    const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'mouse', isPrimary: true }
    day0.dispatchEvent(new PointerEvent('pointerdown', opts))
    day0.dispatchEvent(new PointerEvent('pointerup', opts))
    await sleep(700)
    const addBtn = document.querySelector('.dp-add')
    if (addBtn === null) return { ok: false, why: 'no add button' }
    addBtn.click()
    await sleep(150)
    const form = document.querySelector('.dp-form')
    if (form === null) return { ok: false, why: 'no form' }
    b.chrome.openSheet()
    // Marked on a CHILD of .week, not the row container itself: render.renderWeek
    // only ever calls node.replaceChildren() on the row — it never touches the
    // container's own dataset (data-anim/data-jump are scroll.ts's, set on the
    // container directly) — so a marker on the container would survive ANY
    // refill regardless of the gate and prove nothing. A child is genuinely
    // destroyed the moment fillRow -> renderWeek actually reruns for that row.
    const markerRow = document.querySelector('.week')
    const markerChild = markerRow === null ? null : markerRow.querySelector('.day')
    if (markerChild !== null) markerChild.dataset['probeMarker'] = 'x'
    form.querySelector('.dp-title').value = 'shot-probe-heldrepaint'
    form.querySelector('.dp-save').click()
    await sleep(50)   // the notify() above is synchronous; this just lets the DOM settle
    const heldWhileSheetOpen = markerChild !== null && markerChild.isConnected && markerChild.dataset['probeMarker'] === 'x'
    b.ctl.invalidate()   // the harsher direct call — this SHOULD win through regardless
    const clearedByDirectInvalidate = !(markerChild !== null && markerChild.isConnected && markerChild.dataset['probeMarker'] === 'x')
    return { ok: true, heldWhileSheetOpen, clearedByDirectInvalidate, sheetOpenThroughout: b.chrome.isSheetOpen() }
  })()`)
}

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
  // Polls a ROW's own data-anim, not the scroller's (round 6 review): the
  // gate moved off .scroller onto each pooled .week, because this engine
  // only starts a grid-template-columns transition through a same-element
  // attribute selector, never an ancestor's.
  const waitForAnim = async (rowEl, maxFrames = 10) => {
    for (let i = 0; i < maxFrames && rowEl.dataset.anim === undefined; i++) await waitFrame()
    return rowEl.dataset.anim ?? null
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

  // ---- Task 7: shell chrome (first-run / reconnect / avatar), hit-tested ----
  // The harness is permanently signed out over a warm (seeded) cache, i.e. "stale"
  // (see Context in the plan): #firstrun must never cover that, #reconnect should
  // be up once the 2.5s grace has elapsed, and #avatar can never appear headless
  // (auth is real) — recorded, not asserted false, since it exists only signed in.
  const HIT = ${HIT}
  const firstRunEl = document.getElementById('firstrun')
  const firstRunAbsentOrHidden = firstRunEl === null || firstRunEl.hidden
  const reconnectEl = document.getElementById('reconnect')
  const reconnectPresent = reconnectEl !== null
  const reconnectHit = reconnectPresent ? HIT('#reconnect') : null
  const avatarEl = document.getElementById('avatar')
  const avatarPresent = avatarEl !== null
  const avatarHit = avatarPresent ? HIT('#avatar') : null

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
  const animAttr = await waitForAnim(targetRow)
  const animDurMs = Math.round((parseFloat(getComputedStyle(targetRow).transitionDuration) +
                                parseFloat(getComputedStyle(targetRow).transitionDelay)) * 1000)
  // Mid-flight, sampled at ~20% of the duration, not 50%: the expand's
  // easing is --ease-spring (cubic-bezier(0.34, 1.56, 0.64, 1)), which
  // OVERSHOOTS — progress exceeds 1 from roughly 35% to 85% of the
  // duration. A sample at the temporal midpoint lands inside that window,
  // so a perfectly interpolating expand reads PAST the end value there and
  // a naive "strictly between start and end" check reports false
  // regardless of whether the app actually animates (it did, on prior
  // rounds; the instrument, not the app, was what always failed). 20% is
  // safely before the overshoot starts. The assertions below also compare
  // against BOTH endpoints independently rather than "strictly between",
  // which stays correct even if the overshoot window's edges shift.
  const midDelayMs = Math.max(20, Math.round(animDurMs * 0.2))
  await sleep(midDelayMs)
  const openCellNow = document.querySelector('.day[data-open]')
  const midW = openCellNow === null ? 0 : openCellNow.getBoundingClientRect().width
  const midRow = openCellNow === null ? null : openCellNow.closest('.week')
  // The spring overshoots height too, so this is sampled at the same
  // corrected point as midW — the probe that would have caught the open
  // row losing its OWN transform/height/column-gap eligibility when a
  // same-specificity, later-source-order rule for grid-template-columns
  // alone quietly won for the row carrying both gate attributes.
  const midRowH = midRow === null ? 0 : midRow.getBoundingClientRect().height
  // .bars is a brand-new node every fill (render.renderWeek), tracking .week only
  // via grid-template-columns: inherit (style.css). At rest the two strings agreeing
  // is easy; mid-transition is the real test, because inherit must re-resolve every
  // frame against .week's currently-interpolating computed value, not a value copied
  // once at creation. Sampled at the same instant as midW above.
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
  // Differs from BOTH endpoints by more than 1px — not "strictly between",
  // which the spring's overshoot can violate even for a genuinely
  // interpolating value (see the sampling comment above). Differing from
  // both is what a snap (stuck at rest, or already at the end) can never
  // produce, regardless of which side of "between" an overshoot lands on.
  const columnsInterpolated = Math.abs(midW - restCellW) > 1 && Math.abs(midW - endW) > 1
  // The probe that would have caught the split-gate rule collision: with
  // both gate attributes on the open row, transition-property is NOT
  // additive between same-specificity rules, so the row that grows can
  // lose transform/height/column-gap eligibility to whichever rule has
  // later source order, even while grid-template-columns itself still
  // eases correctly. Strictly between is safe HERE because 20% is before
  // the spring's overshoot window starts (see the sampling comment above).
  const rowHeightInterpolated = midRowH > Math.min(restRowH, openRowH) + 1 && midRowH < Math.max(restRowH, openRowH) - 1
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
  // Same corrected sampling point as the initial expand above — the spring
  // overshoot window applies here too, it is the same transition.
  await sleep(midDelayMs)
  const switchMidCell = document.querySelector('.day[data-open]')
  const switchMidW = switchMidCell === null ? 0 : switchMidCell.getBoundingClientRect().width
  await sleep(animDurMs + 200)
  const switchEndCell = document.querySelector('.day[data-open]')
  const switchEndW = switchEndCell === null ? 0 : switchEndCell.getBoundingClientRect().width
  const switchStillSameRow = switchEndCell !== null && switchEndCell.closest('.week') === targetRow
  // Differs from BOTH endpoints by more than 1px — same correction as
  // columnsInterpolated above, same reason (the spring overshoot).
  const sameWeekSwitchAnimated = switchTarget !== null &&
    Math.abs(switchMidW - switchRestNarrowW) > 1 && Math.abs(switchMidW - switchRestWideW) > 1
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
  // No row anywhere should still carry data-anim once settled — checked
  // across every .week, not just targetRow, same reasoning as jumpAfterSettle.
  const animAttrAfterScroll = document.querySelector('.week[data-anim]')?.dataset.anim ?? null

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

  // ---- Escape unwinds one layer at a time: form first, then the day ----
  // The block above leaves the form open (formOpenSeen asserted it). Per
  // main.ts's own documented design ("Escape unwinds one layer at a time:
  // the form first, then the expansion"), a SINGLE Escape here closes only
  // the form — testing "Escape collapses the day" with one dispatch would be
  // asserting a claim the app was never asked to honour yet (round 4 review:
  // this is why collapsedByEscape/panelDetached/rowBackToRest/colsBackToRest
  // read false in every earlier run, independent of any animation-timing fix
  // — the day was correctly still open). Test both layers explicitly instead.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(animDurMs + 400)
  const formClosedByFirstEscape = document.querySelector('.dp-form') === null
  const dayStillOpenAfterFirstEscape = document.querySelector('.day[data-open]') !== null

  // Re-find the row that actually carries the open day right before THIS
  // Escape, not targetRow: targetRow's pool slot has almost certainly been
  // recycled to an unrelated week by the six wheel events and the settle
  // above (Important 7 review) — asserting against a stale reference
  // either tests a row that was never expanded (trivially "at rest") or
  // an unrelated row entirely, not the one this Escape actually collapses.
  const rowBeforeCollapse = document.querySelector('.day[data-open]')?.closest('.week') ?? null
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await sleep(animDurMs + 400)
  const collapsedByEscape = document.querySelector('.day[data-open]') === null
  const panelDetached = document.querySelector('.dp') === null
  const rowBackToRest = rowBeforeCollapse !== null &&
    Math.abs(Math.round(rowBeforeCollapse.getBoundingClientRect().height) - restRowH) <= 1
  const colsBackToRest = rowBeforeCollapse !== null && cols(rowBeforeCollapse) === restCols

  return {
    firstRunAbsentOrHidden, reconnectPresent, reconnectHit, avatarPresent, avatarHit,
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
    columnsInterpolated, rowHeightInterpolated, barsMatchAtRest, barsTrackColumns, barsTrackDuringAnim, midWeekCols, midBarsCols,
    neighbourWidths: [...new Set(neighbours)], gapBelowEqualsOpenRow: gapBelow === openRowH,
    expandedRowFitsViewport, stillOpenAfterScroll, animAttrAfterScroll,
    jumpDuringSteadyState, jumpAfterSettle,
    sameWeekSwitchAnimated, sameWeekSwitchWidths, switchStillSameRow,
    addHit, chipCount, chipHit, chipsAreLabels, repeatEnabledOnAdd, controlHits,
    emptyTitleBlocked, formOpenSeen, typedTextSurvives, notesSurvive,
    formClosedByFirstEscape, dayStillOpenAfterFirstEscape,
    collapsedByEscape, panelDetached, rowBackToRest, colsBackToRest,
  }
})()`

// Probe 5 (Task 7): the FAB must never sit over the last visible row's Sunday —
// a control fixed at the bottom-right and a scrollable grid genuinely can overlap.
// REVIEW FIX (Critical): must run on a FRESH navigation (see probeFabClears below)
// — the pre-existing PROBE focuses .dp-title (day.ts:439), which reproducibly
// drifts innerHeight in headless Chrome's emulation for the rest of that
// navigation's life, corrupting both the "lowest visible row" selection and the
// hit-test coordinates this const computes.
const FAB_CLEARS = `() => {
  const weeks = [...document.querySelectorAll('.week')]
  // The lowest row actually on screen, not the lowest in the pool.
  const vis = weeks.filter(w => w.getBoundingClientRect().bottom <= innerHeight + 1)
  const last = vis.sort((a, b) => a.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom).pop()
  if (last === undefined) return { ok: false, why: 'no visible week' }
  const sun = last.querySelector('.day:nth-child(7)')
  if (sun === null) return { ok: false, why: 'no sunday cell' }
  const target = sun.querySelector('.chips') ?? sun
  const r = target.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  const fab = document.getElementById('fab')
  return {
    ok: hit !== null && fab !== null && hit !== fab && !fab.contains(hit),
    hit: hit === null ? null : hit.className || hit.id,
    fabTop: fab === null ? null : Math.round(fab.getBoundingClientRect().top),
    sunBottom: Math.round(r.bottom),
  }
}`

/** Probe 5 (Task 7), review fix: FAB_CLEARS must run on its own fresh navigation,
 *  the same way probeFirstRunCold isolates itself. #fab's CSS is static
 *  (bottom: calc(16px + env(safe-area-inset-bottom)), height: 48px), so on a
 *  SOUND viewport fabTop must equal innerHeight - 64 exactly — asserted
 *  explicitly here, not just reported, per the review ruling: "If that identity
 *  does not hold on a fresh navigation, stop and report it rather than working
 *  around it." */
async function probeFabClears(w, h, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  loaded = false
  await send('Page.navigate', { url: URL_ })
  for (let i = 0; i < 100 && !loaded; i++) await sleep(100)
  await sleep(800)
  const result = await evalJs(`(${FAB_CLEARS})()`)
  const innerHeightNow = await evalJs('innerHeight')
  return {
    ...result,
    innerHeight: innerHeightNow,
    expectedFabTop: innerHeightNow - 64,
    fabTopIdentityHolds: result.fabTop === innerHeightNow - 64,
  }
}

// Regression probe (2026-08-30, reported from the deployed app): an OPEN day
// must show each event exactly ONCE. render.ts paints the collapsed read-out
// into every cell on every fill; main.ts then appends the panel into that same
// cell. .chips and .more are positioned against the cell's BOTTOM, so a cell
// grown to fit the panel pins them on top of it, and .bars/.rule are later
// siblings inside .week that paint over the whole thing. Both are stood down in
// style.css under .day[data-open].
//
// PAINT ORDER, NOT GEOMETRY. Rectangles still intersect after the fix — the bar
// spans the column either way — so a rect test cannot see this and would report
// a clean pass on the broken build. .bars is pointer-events:none so
// elementsFromPoint skips it; making it hit-testable changes hit-testing, never
// stacking, so the returned order is the real paint order, topmost first. Each
// assertion is re-taken with the fix toggled OFF, so a probe that could not
// fail is caught here rather than trusted.
const DAY_OPEN_SINGLE_READOUT = `() => {
  const cell = document.querySelector('.day[data-open]')
  if (cell === null) return { ok: false, why: 'nothing open' }
  const wk = cell.closest('.week')
  const chips = cell.querySelector('.chips'), more = cell.querySelector('.more')
  const bars = wk.querySelector('.bars'), bar = wk.querySelector('.bar')
  const hidden = n => n === null || getComputedStyle(n).display === 'none'
  const out = {
    chipsHidden: hidden(chips),
    moreHidden: hidden(more),
    chipsInDom: chips !== null,
    dpEvCount: cell.querySelectorAll('.dp-ev').length,
    addIsLastChild: cell.querySelector('.dp')?.lastElementChild?.classList.contains('dp-add') ?? false,
  }
  if (bar !== null) {
    const prev = bars.style.pointerEvents
    bars.style.pointerEvents = 'auto'
    const r = bar.getBoundingClientRect(), c = cell.getBoundingClientRect()
    const x = Math.max(r.left, c.left) + 8, y = r.top + r.height / 2
    const order = () => [...document.elementsFromPoint(x, y)].map(n => n.className || n.tagName)
    const above = a => {
      const b = a.findIndex(n => n.startsWith('bar')), d = a.findIndex(n => n.startsWith('day'))
      return b !== -1 && d !== -1 ? b < d : null
    }
    out.barAbovePanel = above(order())
    const z = cell.style.zIndex; cell.style.zIndex = 'auto'
    out.barAbovePanel_fixOff = above(order())     // must be TRUE, or this probe cannot fail
    cell.style.zIndex = z; bars.style.pointerEvents = prev
  }
  // The add button must be reachable, not merely present (CONVENTIONS).
  const add = cell.querySelector('.dp-add')
  if (add !== null) {
    const r = add.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    out.addHit = hit === null ? null : (hit.className || hit.tagName)
    out.addReachable = hit !== null && (hit === add || add.contains(hit))
  }
  return out
}`

// Probe 6 (Task 7): THE INVARIANT (chrome.ts) — no two categories may share a
// colorId, because the colorId is the only channel a read resolves back to a
// category through. Every option another row's select has chosen must be
// disabled here, and this row's own choice must stay selectable.
const COLOR_INVARIANT = `() => {
  window.bramwell.chrome.openSheet()
  const rows = [...document.querySelectorAll('.set-cat')]
  const chosen = rows.map(r => r.querySelector('select').value)
  const bad = []
  rows.forEach((r, i) => {
    const sel = r.querySelector('select')
    for (const o of sel.options) {
      const takenElsewhere = chosen.some((v, j) => j !== i && v === o.value)
      if (takenElsewhere !== o.disabled) bad.push(\`row \${i} option \${o.value}: disabled=\${o.disabled}\`)
    }
  })
  return { rows: rows.length, chosen, ok: bad.length === 0, bad }
}`

// Probe 7 (Task 7): "add is dead at 11" (SPEC) — Google has 11 event colours and
// the colour is the only way a read finds its category, so the eleventh category
// must retire the add control, with the reason shown alongside it. Reaches 11 by
// clicking the REAL control repeatedly (rebuild() swaps the node under #cat-add
// on every add, so it is re-queried each pass) rather than writing prefs from
// here — chrome.ts is the only writer this task is allowed to drive through.
const CAT_ADD_DEAD = `() => {
  window.bramwell.chrome.openSheet()
  let add = document.getElementById('cat-add')
  let clicks = 0
  while (add !== null && !add.disabled && clicks < 20) {
    add.click()
    add = document.getElementById('cat-add')
    clicks++
  }
  const note = add === null ? null : add.parentElement.querySelector('.set-note')
  return {
    disabled: add === null ? null : add.disabled,
    noteText: note === null ? null : note.textContent,
    clicksToReach11: clicks,
    rowCount: document.querySelectorAll('.set-cat').length,
  }
}`

// Task 7, probe 8's setup: the FAB's target day (DECISIONS "FAB date": calendar ->
// mid-week day of the docked week) has no getter on window.bramwell, so this
// re-derives it the same way FAB_CLEARS re-derives the bottom visible row — from
// the geometry scroll.ts itself docks against, not from an app internal.
const PENDING_ADD_ORIGINAL_DAY = `() => {
  const scroller = document.querySelector('.scroller')
  const sr = scroller.getBoundingClientRect()
  const centre = sr.top + sr.height * 0.5
  const rows = [...document.querySelectorAll('.week')]
  const docked = rows.find(r => Math.abs(r.getBoundingClientRect().top - centre) <= 1) ?? rows[0]
  if (docked === undefined) return null
  const wed = docked.querySelector('.day:nth-child(4)')   // offset 3 from Monday: the row's middle day
  return wed === null ? null : wed.dataset.day
}`

// Probe 8 (Task 7): the regression probe for Task 6's pendingOpenAdd leak. Driven
// through the seam, since it is a same-frame race no synthetic pointer sequence
// reproduces reliably: arm via the REAL addHere(), then switch days before the
// queued rAF runs. The second openDayAt must disarm the pending add, or a later
// tap back onto the FAB's day pops a form nobody asked for.
// REVIEW FIX (Important): previously dispatched a synthetic 'click' at the
// DISABLED #fab directly — a real pointer press on a disabled button dispatches
// no click at all, so that only proved the disarm logic correct when triggered,
// not that a user could reach the trigger. main.ts now exposes `addHere` on
// window.bramwell FOR EXACTLY THIS REASON (the FAB is disabled in every
// connection state this harness can reach), so this calls the real function
// main.ts's own FAB listener calls, rather than dispatching at the control.
const PENDING_ADD_LEAK = `() => {
  const b = window.bramwell
  b.addHere()
  const cells = [...document.querySelectorAll('.day[data-day]')]
  const other = cells.find(c => !c.hasAttribute('data-open'))
  if (other === undefined) return { ok: false, why: 'no second day cell' }
  const d2 = Number(other.dataset.day)
  const r = other.getBoundingClientRect()
  const x = r.left + r.width / 2, y = r.top + r.height / 2
  for (const t of ['pointerdown', 'pointerup']) {
    other.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y }))
  }
  return { armedThenSwitched: true, openedDay: d2, formOpen: b.day.isFormOpen() }
}`

// Probe 8's follow-up: let a frame pass, then tap back onto the ORIGINAL FAB day
// and report isFormOpen(). Expected false — the form must not reopen uninvited.
const PENDING_ADD_TAP_BACK = `(dayStr) => (async () => {
  const waitFrame = () => new Promise(r => requestAnimationFrame(r))
  await waitFrame()
  const cell = document.querySelector('.day[data-day="' + dayStr + '"]')
  if (cell === null) return { ok: false, why: 'original day cell not found' }
  const r = cell.getBoundingClientRect()
  const opts = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
  cell.dispatchEvent(new PointerEvent('pointerdown', opts))
  cell.dispatchEvent(new PointerEvent('pointerup', opts))
  await waitFrame()
  return { ok: true, formOpenAfterTapBack: window.bramwell.day.isFormOpen() }
})()`

// Probe 9 (Task 7), structural half: the sheet is transient UI (CONVENTIONS) and
// must survive a background refresh intact, not get torn down by it. The OTHER
// half — that main.ts's heldRepaint actually holds a real cache-change while the
// sheet is open, rather than this direct call simply not tearing anything down —
// is covered separately by probeHeldRepaint above, on its own navigation.
const SHEET_SURVIVES = `() => {
  window.bramwell.chrome.openSheet()
  const before = window.bramwell.chrome.isSheetOpen()
  // Harsher than a real cache change, matching the existing form probe (the
  // "transient-UI rule" block above, PROBE): a full pool refill, not a single row.
  window.bramwell.ctl.invalidate()
  const el = document.getElementById('sheet')
  return {
    before,
    stillThere: el !== null && !el.hidden,
    stillOpen: window.bramwell.chrome.isSheetOpen(),
  }
}`

const results = []

// One-off probes (Task 7): each drives its own navigation and must run before the
// main viewport loop, which assumes the SEED script is active on every load.
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] })
results.push({ probe: 'firstRunCold', ...(await probeFirstRunCold().catch(e => ({ ok: false, error: String(e) }))) })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
results.push({ probe: 'heldRepaint', ...(await probeHeldRepaint().catch(e => ({ ok: false, error: String(e) }))) })
// Probe 5, review fix: one fresh navigation per viewport, before anything else
// has had a chance to focus an input and drift innerHeight.
for (const [w, h] of VIEWPORTS) {
  results.push({
    probe: 'fabClears',
    viewport: `${w}x${h}`,
    ...(await probeFabClears(w, h, w < 500).catch(e => ({ ok: false, error: String(e) }))),
  })
}

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
      try {
        const row = { viewport: `${w}x${h}`, scheme, motion, ...(await evalJs(PROBE)) }
        // Task 7: FAB clearance is measured separately, on its own fresh
        // navigation (probeFabClears, above the loop) — PROBE's own .dp-title
        // focus (day.ts:439) drifts innerHeight in headless Chrome's emulation
        // for the rest of THIS navigation's life, which corrupted it here before
        // the review caught it. Sheet closed here (PROBE's own Escape sequence
        // left the day collapsed, never opened the sheet) for what follows.
        // Day-cell probes run FIRST, while PROBE has left the calendar clean and
        // no sheet is up to intercept pointers aimed at it.
        await evalJs(`(() => {
          const c = document.querySelector('.day[data-day="${DUAL_LAYER_DAY}"]')
          if (c === null) return false
          const r = c.getBoundingClientRect()
          const o = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
          c.dispatchEvent(new PointerEvent('pointerdown', o))
          c.dispatchEvent(new PointerEvent('pointerup', o))
          return true
        })()`)
        await sleep(900)
        row.dayOpenSingleReadout = await evalJs(`(${DAY_OPEN_SINGLE_READOUT})()`)
        await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
        await sleep(500)
        row.colorInvariant = await evalJs(`(${COLOR_INVARIANT})()`)          // opens the sheet
        row.catAddDeadAt11 = await evalJs(`(${CAT_ADD_DEAD})()`)              // sheet stays open
        // Close the sheet before the FAB/day-cell probes below: open, it would
        // intercept every pointer event aimed at the calendar underneath it.
        await evalJs("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
        const originalFabDay = await evalJs(`(${PENDING_ADD_ORIGINAL_DAY})()`)
        row.pendingAddLeak = await evalJs(`(${PENDING_ADD_LEAK})()`)
        row.pendingAddTapBack = originalFabDay === null
          ? { ok: false, why: 'no docked row found' }
          : await evalJs(`(${PENDING_ADD_TAP_BACK})(${JSON.stringify(originalFabDay)})`)
        row.sheetSurvivesRefresh = await evalJs(`(${SHEET_SURVIVES})()`)      // reopens the sheet
        row.jumpStampedOnRecycle = await probeJumpStamp()
        results.push(row)
      }
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
