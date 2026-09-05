import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL_ = `http://localhost:${process.env.PORT}/`
const udd = mkdtempSync(`${tmpdir()}/stale-`)
const port = 9300 + Math.floor(Math.random() * 500)
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore' })
process.on('exit', () => { try { chrome.kill('SIGKILL') } catch {} rmSync(udd, { recursive: true, force: true }) })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let page; for (let i = 0; i < 100 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page') } catch {} if (!page) await sleep(100) }
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0; const pend = new Map(); let loaded = false
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } if (m.method === 'Page.loadEventFired') loaded = true }
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const evalJs = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text); return r.result?.result?.value }
await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
const day = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000
const SEED = JSON.stringify({ v: 1, months: { '2026-09': { state: 'ready', fetchedAt: Date.now(), events: [] } } })
await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('bramwell.cache.v1', ${JSON.stringify(SEED)})` })
loaded = false; await send('Page.navigate', { url: URL_ }); for (let i = 0; i < 150 && !loaded; i++) await sleep(100); await sleep(1500)
const out = await evalJs(`(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const mode = document.getElementById('btn-mode')
  mode.click(); await sleep(400)                                   // open year once: mount + build
  const before = document.querySelector('.yrcell[data-day]')
  const beforeCount = document.querySelectorAll('.yrcell[data-paint], .yrbar').length
  mode.click(); await sleep(400)                                   // back to month
  const cell = document.querySelector('.day[data-day="${day(2026, 9, 9)}"]')
  const r = cell.getBoundingClientRect()
  const o = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'mouse', isPrimary: true }
  cell.dispatchEvent(new PointerEvent('pointerdown', o)); cell.dispatchEvent(new PointerEvent('pointerup', o)); await sleep(600)
  document.querySelector('.dp-add').click(); await sleep(150)
  const form = document.querySelector('.dp-form'); form.querySelector('.dp-title').value = 'stale-year-probe'
  form.querySelector('.dp-save').click(); await sleep(1200)        // optimistic apply + rollback (signed out): two cache changes while in month
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300)
  mode.click(); await sleep(400)                                   // reopen year
  const after = document.querySelector('.yrcell[data-day]')
  return { yearShownAgain: !document.querySelector('.yearview').hidden, gridRebuiltOnOpen: before !== after, sameNode: before === after }
})()`)
console.log(JSON.stringify(out))
process.exit(0)
