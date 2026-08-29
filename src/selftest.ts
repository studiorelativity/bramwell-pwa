// STAGE 01 — pure self-test over the date core. No DOM. Cases 5–9 are added in Task 4.
import type { DayNumber, StoredCategory } from './types.ts'
import { asDay, asWeek, asOffset, civilToDay, dayToCivil, addDays, offsetOf, monthKey } from './dates.ts'
import { today, weekOf, dayAt, _setAnchorForTest } from './state.ts'
import { all, brighten, categoryFor, configure, fallback, sanitize } from './categories.ts'

export type SelfTestResult = { name: string; pass: boolean; detail: string }

type Case = [name: string, run: () => string | null | Promise<string | null>] // null = pass, string = failure detail

export type StubResponse = { status?: number; body?: unknown }
export type FetchCall = { url: string; method: string; headers: Record<string, string>; body: unknown }

/** Swaps globalThis.fetch. Responses are consumed in order; the last one repeats. */
function stubFetch(responses: StubResponse[]): { calls: FetchCall[]; restore: () => void } {
  const real = globalThis.fetch
  const calls: FetchCall[] = []
  let i = 0
  const fake = (input: unknown, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    })
    const r = responses[Math.min(i++, responses.length - 1)] ?? {}
    const status = r.status ?? 200
    if (status === 204) return Promise.resolve(new Response(null, { status }))
    return Promise.resolve(new Response(JSON.stringify(r.body ?? {}), {
      status,
      headers: { 'content-type': 'application/json' },
    }))
  }
  // why: the stub matches fetch's runtime contract, not its full overloaded type
  globalThis.fetch = fake as unknown as typeof fetch
  return { calls, restore: () => { globalThis.fetch = real } }
}

/** In-memory localStorage. Node has none; the browser's must not be touched by a test. */
function stubStorage(): { restore: () => void } {
  const had = 'localStorage' in globalThis
  const real = had ? globalThis.localStorage : undefined
  const map = new Map<string, string>()
  const fake = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  }
  // why: a Map-backed shim implements the Storage surface these tests use, not its index signature
  Object.defineProperty(globalThis, 'localStorage', { value: fake as unknown as Storage, configurable: true, writable: true })
  return {
    restore: () => {
      if (had) Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true })
      else Reflect.deleteProperty(globalThis as object, 'localStorage')
    },
  }
}

const cases: Case[] = [
  ['civil round-trip incl. leap day', () => {
    const probes: [number, number, number][] = [
      [1970, 1, 1], [2000, 2, 29], [2024, 2, 29], [2026, 8, 29], [1999, 12, 31], [2100, 3, 1],
    ]
    for (const [y, m, d] of probes) {
      const back = dayToCivil(civilToDay(y, m, d))
      if (back.y !== y || back.m !== m || back.d !== d) return `${y}-${m}-${d} -> ${JSON.stringify(back)}`
    }
    // 2023 is not a leap year: Feb 29 must normalise to Mar 1, not round-trip
    const notLeap = dayToCivil(civilToDay(2023, 2, 29))
    if (!(notLeap.m === 3 && notLeap.d === 1)) return `2023-02-29 normalised to ${JSON.stringify(notLeap)}`
    return null
  }],

  ['epoch anchoring', () => {
    if (civilToDay(1970, 1, 1) !== 0) return `1970-01-01 = ${civilToDay(1970, 1, 1)}`
    if (civilToDay(1970, 1, 2) !== 1) return `1970-01-02 = ${civilToDay(1970, 1, 2)}`
    if (civilToDay(1969, 12, 31) !== -1) return `1969-12-31 = ${civilToDay(1969, 12, 31)}`
    if (civilToDay(2000, 1, 1) !== 10957) return `2000-01-01 = ${civilToDay(2000, 1, 1)}`
    if (offsetOf(asDay(-4)) !== 6) return `1969-12-28 offset ${offsetOf(asDay(-4))}`
    try { civilToDay(Number.NaN, 1, 1); return 'NaN year was branded' } catch (e) { if (!(e instanceof RangeError)) return `wrong error: ${(e as Error).message}` }
    return null
  }],

  ['801-day weekday oracle', () => {
    // Oracle: Date.getUTCDay() (0=Sun) remapped to 0=Mon. 801 days from 2023-12-01 crosses one Feb 29 and three year boundaries.
    let day = civilToDay(2023, 12, 1)
    for (let i = 0; i < 801; i++) {
      const { y, m, d } = dayToCivil(day)
      const expect = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
      if (offsetOf(day) !== expect) return `day ${day} (${y}-${m}-${d}): got ${offsetOf(day)} want ${expect}`
      day = addDays(day, 1)
    }
    return null
  }],

  ['month keys across a boundary', () => {
    const jan31 = civilToDay(2026, 1, 31)
    const pairs: [DayNumber, string][] = [
      [jan31, '2026-01'], [addDays(jan31, 1), '2026-02'],
      [civilToDay(2025, 12, 31), '2025-12'], [civilToDay(2026, 1, 1), '2026-01'],
      [civilToDay(2026, 9, 5), '2026-09'],
    ]
    for (const [d, want] of pairs) if (monthKey(d) !== want) return `${d}: got ${monthKey(d)} want ${want}`
    return null
  }],

  ['Monday start', () => {
    for (let w = -3; w <= 3; w++) {
      const mon = dayAt(asWeek(w), asOffset(0))
      if (offsetOf(mon) !== 0) return `week ${w} starts on offset ${offsetOf(mon)}`
      const sun = dayAt(asWeek(w), asOffset(6))
      if (offsetOf(sun) !== 6) return `week ${w} ends on offset ${offsetOf(sun)}`
      if (sun - mon !== 6) return `week ${w} spans ${sun - mon} days`
    }
    return null
  }],

  ['year boundary in one row', () => {
    // 2024-12-30 (Mon) .. 2025-01-05 (Sun) is one row. Pin the anchor inside it.
    const saved = today()
    _setAnchorForTest(civilToDay(2025, 1, 2))
    try {
      const mon = civilToDay(2024, 12, 30), sun = civilToDay(2025, 1, 5)
      if (weekOf(mon) !== 0 || weekOf(sun) !== 0) return `weekOf: ${weekOf(mon)} / ${weekOf(sun)}`
      if (dayAt(asWeek(0), asOffset(0)) !== mon) return `row start ${dayAt(asWeek(0), asOffset(0))} want ${mon}`
      if (dayAt(asWeek(0), asOffset(6)) !== sun) return `row end ${dayAt(asWeek(0), asOffset(6))} want ${sun}`
      if (weekOf(addDays(mon, -1)) !== -1) return `Sunday before is week ${weekOf(addDays(mon, -1))}`
      return null
    } finally { _setAnchorForTest(saved) }
  }],

  ['DST-safe stepping across two local years', () => {
    // Walk two local-clock years day by day with Date#setDate (which honours local DST),
    // and demand that addDays over DayNumber lands on the same civil date every step.
    const start = new Date(2024, 0, 1)   // local midnight
    let day = civilToDay(2024, 1, 1)
    const cursor = new Date(start)
    for (let i = 0; i < 731; i++) {
      const c = dayToCivil(day)
      if (c.y !== cursor.getFullYear() || c.m !== cursor.getMonth() + 1 || c.d !== cursor.getDate())
        return `step ${i}: DayNumber says ${c.y}-${c.m}-${c.d}, local clock says ${cursor.getFullYear()}-${cursor.getMonth() + 1}-${cursor.getDate()}`
      cursor.setDate(cursor.getDate() + 1)
      day = addDays(day, 1)
    }
    return null
  }],

  ['weekOf/dayAt round-trip', () => {
    const t = today()
    for (let n = -400; n <= 400; n += 7) {
      for (let o = 0; o < 7; o++) {
        const d = addDays(t, n + o - offsetOf(t))
        const back = dayAt(weekOf(d), offsetOf(d))
        if (back !== d) return `${d} -> week ${weekOf(d)} off ${offsetOf(d)} -> ${back}`
      }
    }
    return null
  }],

  ['week 0 contains today', () => {
    const t = today()
    if (weekOf(t) !== 0) return `today is week ${weekOf(t)}`
    const mon = dayAt(asWeek(0), asOffset(0))
    if (!(mon <= t && t <= addDays(mon, 6))) return `today ${t} outside row ${mon}..${addDays(mon, 6)}`
    const { y, m, d } = dayToCivil(t)
    const now = new Date()
    if (y !== now.getFullYear() || m !== now.getMonth() + 1 || d !== now.getDate()) return `today() is ${y}-${m}-${d}`
    return null
  }],

  ['categories: sanitize rejects the malformed', () => {
    if (sanitize(null).length !== 0) return 'null was not rejected'
    if (sanitize({ name: 'x' }).length !== 0) return 'non-array object was not rejected'
    const rows = sanitize([
      { name: 'work', label: 'Work', colorId: '9' },              // keep
      { label: 'No name', colorId: '1' },                          // drop: no name
      { name: 'blank', label: '', colorId: '2' },                  // drop: empty label
      { name: 'bad', label: 'Bad', colorId: '12' },                // drop: colorId out of range
      { name: 'alsobad', label: 'Also', colorId: 9 },              // drop: colorId not a string
      { name: 'work', label: 'Dup name', colorId: '3' },           // drop: duplicate name
      { name: 'dupcolor', label: 'Dup colour', colorId: '9' },     // drop: duplicate colorId
      { name: 'hexbad', label: 'Hex', colorId: '4', displayHex: 'red' },   // keep, field dropped
      { name: 'hexok', label: 'Hex OK', colorId: '5', displayHex: '#ABCDEF' }, // keep, field kept
    ])
    const got = rows.map(r => r.name).join(',')
    if (got !== 'work,hexbad,hexok') return `kept: ${got}`
    if ('displayHex' in rows[1]!) return 'invalid displayHex was kept'
    if (rows[2]?.displayHex !== '#ABCDEF') return `valid displayHex: ${rows[2]?.displayHex}`
    const many = sanitize(Array.from({ length: 20 }, (_, i) => ({ name: `n${i}`, label: `L${i}`, colorId: String((i % 11) + 1) })))
    if (many.length !== 11) return `cap: ${many.length}`
    return null
  }],

  ['categories: brighten floors lightness, caps saturation', () => {
    // Independent HSL measurement — the oracle, not the algorithm under test.
    const measure = (hex: string): { h: number; s: number; l: number } => {
      const n = parseInt(hex.slice(1), 16)
      const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
      if (d === 0) return { h: 0, s: 0, l }
      const s = d / (1 - Math.abs(2 * l - 1))
      const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
      return { h: h * 60, s, l }
    }
    const probes = ['#3056D3', '#17925A', '#D97706', '#64748B', '#000000', '#FFFFFF', '#7986CB', '#D50000']
    for (const p of probes) {
      const out = brighten(p)
      if (!/^#[0-9A-F]{6}$/.test(out)) return `${p} -> ${out} is not a 6-digit hex`
      const m = measure(out)
      if (m.l < 0.62 - 1e-3) return `${p} -> ${out} lightness ${m.l.toFixed(3)} below floor`
      if (m.s > 0.72 + 1e-3) return `${p} -> ${out} saturation ${m.s.toFixed(3)} above cap`
      const src = measure(p)
      if (src.s > 0.01 && Math.abs(((m.h - src.h + 540) % 360) - 180) > 2) return `${p} -> ${out} hue moved ${src.h.toFixed(1)} -> ${m.h.toFixed(1)}`
      if (brighten(out) !== out) return `${p} not idempotent: ${out} -> ${brighten(out)}`
    }
    return null
  }],

  ['categories: resolution, fallback and seed substitution', () => {
    configure({})
    if (all().map(c => c.name).join(',') !== 'work,personal,financial,other') return `seed: ${all().map(c => c.name).join(',')}`
    if (categoryFor('9').name !== 'work') return `colorId 9 -> ${categoryFor('9').name}`
    if (categoryFor('1').name !== 'other') return `unknown colorId -> ${categoryFor('1').name}`
    if (categoryFor(undefined).name !== 'other') return `absent colorId -> ${categoryFor(undefined).name}`
    // A blob that sanitizes to nothing must not leave zero categories.
    configure({ categories: [{ name: '', label: '', colorId: '99' }] as unknown as StoredCategory[] })
    if (all().length !== 4) return `empty blob did not fall back to seed: ${all().length}`
    // A fallbackCategory naming a category that is not present falls back to the first.
    configure({ categories: [{ name: 'solo', label: 'Solo', colorId: '7' }], fallbackCategory: 'ghost' })
    if (fallback().name !== 'solo') return `dangling fallback -> ${fallback().name}`
    if (categoryFor('9').name !== 'solo') return `unknown colorId under one category -> ${categoryFor('9').name}`
    configure({})
    return null
  }],

  ['harness: async cases, fetch and storage stubs', async () => {
    const f = stubFetch([{ body: { ok: 1 } }])
    try {
      const res = await fetch('https://example.test/x', { method: 'POST', body: JSON.stringify({ a: 2 }) })
      const json = await res.json() as { ok: number }
      if (json.ok !== 1) return `stub body: ${JSON.stringify(json)}`
      if (f.calls.length !== 1) return `calls: ${f.calls.length}`
      if (f.calls[0]?.method !== 'POST') return `method: ${f.calls[0]?.method}`
      if ((f.calls[0]?.body as { a: number } | null)?.a !== 2) return `captured body: ${JSON.stringify(f.calls[0]?.body)}`
    } finally { f.restore() }
    const s = stubStorage()
    try {
      localStorage.setItem('k', 'v')
      if (localStorage.getItem('k') !== 'v') return 'storage stub did not round-trip'
    } finally { s.restore() }
    return null
  }],
]

export async function selfTest(): Promise<SelfTestResult[]> {
  const out: SelfTestResult[] = []
  for (const [name, run] of cases) {
    try {
      const detail = await run()
      out.push({ name, pass: detail === null, detail: detail ?? 'ok' })
    } catch (e) {
      out.push({ name, pass: false, detail: `threw: ${(e as Error).message}` })
    }
  }
  return out
}
