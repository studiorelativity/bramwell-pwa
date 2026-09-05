// STAGE 02 — the whole in-repo suite, run by `npm run selftest` under bare node and by the
// in-app selftest panel. No DOM. Sequential cases over the date core, categories and theme,
// gcal wire mapping and transport, auth token handling, and state's cache, lazy loading,
// 401 retry and optimistic writes. Cases share module state, so each restores what it stubs
// (fetch, localStorage, GIS), the anchor it pins, and any token it acquired.
import type { DayNumber, EventDraft, StoredCategory, MoodId, CalendarEvent, EventSpan } from './types.ts'
import { asDay, asWeek, asOffset, civilToDay, dayToCivil, addDays, offsetOf, monthKey } from './dates.ts'
import {
  today, weekOf, dayAt, _setAnchorForTest, _resetForTest, _flushForTest,
  prefs, savePrefs, monthState, eventsForMonth, spansForWeek,
  ensureMonthsFor, onCacheChange, _settleForTest, clearAuthGate,
  createEvent, updateEvent, deleteEvent,
} from './state.ts'
import { all, brighten, categoryFor, configure, fallback, mintName, sanitize, themeCss } from './categories.ts'
import { getToken, isSignedIn, signIn, signOut } from './auth.ts'
import {
  createEvent as gcalCreate, deleteEvent as gcalDelete, updateEvent as gcalUpdate,
  GcalError, listMonth, MAX_RESULTS,
} from './gcal.ts'
import {
  easeOutCubic, fitY, heightOf, nearestAnchor, posOf, projectY, rowHeightFor,
  settleMs, snapTargetY, weekAtY,
} from './scroll.ts'
import type { Expanded } from './scroll.ts'
import { packLanes, visibilityFor, rangeLabel, columnsFor, PHONE_MAX_W } from './render.ts'
import type { PackedSpan } from './render.ts'
import { validate } from './day.ts'
import { sanitizePlanning } from './plan.ts'

export type SelfTestResult = { name: string; pass: boolean; detail: string }

type Case = [name: string, run: () => string | null | Promise<string | null>] // null = pass, string = failure detail

export type StubResponse = { status?: number; body?: unknown; delayMs?: number }
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
    const make = (): Response => status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(r.body ?? {}), { status, headers: { 'content-type': 'application/json' } })
    // delayMs holds a response open so a later call can be observed while it is still in flight.
    const delayMs = r.delayMs
    if (delayMs !== undefined) return new Promise<Response>(done => { setTimeout(() => done(make()), delayMs) })
    return Promise.resolve(make())
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

type StubToken = { access_token?: string; expires_in?: number; error?: string }

/** Fake Google Identity Services. Installs globalThis.google, which is what auth.ts reads. */
function stubGis(replies: StubToken[]): { prompts: string[]; revoked: string[]; restore: () => void } {
  const prompts: string[] = []
  const revoked: string[] = []
  let i = 0
  const fake = {
    accounts: {
      oauth2: {
        initTokenClient: (cfg: { callback: (r: StubToken) => void }) => ({
          requestAccessToken: (req?: { prompt?: string }) => {
            prompts.push(req?.prompt ?? '<none>')
            cfg.callback(replies[Math.min(i++, replies.length - 1)] ?? { error: 'no reply configured' })
          },
        }),
        revoke: (t: string, done?: () => void) => { revoked.push(t); done?.() },
      },
    },
  }
  const had = 'google' in globalThis
  const real = had ? (globalThis as { google?: unknown }).google : undefined
  Object.defineProperty(globalThis, 'google', { value: fake, configurable: true, writable: true })
  return {
    prompts, revoked,
    restore: () => {
      if (had) Object.defineProperty(globalThis, 'google', { value: real, configurable: true, writable: true })
      else Reflect.deleteProperty(globalThis as object, 'google')
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
      { name: 'ev"il]', label: 'Injected', colorId: '6' },          // drop: a name reaching a CSS selector
      { name: 'Work Two', label: 'Spaced', colorId: '7' },          // drop: not a slug
      { name: 'work', label: 'Dup name', colorId: '3' },           // drop: duplicate name
      { name: 'dupcolor', label: 'Dup colour', colorId: '9' },     // drop: duplicate colorId
      { name: 'hexbad', label: 'Hex', colorId: '4', displayHex: 'red' },   // keep, field dropped
      { name: 'hexok', label: 'Hex OK', colorId: '5', displayHex: '#ABCDEF' }, // keep, field kept
    ])
    const got = rows.map(r => r.name).join(',')
    if (got !== 'work,hexbad,hexok') return `kept: ${got}`
    if (rows.some(r => !/^[a-z0-9-]+$/.test(r.name))) return `a name that is not a slug survived: ${rows.map(r => r.name).join(',')}`
    if ('displayHex' in rows[1]!) return 'invalid displayHex was kept'
    if (rows[2]?.displayHex !== '#ABCDEF') return `valid displayHex: ${rows[2]?.displayHex}`
    const many = sanitize(Array.from({ length: 20 }, (_, i) => ({ name: `n${i}`, label: `L${i}`, colorId: String((i % 11) + 1) })))
    if (many.length !== 11) return `cap: ${many.length}`
    return null
  }],

  ['plan: sanitizePlanning keeps the row and drops an invalid field', () => {
    // Planning fields ride on the category row (SPEC "Planning layer"): a bad
    // value costs the FIELD, never the category.
    const bud = (v: unknown) => sanitizePlanning({ budgetDays: v })
    for (const v of [0, 367, 2.5, '30', -1, NaN, null, true]) {
      if ('budgetDays' in bud(v)) return `budgetDays ${JSON.stringify(v)} was kept`
    }
    if (bud(1).budgetDays !== 1) return `budgetDays 1 -> ${JSON.stringify(bud(1))}`
    if (bud(366).budgetDays !== 366) return `budgetDays 366 -> ${JSON.stringify(bud(366))}`
    const blk = (v: unknown) => sanitizePlanning({ blocks: v })
    for (const v of [1, 'true', false, 'yes', {}]) {
      if ('blocks' in blk(v)) return `blocks ${JSON.stringify(v)} was kept`
    }
    if (blk(true).blocks !== true) return `blocks true -> ${JSON.stringify(blk(true))}`
    if (Object.keys(sanitizePlanning({})).length !== 0) return 'an empty row grew a field'
    // Through the category loader: the row survives, the bad field does not.
    const rows = sanitize([
      { name: 'a', label: 'A', colorId: '1', budgetDays: '30', blocks: 1 },
      { name: 'b', label: 'B', colorId: '2', budgetDays: 30, blocks: true },
    ])
    if (rows.length !== 2) return `rows kept: ${rows.length}`
    if ('budgetDays' in rows[0]! || 'blocks' in rows[0]!) return `invalid planning fields survived: ${JSON.stringify(rows[0])}`
    if (rows[1]?.budgetDays !== 30 || rows[1]?.blocks !== true) return `valid planning fields lost: ${JSON.stringify(rows[1])}`
    return null
  }],

  ['categories: the seed sanitizes to itself, blocks intact', () => {
    configure({})
    const seed = all()
    const again = sanitize(seed)
    if (JSON.stringify(again) !== JSON.stringify(seed)) return `seed changed under sanitize: ${JSON.stringify(again)}`
    const black = seed.find(c => c.name === 'blackout')
    if (black?.blocks !== true || black.colorId !== '11') return `blackout: ${JSON.stringify(black)}`
    const vac = seed.find(c => c.name === 'vacation')
    if (vac === undefined || vac.colorId !== '7' || 'budgetDays' in vac || 'blocks' in vac) return `vacation: ${JSON.stringify(vac)}`
    // Frozen seed: the four original rows and their colorIds are untouched.
    const orig = seed.slice(0, 3).map(c => `${c.name}:${c.colorId}`).join(',') + ',' + seed[5]?.name + ':' + seed[5]?.colorId
    if (orig !== 'work:9,personal:10,financial:5,other:8') return `original rows moved: ${orig}`
    // Both new rows carry a hand-picked dark twin, not a derived one.
    const css = themeCss('warm')
    for (const c of [vac, black]) {
      const light = c.displayHex ?? ''
      if (!css.includes(`--cat-${c.name}: ${light}`)) return `${c.name} light hex missing from themeCss`
      if (css.includes(`--cat-${c.name}: ${brighten(light)}`)) return `${c.name} dark twin is brighten(), not hand-picked`
    }
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
      // Tolerance covers 8-bit hex quantization (~1/255 ≈ 0.0039), not algorithmic slack
      if (m.l < 0.62 - 5e-3) return `${p} -> ${out} lightness ${m.l.toFixed(3)} below floor`
      if (m.s > 0.72 + 5e-3) return `${p} -> ${out} saturation ${m.s.toFixed(3)} above cap`
      const src = measure(p)
      if (src.s > 0.01 && Math.abs(((m.h - src.h + 540) % 360) - 180) > 2) return `${p} -> ${out} hue moved ${src.h.toFixed(1)} -> ${m.h.toFixed(1)}`
      if (brighten(out) !== out) return `${p} not idempotent: ${out} -> ${brighten(out)}`
    }
    return null
  }],

  ['categories: resolution, fallback and seed substitution', () => {
    configure({})
    if (all().map(c => c.name).join(',') !== 'work,personal,financial,vacation,blackout,other') return `seed: ${all().map(c => c.name).join(',')}`
    if (categoryFor('9').name !== 'work') return `colorId 9 -> ${categoryFor('9').name}`
    if (categoryFor('1').name !== 'other') return `unknown colorId -> ${categoryFor('1').name}`
    if (categoryFor(undefined).name !== 'other') return `absent colorId -> ${categoryFor(undefined).name}`
    // A blob that sanitizes to nothing must not leave zero categories.
    configure({ categories: [{ name: '', label: '', colorId: '99' }] as unknown as StoredCategory[] })
    if (all().length !== 6) return `empty blob did not fall back to seed: ${all().length}`
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

  ['categories: themeCss emits both schemes and data-cat rules', () => {
    configure({})
    const css = themeCss('warm')
    for (const need of [
      '--cat-work: #3056D3',
      '--cat-other: #64748B',
      '@media (prefers-color-scheme: dark)',
      '--cat-work: #7B96FF',          // curated twin, not brighten()
      '--cat-personal: #4FC48D',
      '[data-cat="work"] { --cat: var(--cat-work); }',
      '--surface:',
    ]) if (!css.includes(need)) return `missing: ${need}`
    // Stage 03 fills MOODS: every id must now produce its OWN palette.
    const seen = new Set<string>()
    for (const m of ['warm', 'paper', 'cool', 'sage', 'dusk'] as MoodId[]) {
      const out = themeCss(m)
      if (m !== 'warm' && out === css) return `mood ${m} is still identical to warm`
      seen.add(out)
    }
    if (seen.size !== 5) return `five moods produced ${seen.size} distinct stylesheets`
    // A non-seed colour with no displayHex takes Google's hex light and a derived twin dark.
    configure({ categories: [{ name: 'solo', label: 'Solo', colorId: '3' }], fallbackCategory: 'solo' })
    const solo = themeCss('warm')
    if (!solo.includes('--cat-solo: #8E24AA')) return 'non-seed light colour is not Google hex'
    if (!solo.includes(`--cat-solo: ${brighten('#8E24AA')}`)) return 'non-seed dark colour is not brighten(light)'
    // A displayHex override wins over the colorId's Google hex in both schemes.
    configure({ categories: [{ name: 'solo', label: 'Solo', colorId: '3', displayHex: '#112233' }], fallbackCategory: 'solo' })
    const over = themeCss('warm')
    if (!over.includes('--cat-solo: #112233')) return 'displayHex did not override light'
    if (!over.includes(`--cat-solo: ${brighten('#112233')}`)) return 'displayHex did not override dark'
    configure({})
    return null
  }],

  ['categories: mintName slugs a label and uniquifies against the current set', () => {
    // A name must satisfy sanitize()'s own NAME_RE, or a minted category would be
    // silently dropped on the next load.
    const ok = /^[a-z0-9-]{1,32}$/
    const cases: [string, string[], string][] = [
      ['Travel', [], 'travel'],
      ['Deep  Work!', [], 'deep-work'],
      ['Travel', ['travel'], 'travel-2'],
      ['Travel', ['travel', 'travel-2'], 'travel-3'],
      ['   ', [], 'category'],
      ['!!!', ['category'], 'category-2'],
      ['ÉLAN', [], 'lan'],
    ]
    for (const [label, taken, want] of cases) {
      const got = mintName(label, taken)
      if (got !== want) return `mintName(${JSON.stringify(label)}, ${JSON.stringify(taken)}) = ${got}, want ${want}`
      if (!ok.test(got)) return `${got} does not satisfy NAME_RE`
    }
    // Length is capped so a very long label cannot mint an unstorable name.
    const long = mintName('x'.repeat(80), [])
    if (long.length > 32) return `a long label minted a ${long.length}-char name`
    return null
  }],

  ['gcal: list query params and bearer token', async () => {
    const f = stubFetch([{ body: { items: [] } }])
    try {
      await listMonth('2026-02', 'tok-123')
      const call = f.calls[0]
      if (call === undefined) return 'no request was made'
      if (call.headers['authorization'] !== 'Bearer tok-123') return `auth header: ${call.headers['authorization']}`
      if (!call.url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events?')) return `url: ${call.url}`
      const q = new URL(call.url).searchParams
      if (q.get('singleEvents') !== 'true') return `singleEvents: ${q.get('singleEvents')}`
      if (q.get('orderBy') !== 'startTime') return `orderBy: ${q.get('orderBy')}`
      if (q.get('maxResults') !== String(MAX_RESULTS)) return `maxResults: ${q.get('maxResults')}`
      if (!q.get('timeMin')?.startsWith('2026-02-01T00:00:00')) return `timeMin: ${q.get('timeMin')}`
      if (!q.get('timeMax')?.startsWith('2026-03-01T00:00:00')) return `timeMax: ${q.get('timeMax')}`
      if (!/[+-]\d{2}:\d{2}$/.test(q.get('timeMin') ?? '')) return `timeMin carries no local offset: ${q.get('timeMin')}`
      // December must roll the window into the next year.
      f.calls.length = 0
      await listMonth('2026-12', 'tok-123')
      const dec = new URL(f.calls[0]?.url ?? '').searchParams
      if (!dec.get('timeMax')?.startsWith('2027-01-01T00:00:00')) return `December timeMax: ${dec.get('timeMax')}`
    } finally { f.restore() }
    return null
  }],

  ['gcal: all-day read converts exclusive end to inclusive', async () => {
    const f = stubFetch([{ body: { items: [
      { id: 'a', summary: 'Trip', start: { date: '2026-02-20' }, end: { date: '2026-02-23' } },
      { id: 'b', summary: 'One day', start: { date: '2026-02-25' }, end: { date: '2026-02-26' } },
    ] } }])
    try {
      const evs = await listMonth('2026-02', 't')
      const a = evs[0], b = evs[1]
      if (a?.allDay !== true) return 'all-day event did not map to allDay: true'
      if (a.start !== civilToDay(2026, 2, 20)) return `start: ${a.start}`
      if (a.end !== civilToDay(2026, 2, 22)) return `3-day event end should be the 22nd inclusive, got day ${a.end}`
      if (b?.start !== civilToDay(2026, 2, 25) || b.end !== civilToDay(2026, 2, 25)) return 'single all-day did not collapse to one day'
      if (a.title !== 'Trip') return `title: ${a.title}`
    } finally { f.restore() }
    return null
  }],

  ['gcal: timed read maps to civil day and minutes', async () => {
    // Built from local Date objects, so the assertion holds in any time zone.
    const iso = (y: number, m: number, d: number, hh: number, mm: number) => new Date(y, m - 1, d, hh, mm).toISOString()
    const f = stubFetch([{ body: { items: [
      { id: 'a', summary: 'Standup', start: { dateTime: iso(2026, 2, 20, 9, 30) }, end: { dateTime: iso(2026, 2, 20, 10, 45) } },
      { id: 'b', summary: 'Late', start: { dateTime: iso(2026, 2, 20, 22, 0) }, end: { dateTime: iso(2026, 2, 21, 0, 30) } },
    ] } }])
    try {
      const evs = await listMonth('2026-02', 't')
      const a = evs[0], b = evs[1]
      if (a?.allDay !== false) return 'timed event did not map to allDay: false'
      if (a.start !== civilToDay(2026, 2, 20) || a.end !== civilToDay(2026, 2, 20)) return `day: ${a.start}..${a.end}`
      if (a.startMin !== 570 || a.endMin !== 645) return `minutes: ${a.startMin}..${a.endMin}`
      if (b?.allDay !== false) return 'midnight-crossing event did not map to allDay: false'
      if (b.start !== civilToDay(2026, 2, 20) || b.end !== civilToDay(2026, 2, 21)) return `crossing day: ${b.start}..${b.end}`
      if (b.startMin !== 1320 || b.endMin !== 30) return `crossing minutes: ${b.startMin}..${b.endMin}`
    } finally { f.restore() }
    return null
  }],

  ['gcal: cancelled events are dropped', async () => {
    const f = stubFetch([{ body: { items: [
      { id: 'a', summary: 'Live', start: { date: '2026-02-20' }, end: { date: '2026-02-21' } },
      { id: 'b', status: 'cancelled', summary: 'Gone', start: { date: '2026-02-21' }, end: { date: '2026-02-22' } },
      { id: 'c', status: 'confirmed', summary: 'Also live', start: { date: '2026-02-22' }, end: { date: '2026-02-23' } },
    ] } }])
    try {
      const ids = (await listMonth('2026-02', 't')).map(e => e.id).join(',')
      if (ids !== 'a,c') return `kept: ${ids}`
    } finally { f.restore() }
    return null
  }],

  ['gcal: colorId, notes and recurringEventId pass through', async () => {
    const f = stubFetch([{ body: { items: [
      { id: 'a', summary: 'Coloured', colorId: '9', description: 'note text', recurringEventId: 'series-1', start: { date: '2026-02-20' }, end: { date: '2026-02-21' } },
      { id: 'b', summary: 'Plain', start: { date: '2026-02-21' }, end: { date: '2026-02-22' } },
    ] } }])
    try {
      const evs = await listMonth('2026-02', 't')
      if (evs[0]?.colorId !== '9') return `colorId: ${evs[0]?.colorId}`
      if (evs[0]?.notes !== 'note text') return `notes: ${evs[0]?.notes}`
      if (evs[0]?.recurringEventId !== 'series-1') return `recurringEventId: ${evs[0]?.recurringEventId}`
      if ('colorId' in evs[1]!) return 'absent colorId was invented'
      if ('category' in evs[1]!) return 'gcal resolved a category; that is state.ts’s job'
    } finally { f.restore() }
    return null
  }],

  ['gcal: pagination follows nextPageToken and is capped', async () => {
    const f = stubFetch([
      { body: { items: [{ id: 'a', start: { date: '2026-02-01' }, end: { date: '2026-02-02' } }], nextPageToken: 'P2' } },
      { body: { items: [{ id: 'b', start: { date: '2026-02-02' }, end: { date: '2026-02-03' } }] } },
    ])
    try {
      const evs = await listMonth('2026-02', 't')
      if (evs.map(e => e.id).join(',') !== 'a,b') return `pages not concatenated: ${evs.map(e => e.id).join(',')}`
      if (f.calls.length !== 2) return `calls: ${f.calls.length}`
      if (new URL(f.calls[1]?.url ?? '').searchParams.get('pageToken') !== 'P2') return 'second request carried no pageToken'
      if (new URL(f.calls[0]?.url ?? '').searchParams.has('pageToken')) return 'first request carried a pageToken'
    } finally { f.restore() }
    // A stub that never stops paging must fail, not hang.
    const loop = stubFetch([{ body: { items: [], nextPageToken: 'SAME' } }])
    try {
      await listMonth('2026-02', 't')
      return 'an endless nextPageToken did not throw'
    } catch (e) {
      if (!(e instanceof GcalError)) return `wrong error: ${(e as Error).message}`
      if (loop.calls.length > 20) return `page cap did not hold: ${loop.calls.length} calls`
    } finally { loop.restore() }
    return null
  }],

  ['gcal: retries rate limits and 5xx once, never a permissions 403', async () => {
    const rateLimit = { error: { errors: [{ reason: 'rateLimitExceeded' }] } }
    const forbidden = { error: { errors: [{ reason: 'insufficientPermissions' }] } }
    const ok = { items: [] }
    for (const [label, first] of [
      ['500', { status: 500, body: {} }],
      ['429', { status: 429, body: {} }],
      ['403 rate limit', { status: 403, body: rateLimit }],
    ] as const) {
      const f = stubFetch([first, { body: ok }])
      try {
        await listMonth('2026-02', 't')
        if (f.calls.length !== 2) return `${label}: expected one retry, saw ${f.calls.length} calls`
      } catch (e) { return `${label}: threw ${(e as Error).message}` } finally { f.restore() }
    }
    const perm = stubFetch([{ status: 403, body: forbidden }, { body: ok }])
    try {
      await listMonth('2026-02', 't')
      return 'a permissions 403 did not surface'
    } catch (e) {
      if (!(e instanceof GcalError) || e.status !== 403) return `wrong error: ${(e as Error).message}`
      if (perm.calls.length !== 1) return `a permissions 403 was retried: ${perm.calls.length} calls`
    } finally { perm.restore() }
    const twice = stubFetch([{ status: 503, body: {} }])
    try {
      await listMonth('2026-02', 't')
      return 'a repeated 5xx did not surface'
    } catch (e) {
      if (!(e instanceof GcalError) || e.status !== 503) return `wrong error: ${(e as Error).message}`
      if (twice.calls.length !== 2) return `expected exactly one retry, saw ${twice.calls.length} calls`
    } finally { twice.restore() }
    return null
  }],

  ['gcal: create sends an exclusive end, the colorId and one RRULE', async () => {
    const f = stubFetch([{ body: { id: 'new-1', summary: 'Trip', colorId: '9', start: { date: '2026-02-20' }, end: { date: '2026-02-23' } } }])
    try {
      await gcalCreate({
        title: 'Trip', category: 'work', allDay: true,
        start: civilToDay(2026, 2, 20), end: civilToDay(2026, 2, 22), repeat: 'weekly',
      }, '9', 't')
      const call = f.calls[0]
      if (call?.method !== 'POST') return `method: ${call?.method}`
      if (!call.url.endsWith('/calendars/primary/events')) return `url: ${call.url}`
      if (call.headers['content-type'] !== 'application/json') return `content-type: ${call.headers['content-type']}`
      const b = call.body as { summary?: string; colorId?: string; start?: { date?: string }; end?: { date?: string }; recurrence?: string[] }
      if (b.summary !== 'Trip') return `summary: ${b.summary}`
      if (b.colorId !== '9') return `colorId: ${b.colorId}`
      if (b.start?.date !== '2026-02-20') return `start.date: ${b.start?.date}`
      if (b.end?.date !== '2026-02-23') return `a 3-day event must go out as 20 -> 23 exclusive, got ${b.end?.date}`
      if (b.recurrence?.length !== 1 || b.recurrence[0] !== 'RRULE:FREQ=WEEKLY') return `recurrence: ${JSON.stringify(b.recurrence)}`
    } finally { f.restore() }
    const none = stubFetch([{ body: { id: 'n', start: { date: '2026-02-20' }, end: { date: '2026-02-21' } } }])
    try {
      await gcalCreate({ title: 'x', category: 'work', allDay: true, start: civilToDay(2026, 2, 20), end: civilToDay(2026, 2, 20), repeat: 'none' }, '9', 't')
      if ('recurrence' in (none.calls[0]?.body as object)) return 'repeat "none" still sent a recurrence'
      const nb = none.calls[0]?.body as { start?: { date?: string }; end?: { date?: string } }
      if (nb.start?.date !== '2026-02-20') return `start.date: ${nb.start?.date}`
      if (nb.end?.date !== '2026-02-21') return `a single-day all-day event must go out as 20 -> 21 exclusive, got ${nb.end?.date}`
    } finally { none.restore() }
    return null
  }],

  ['gcal: create timed sends local dateTime with a timeZone', async () => {
    const f = stubFetch([{ body: { id: 'n', start: { dateTime: new Date(2026, 1, 20, 9, 30).toISOString() }, end: { dateTime: new Date(2026, 1, 20, 10, 45).toISOString() } } }])
    try {
      await gcalCreate({
        title: 'Standup', category: 'work', allDay: false,
        start: civilToDay(2026, 2, 20), end: civilToDay(2026, 2, 20),
        startMin: 570, endMin: 645, repeat: 'none',
      }, '9', 't')
      const b = f.calls[0]?.body as { start?: { dateTime?: string; timeZone?: string }; end?: { dateTime?: string } }
      if (!b.start?.dateTime?.startsWith('2026-02-20T09:30:00')) return `start.dateTime: ${b.start?.dateTime}`
      if (!/[+-]\d{2}:\d{2}$/.test(b.start.dateTime)) return `start.dateTime carries no local offset: ${b.start.dateTime}`
      if (!b.end?.dateTime?.startsWith('2026-02-20T10:45:00')) return `end.dateTime: ${b.end?.dateTime}`
      if (b.start.timeZone === undefined || b.start.timeZone === '') return 'no timeZone sent'
      if ('date' in b.start) return 'a timed event sent a date field'
    } finally { f.restore() }
    return null
  }],

  ['gcal: all-day round-trip identity', async () => {
    // Draft -> wire -> back must land on exactly the DayNumbers it started with.
    const start = civilToDay(2026, 2, 20), end = civilToDay(2026, 2, 22)
    const f = stubFetch([{ body: { id: 'rt', summary: 'Trip', colorId: '9', start: { date: '2026-02-20' }, end: { date: '2026-02-23' } } }])
    try {
      const back = await gcalCreate({ title: 'Trip', category: 'work', allDay: true, start, end, repeat: 'none' }, '9', 't')
      if (back.allDay !== true) return 'round-trip lost allDay'
      if (back.start !== start) return `start ${back.start} !== ${start}`
      if (back.end !== end) return `end ${back.end} !== ${end} — the exclusive/inclusive conversion is not symmetric`
      if (back.id !== 'rt') return `id: ${back.id}`
      if (back.colorId !== '9') return `colorId: ${back.colorId}`
    } finally { f.restore() }
    return null
  }],

  ['gcal: update PATCHes changed fields onto the id it is given', async () => {
    const f = stubFetch([{ body: { id: 'inst-9', summary: 'Renamed', start: { date: '2026-02-20' }, end: { date: '2026-02-21' } } }])
    try {
      await gcalUpdate('inst-9', { title: 'Renamed' }, undefined, 't')
      const call = f.calls[0]
      if (call?.method !== 'PATCH') return `method: ${call?.method}`
      if (!call.url.endsWith('/calendars/primary/events/inst-9')) return `url: ${call.url}`
      const b = call.body as Record<string, unknown>
      if (b['summary'] !== 'Renamed') return `summary: ${String(b['summary'])}`
      if ('start' in b || 'end' in b) return 'a title-only change sent dates'
      if ('colorId' in b) return 'an undefined colorId was sent'
    } finally { f.restore() }
    // The caller chooses the id; a series edit is the same call against the series id.
    const s = stubFetch([{ body: { id: 'series-1', summary: 'S', start: { date: '2026-02-20' }, end: { date: '2026-02-21' } } }])
    try {
      await gcalUpdate('series-1', { title: 'S' }, '5', 't')
      if (!(s.calls[0]?.url ?? '').endsWith('/events/series-1')) return `series url: ${s.calls[0]?.url}`
      if ((s.calls[0]?.body as Record<string, unknown>)['colorId'] !== '5') return 'colorId was not sent'
    } finally { s.restore() }
    return null
  }],

  ['gcal: delete targets the id it is given and tolerates 204', async () => {
    const f = stubFetch([{ status: 204 }])
    try {
      await gcalDelete('inst-9', 't')
      if (f.calls[0]?.method !== 'DELETE') return `method: ${f.calls[0]?.method}`
      if (!(f.calls[0]?.url ?? '').endsWith('/calendars/primary/events/inst-9')) return `url: ${f.calls[0]?.url}`
    } catch (e) { return `204 was not tolerated: ${(e as Error).message}` } finally { f.restore() }
    const s = stubFetch([{ status: 204 }])
    try {
      await gcalDelete('series-1', 't')
      if (!(s.calls[0]?.url ?? '').endsWith('/events/series-1')) return `series url: ${s.calls[0]?.url}`
    } finally { s.restore() }
    const gone = stubFetch([{ status: 404, body: { error: { errors: [{ reason: 'notFound' }] } } }])
    try {
      await gcalDelete('missing', 't')
      return 'a 404 delete did not throw'
    } catch (e) {
      if (!(e instanceof GcalError) || e.status !== 404) return `wrong error: ${(e as Error).message}`
      if (gone.calls.length !== 1) return `a 404 was retried: ${gone.calls.length} calls`
    } finally { gone.restore() }
    return null
  }],

  ['auth: token is cached, renewals dedupe, force and expiry re-request', async () => {
    const g = stubGis([{ access_token: 'tok-1', expires_in: 3600 }, { access_token: 'tok-2', expires_in: 3600 }, { access_token: 'tok-3', expires_in: 3600 }])
    try {
      if (isSignedIn()) return 'signed in before any token was requested'
      const a = await getToken()
      if (a !== 'tok-1') return `first token: ${a}`
      if (!isSignedIn()) return 'isSignedIn false after a successful token'
      const n1: number = g.prompts.length
      if (n1 !== 1) return `one request expected, saw ${n1}`
      if (g.prompts[0] !== '') return `quiet renewal must send prompt '', sent '${g.prompts[0]}'`
      if (await getToken() !== 'tok-1') return 'a valid token was not served from cache'
      const n2: number = g.prompts.length
      if (n2 !== 1) return `cached call still hit GIS: ${n2} requests`
      if (await getToken(true) !== 'tok-2') return 'forceRefresh did not re-request'
      const n3: number = g.prompts.length
      if (n3 !== 2) return `forceRefresh requests: ${n3}`
    } finally { await signOut(); g.restore() }
    // A token whose expires_in has already been consumed by the skew is re-requested.
    const short = stubGis([{ access_token: 'x-1', expires_in: 0 }, { access_token: 'x-2', expires_in: 3600 }])
    try {
      if (await getToken() !== 'x-1') return 'short-lived token was not returned'
      if (isSignedIn()) return 'a token inside the 60s skew still reads as signed in'
      if (await getToken() !== 'x-2') return 'an expired token was served from cache'
    } finally { await signOut(); short.restore() }
    // Concurrent callers share one in-flight renewal rather than racing three popups.
    const dedupe = stubGis([{ access_token: 'd-1', expires_in: 3600 }])
    try {
      const [p, q, r] = await Promise.all([getToken(), getToken(), getToken()])
      if (p !== 'd-1' || q !== 'd-1' || r !== 'd-1') return `concurrent tokens: ${p}/${q}/${r}`
      if (dedupe.prompts.length !== 1) return `concurrent callers made ${dedupe.prompts.length} requests`
    } finally { await signOut(); dedupe.restore() }
    return null
  }],

  ['auth: a failed renewal clears state and never escalates to a popup', async () => {
    const g = stubGis([{ error: 'access_denied' }, { access_token: 'later', expires_in: 3600 }])
    try {
      try {
        await getToken()
        return 'a failed renewal resolved'
      } catch (e) {
        if ((e as Error).name !== 'AuthError') return `wrong error: ${(e as Error).name}`
      }
      if (isSignedIn()) return 'isSignedIn true after a failed renewal'
      if (g.prompts.some(p => p !== '')) return `a failure escalated to a prompt: ${g.prompts.join(',')}`
      // The failure is not sticky: a later request (the user's click) can still succeed.
      if (await getToken() !== 'later') return 'a failed renewal poisoned the module'
    } finally { await signOut(); g.restore() }
    return null
  }],

  ['auth: signOut revokes rather than only clearing', async () => {
    const g = stubGis([{ access_token: 'tok-r', expires_in: 3600 }])
    try {
      await getToken()
      await signOut()
      if (g.revoked.join(',') !== 'tok-r') return `revoked: ${g.revoked.join(',')}`
      if (isSignedIn()) return 'still signed in after signOut'
      await signOut()   // idempotent with no token held
      if (g.revoked.length !== 1) return `a second signOut revoked again: ${g.revoked.length}`
    } finally { g.restore() }
    return null
  }],

  ['state: cache and prefs persist; a version mismatch discards', () => {
    const s = stubStorage()
    try {
      _resetForTest()
      savePrefs({ mood: 'cool', fallbackCategory: 'other' })
      _flushForTest()
      if (localStorage.getItem('bramwell.prefs.v1') === null) return 'prefs were not written'
      _resetForTest()
      if (prefs().mood !== 'cool') return `prefs did not survive a reload: ${JSON.stringify(prefs())}`
      // A cache blob of the wrong version is discarded, not trusted.
      localStorage.setItem('bramwell.cache.v1', JSON.stringify({ v: 99, months: { '2026-02': { state: 'ready', events: [{ id: 'x' }], fetchedAt: 1 } } }))
      _resetForTest()
      if (monthState('2026-02') !== 'absent') return `stale version survived: ${monthState('2026-02')}`
      // So is unparseable rubbish.
      localStorage.setItem('bramwell.cache.v1', '{not json')
      _resetForTest()
      if (monthState('2026-02') !== 'absent') return 'unparseable cache did not discard'
      if (eventsForMonth('2026-02').length !== 0) return 'unparseable cache yielded events'
    } finally { s.restore(); _resetForTest() }
    return null
  }],

  ['state: eventsForMonth resolves category from colorId at read time', () => {
    const s = stubStorage()
    try {
      localStorage.setItem('bramwell.cache.v1', JSON.stringify({
        v: 1,
        months: { '2026-02': { state: 'ready', fetchedAt: 1, events: [
          { id: 'a', title: 'W', allDay: true, colorId: '9', start: civilToDay(2026, 2, 10), end: civilToDay(2026, 2, 10) },
          { id: 'b', title: 'Unknown', allDay: true, colorId: '1', start: civilToDay(2026, 2, 11), end: civilToDay(2026, 2, 11) },
          { id: 'c', title: 'None', allDay: true, start: civilToDay(2026, 2, 12), end: civilToDay(2026, 2, 12) },
        ] } },
      }))
      _resetForTest()
      configure({})
      if (monthState('2026-02') !== 'ready') return `state: ${monthState('2026-02')}`
      const evs = eventsForMonth('2026-02')
      if (evs[0]?.category !== 'work') return `colorId 9 -> ${evs[0]?.category}`
      if (evs[1]?.category !== 'other') return `unknown colorId -> ${evs[1]?.category}`
      if (evs[2]?.category !== 'other') return `absent colorId -> ${evs[2]?.category}`
      // Re-resolution, not a stored value: change the prefs and read again without refetching.
      configure({ categories: [{ name: 'ops', label: 'Ops', colorId: '9' }, { name: 'misc', label: 'Misc', colorId: '8' }], fallbackCategory: 'misc' })
      const again = eventsForMonth('2026-02')
      if (again[0]?.category !== 'ops') return `after reconfigure: ${again[0]?.category}`
      if (again[1]?.category !== 'misc') return `deleted category did not fall back: ${again[1]?.category}`
      configure({})
    } finally { s.restore(); _resetForTest() }
    return null
  }],

  ['state: spansForWeek clips, flags continuation, dedupes across a month boundary', () => {
    const savedAnchor = today()
    const s = stubStorage()
    try {
      // 2026-01-26 (Mon) .. 2026-02-01 (Sun) is one row straddling the month boundary.
      const anchor = civilToDay(2026, 1, 28)
      const crossing = { id: 'cross', title: 'Long', allDay: true, colorId: '9', start: civilToDay(2026, 1, 30), end: civilToDay(2026, 2, 3) }
      const timed = { id: 'timed', title: 'Late', allDay: false, colorId: '9', startMin: 1320, endMin: 30, start: civilToDay(2026, 1, 27), end: civilToDay(2026, 1, 28) }
      const before = { id: 'before', title: 'Earlier', allDay: true, colorId: '9', start: civilToDay(2026, 1, 20), end: civilToDay(2026, 1, 27) }
      localStorage.setItem('bramwell.cache.v1', JSON.stringify({
        v: 1,
        months: {
          // An event crossing the boundary is stored in BOTH months, as types.ts requires.
          '2026-01': { state: 'ready', fetchedAt: 1, events: [crossing, timed, before] },
          '2026-02': { state: 'ready', fetchedAt: 1, events: [crossing] },
        },
      }))
      _resetForTest()
      configure({})
      _setAnchorForTest(anchor)
      const spans = spansForWeek(asWeek(0))
      if (spans.filter(sp => sp.event.id === 'cross').length !== 1) return `crossing event drew ${spans.filter(sp => sp.event.id === 'cross').length} times`
      const c = spans.find(sp => sp.event.id === 'cross')
      if (c?.from !== 4) return `from: ${c?.from} (Fri the 30th is offset 4)`
      if (c?.to !== 6) return `to: ${c?.to} (clipped to Sunday)`
      if (c?.continuesBefore !== false) return 'continuesBefore should be false — it starts in this row'
      if (c?.continuesAfter !== true) return 'continuesAfter should be true — it runs past Sunday'
      const b = spans.find(sp => sp.event.id === 'before')
      if (b?.from !== 0 || b.to !== 1) return `clipped span: ${b?.from}..${b?.to}`
      if (b?.continuesBefore !== true) return 'continuesBefore should be true — it started last row'
      // A timed event crossing midnight renders on its start day only.
      const t = spans.find(sp => sp.event.id === 'timed')
      if (t?.from !== 1 || t.to !== 1) return `timed span: ${t?.from}..${t?.to} — a timed event renders on its start day`
      if (t?.continuesAfter !== false) return 'a midnight-crossing timed event claimed a continuation'
    } finally { s.restore(); _resetForTest(); _setAnchorForTest(savedAnchor) }
    return null
  }],

  ['state: ensureMonthsFor fetches absent months, skips fresh ones, coalesces', async () => {
    const savedAnchor = today()
    const s = stubStorage(), g = stubGis([{ access_token: 'tk', expires_in: 3600 }])
    const f = stubFetch([{ body: { items: [{ id: 'e1', summary: 'E', start: { date: '2026-02-11' }, end: { date: '2026-02-12' } }] } }])
    try {
      _resetForTest(); configure({})
      _setAnchorForTest(civilToDay(2026, 2, 11))   // week 0 = Mon 9th .. Sun 15th, all in 2026-02
      if (monthState('2026-02') !== 'absent') return `before: ${monthState('2026-02')}`
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (monthState('2026-02') !== 'ready') return `after: ${monthState('2026-02')}`
      if (f.calls.length !== 1) return `calls: ${f.calls.length}`
      if (eventsForMonth('2026-02')[0]?.id !== 'e1') return 'fetched events were not stored'
      // A month fetched seconds ago is not refetched.
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (f.calls.length !== 1) return `a fresh month was refetched: ${f.calls.length} calls`
      // Concurrent callers for the same key coalesce into one request.
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      f.calls.length = 0
      ensureMonthsFor([asWeek(0)])
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (f.calls.length !== 1) return `concurrent callers made ${f.calls.length} requests`
      // A week straddling a boundary pulls both months.
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 1, 28))
      f.calls.length = 0
      ensureMonthsFor([asWeek(0)])   // Mon 2026-01-26 .. Sun 2026-02-01
      await _settleForTest()
      if (f.calls.length !== 2) return `a straddling week fetched ${f.calls.length} months`
    } finally { await signOut(); f.restore(); g.restore(); s.restore(); _resetForTest(); _setAnchorForTest(savedAnchor) }
    return null
  }],

  ['state: a failed refresh sets error and keeps the prior events', async () => {
    const savedAnchor = today()
    const s = stubStorage(), g = stubGis([{ access_token: 'tk', expires_in: 3600 }])
    try {
      localStorage.setItem('bramwell.cache.v1', JSON.stringify({
        v: 1,
        months: { '2026-02': { state: 'ready', fetchedAt: 1, events: [{ id: 'old', title: 'Old', allDay: true, start: civilToDay(2026, 2, 11), end: civilToDay(2026, 2, 11) }] } },
      }))
      _resetForTest(); configure({})
      _setAnchorForTest(civilToDay(2026, 2, 11))
      const f = stubFetch([{ status: 404, body: { error: { errors: [{ reason: 'notFound' }] } } }])
      try {
        ensureMonthsFor([asWeek(0)])
        await _settleForTest()
        if (monthState('2026-02') !== 'error') return `state after failure: ${monthState('2026-02')}`
        if (eventsForMonth('2026-02')[0]?.id !== 'old') return 'a failed refresh blanked a month that was on screen'
      } finally { f.restore() }
    } finally { await signOut(); g.restore(); s.restore(); _resetForTest(); _setAnchorForTest(savedAnchor) }
    return null
  }],

  ['state: withToken retries a 401 exactly once with a fresh token', async () => {
    const savedAnchor = today()
    const s = stubStorage()
    const g = stubGis([{ access_token: 'stale', expires_in: 3600 }, { access_token: 'fresh', expires_in: 3600 }])
    const f = stubFetch([{ status: 401, body: {} }, { body: { items: [] } }])
    try {
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (f.calls.length !== 2) return `expected one retry, saw ${f.calls.length} calls`
      if (f.calls[0]?.headers['authorization'] !== 'Bearer stale') return `first token: ${f.calls[0]?.headers['authorization']}`
      if (f.calls[1]?.headers['authorization'] !== 'Bearer fresh') return `retry token: ${f.calls[1]?.headers['authorization']}`
      if (monthState('2026-02') !== 'ready') return `state: ${monthState('2026-02')}`
      // One 401 then success: the fresh token stands, so the session is still signed in.
      // Asserted before the finally, whose signOut() would clear it either way.
      if (!isSignedIn()) return 'a recovered 401 left the session signed out'
    } finally { await signOut(); f.restore(); g.restore(); s.restore(); _resetForTest(); _setAnchorForTest(savedAnchor) }
    // A second 401 surfaces rather than looping, and invalidates the token.
    const s2 = stubStorage()
    const g2 = stubGis([{ access_token: 'a', expires_in: 3600 }, { access_token: 'b', expires_in: 3600 }])
    const f2 = stubFetch([{ status: 401, body: {} }])
    try {
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (f2.calls.length !== 2) return `a repeated 401 made ${f2.calls.length} calls`
      if (monthState('2026-02') !== 'error') return `a repeated 401 left state ${monthState('2026-02')}`
      // SPEC "Auth": any 401 -> getToken(true) once; if the retry also 401s, invalidateToken()
      // then rethrow. Without the clear, isSignedIn() would stay true and stage 05's reconnect
      // pill — bound to auth state — would never appear: the dead state SPEC forbids.
      // Asserted before the finally, whose signOut() would mask it.
      if (isSignedIn()) return 'two consecutive 401s left isSignedIn() true — the dead state SPEC forbids'
    } finally { await signOut(); f2.restore(); g2.restore(); s2.restore(); _resetForTest(); _setAnchorForTest(savedAnchor) }
    return null
  }],

  ['state: onCacheChange notifies with changed keys and unsubscribes', async () => {
    const savedAnchor = today()
    const s = stubStorage(), g = stubGis([{ access_token: 'tk', expires_in: 3600 }])
    const f = stubFetch([{ body: { items: [] } }])
    try {
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      const seen: string[] = []
      const off = onCacheChange(keys => { seen.push(keys.join('+')) })
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (seen.length === 0) return 'no notification was delivered'
      if (!seen.every(k => k === '2026-02')) return `keys: ${seen.join(' / ')}`
      off()
      const before = seen.length
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (seen.length !== before) return 'an unsubscribed listener was still called'
    } finally { await signOut(); f.restore(); g.restore(); s.restore(); _resetForTest(); _setAnchorForTest(savedAnchor) }
    return null
  }],

  ['state: create applies optimistically, then reconciles from the server', async () => {
    const savedAnchor = today()
    const s = stubStorage(), g = stubGis([{ access_token: 'tk', expires_in: 3600 }])
    const f = stubFetch([
      { body: { id: 'real-1', summary: 'Trip', colorId: '9', start: { date: '2026-02-20' }, end: { date: '2026-02-23' } } },
      { body: { items: [{ id: 'real-1', summary: 'Trip', colorId: '9', start: { date: '2026-02-20' }, end: { date: '2026-02-23' } }] } },
    ])
    try {
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      const inflight = createEvent({
        title: 'Trip', category: 'work', allDay: true,
        start: civilToDay(2026, 2, 20), end: civilToDay(2026, 2, 22), repeat: 'none',
      })
      // The optimistic apply is synchronous (pending.set + notify before the first await),
      // so the overlay is observable right now, before the write settles.
      const overlay = eventsForMonth('2026-02').filter(e => e.id.startsWith('tmp:'))
      if (overlay.length !== 1) return `optimistic overlay entries: ${overlay.map(e => e.id).join(',') || 'none'}`
      const opt = overlay[0]
      if (opt === undefined) return 'optimistic overlay entry missing'
      if (opt.title !== 'Trip') return `optimistic title: ${opt.title}`
      if (opt.category !== 'work') return `optimistic category: ${opt.category}`
      if (opt.allDay !== true) return `optimistic allDay: ${opt.allDay}`
      if ('startMin' in opt) return `optimistic entry carried startMin: ${String((opt as { startMin?: number }).startMin)}`
      const saved = await inflight
      if (saved.id !== 'real-1') return `reconciled id: ${saved.id}`
      if (saved.category !== 'work') return `category: ${saved.category}`
      const evs = eventsForMonth('2026-02')
      if (evs.filter(e => e.id === 'real-1').length !== 1) return `after reconcile: ${evs.map(e => e.id).join(',')}`
      if (evs.some(e => e.id.startsWith('tmp:'))) return 'the optimistic entry was not dropped'
      if (f.calls[0]?.method !== 'POST') return `first call: ${f.calls[0]?.method}`
      // The colorId came from the category name, resolved by state.ts, not by gcal.ts.
      if ((f.calls[0]?.body as { colorId?: string }).colorId !== '9') return 'colorId was not resolved from the category'
      if (f.calls[1]?.method !== 'GET') return 'the touched month was not refetched'
    } finally { await signOut(); f.restore(); g.restore(); s.restore(); _resetForTest(); _setAnchorForTest(savedAnchor) }
    return null
  }],

  ['state: a failed create rolls the overlay back and rethrows', async () => {
    const savedAnchor = today()
    const s = stubStorage(), g = stubGis([{ access_token: 'tk', expires_in: 3600 }])
    const f = stubFetch([{ status: 403, body: { error: { errors: [{ reason: 'insufficientPermissions' }] } } }])
    try {
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      const before = eventsForMonth('2026-02').length
      try {
        await createEvent({ title: 'Doomed', category: 'work', allDay: true, start: civilToDay(2026, 2, 20), end: civilToDay(2026, 2, 20), repeat: 'none' })
        return 'a failed create resolved'
      } catch (e) {
        if (!(e instanceof GcalError) || e.status !== 403) return `wrong error: ${(e as Error).message}`
      }
      const after = eventsForMonth('2026-02')
      if (after.length !== before) return `rollback left ${after.length - before} extra event(s)`
      if (after.some(e => e.title === 'Doomed')) return 'the optimistic create survived the failure'
    } finally { await signOut(); f.restore(); g.restore(); s.restore(); _resetForTest(); _setAnchorForTest(savedAnchor) }
    return null
  }],

  ['state: scope picks the id, and a series write stales every resident month', async () => {
    const savedAnchor = today()
    const s = stubStorage(), g = stubGis([{ access_token: 'tk', expires_in: 3600 }])
    try {
      const inst = { id: 'inst-1', recurringEventId: 'series-1', title: 'Weekly', allDay: true, colorId: '9', start: civilToDay(2026, 2, 11), end: civilToDay(2026, 2, 11) }
      const seed = () => {
        localStorage.setItem('bramwell.cache.v1', JSON.stringify({
          v: 1,
          months: {
            '2026-02': { state: 'ready', fetchedAt: Date.now(), events: [inst] },
            '2026-03': { state: 'ready', fetchedAt: Date.now(), events: [] },
          },
        }))
        _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      }
      // Instance scope PATCHes the occurrence id and refetches only the touched month.
      seed()
      const one = stubFetch([
        { body: { id: 'inst-1', summary: 'Renamed', colorId: '9', start: { date: '2026-02-11' }, end: { date: '2026-02-12' } } },
        { body: { items: [] } },
      ])
      try {
        await updateEvent('inst-1', { title: 'Renamed', category: 'work', allDay: true, start: civilToDay(2026, 2, 11), end: civilToDay(2026, 2, 11), repeat: 'none' }, 'instance')
        if (!(one.calls[0]?.url ?? '').endsWith('/events/inst-1')) return `instance url: ${one.calls[0]?.url}`
        const refetched = one.calls.filter(c => c.method === 'GET').length
        if (refetched !== 1) return `instance scope refetched ${refetched} months`
      } finally { one.restore() }
      // Series scope PATCHes the series id and refetches every resident month.
      seed()
      const many = stubFetch([
        { body: { id: 'series-1', summary: 'Renamed', colorId: '9', start: { date: '2026-02-11' }, end: { date: '2026-02-12' } } },
        { body: { items: [] } },
      ])
      try {
        await updateEvent('inst-1', { title: 'Renamed', category: 'work', allDay: true, start: civilToDay(2026, 2, 11), end: civilToDay(2026, 2, 11), repeat: 'none' }, 'series')
        if (!(many.calls[0]?.url ?? '').endsWith('/events/series-1')) return `series url: ${many.calls[0]?.url}`
        const refetched = many.calls.filter(c => c.method === 'GET').length
        if (refetched !== 2) return `series scope refetched ${refetched} months, expected every resident month (2)`
      } finally { many.restore() }
      // Delete follows the same id choice and removes the event optimistically.
      seed()
      const del = stubFetch([{ status: 204 }, { body: { items: [] } }])
      try {
        await deleteEvent('inst-1', 'series')
        if (!(del.calls[0]?.url ?? '').endsWith('/events/series-1')) return `delete url: ${del.calls[0]?.url}`
        if (eventsForMonth('2026-02').some(e => e.id === 'inst-1')) return 'the deleted event survived'
      } finally { del.restore() }
    } finally { await signOut(); g.restore(); s.restore(); _resetForTest(); _setAnchorForTest(savedAnchor) }
    return null
  }],
  ['state: a write forces a fresh fetch instead of joining the load already in flight', async () => {
    const savedAnchor = today()
    const s = stubStorage(), g = stubGis([{ access_token: 'tk', expires_in: 3600 }])
    const oldWire = { id: 'old-1', summary: 'Old', colorId: '9', start: { date: '2026-02-20' }, end: { date: '2026-02-21' } }
    const newWire = { id: 'real-9', summary: 'New', colorId: '9', start: { date: '2026-02-21' }, end: { date: '2026-02-22' } }
    const f = stubFetch([
      // GET 1: issued before the POST and held open past it, so its body CANNOT carry the write.
      { delayMs: 20, body: { items: [oldWire] } },
      { body: newWire },                              // POST
      { body: { items: [oldWire, newWire] } },        // GET 2: the forced refetch, issued after the POST
    ])
    try {
      localStorage.setItem('bramwell.cache.v1', JSON.stringify({
        v: 1,
        months: {
          // ready but stale, so ensureMonthsFor starts a load rather than skipping the month.
          '2026-02': {
            state: 'ready', fetchedAt: Date.now() - 10 * 60_000,
            events: [{ id: 'old-1', title: 'Old', allDay: true, colorId: '9', start: civilToDay(2026, 2, 20), end: civilToDay(2026, 2, 20) }],
          },
        },
      }))
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      ensureMonthsFor([asWeek(0)])
      if (monthState('2026-02') !== 'loading') return `no load in flight: ${monthState('2026-02')}`
      const saved = await createEvent({
        title: 'New', category: 'work', allDay: true,
        start: civilToDay(2026, 2, 21), end: civilToDay(2026, 2, 21), repeat: 'none',
      })
      if (saved.id !== 'real-9') return `created id: ${saved.id}`
      const ids = eventsForMonth('2026-02').map(e => e.id).join(',')
      if (!ids.split(',').includes('real-9')) return `the write vanished behind the in-flight load: ${ids || 'none'}`
      const methods = f.calls.map(c => c.method).join(',')
      if (methods !== 'GET,POST,GET') return `call sequence: ${methods} — the refetch must not join the earlier GET`
      await _settleForTest()
    } finally { await signOut(); f.restore(); g.restore(); s.restore(); _resetForTest(); _setAnchorForTest(savedAnchor) }
    return null
  }],

  ['state: an edit never sends recurrence, and a series edit never sends dates', async () => {
    const savedAnchor = today()
    const s = stubStorage(), g = stubGis([{ access_token: 'tk', expires_in: 3600 }])
    try {
      const inst = { id: 'inst-9', recurringEventId: 'series-9', title: 'Weekly', allDay: true, colorId: '9', start: civilToDay(2026, 2, 25), end: civilToDay(2026, 2, 25) }
      const seed = () => {
        localStorage.setItem('bramwell.cache.v1', JSON.stringify({
          v: 1, months: { '2026-02': { state: 'ready', fetchedAt: Date.now(), events: [inst] } },
        }))
        _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      }
      // The editor's draft still carries `repeat`; state.ts must not forward it.
      const draft: EventDraft = {
        title: 'Renamed', category: 'work', notes: 'n', allDay: true,
        start: civilToDay(2026, 2, 25), end: civilToDay(2026, 2, 25), repeat: 'weekly',
      }
      seed()
      const one = stubFetch([
        { body: { id: 'inst-9', summary: 'Renamed', colorId: '9', start: { date: '2026-02-25' }, end: { date: '2026-02-26' } } },
        { body: { items: [] } },
      ])
      try {
        await updateEvent('inst-9', draft, 'instance')
        const body = (one.calls[0]?.body ?? {}) as Record<string, unknown>
        if ('recurrence' in body) return 'an instance edit sent recurrence against an instance id'
        if (body['summary'] !== 'Renamed') return `instance summary: ${String(body['summary'])}`
        if (!('start' in body) || !('end' in body)) return 'an instance edit dropped its own dates'
      } finally { one.restore() }
      seed()
      const many = stubFetch([
        // The master starts weeks before the edited occurrence; a date write here would move it.
        { body: { id: 'series-9', summary: 'Renamed', colorId: '9', start: { date: '2026-02-04' }, end: { date: '2026-02-05' } } },
        { body: { items: [] } },
      ])
      try {
        await updateEvent('inst-9', draft, 'series')
        const body = (many.calls[0]?.body ?? {}) as Record<string, unknown>
        if ('recurrence' in body) return 'a series edit sent recurrence'
        if ('start' in body || 'end' in body) return 'a series edit rewrote the master dates from one occurrence'
        if (body['summary'] !== 'Renamed') return `series summary: ${String(body['summary'])}`
        if (body['colorId'] !== '9') return `series colorId: ${String(body['colorId'])}`
        if (body['description'] !== 'n') return `series notes: ${String(body['description'])}`
      } finally { many.restore() }
    } finally { await signOut(); g.restore(); s.restore(); _resetForTest(); _setAnchorForTest(savedAnchor) }
    return null
  }],

  ['auth: a gesture issues its own request rather than joining a quiet renewal', async () => {
    // A GIS stub that DEFERS its callback, so two requests are genuinely in flight at once.
    const prompts: string[] = []
    const held: { cb: ((r: StubToken) => void) | null } = { cb: null }
    const fake = {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: { callback: (r: StubToken) => void }) => {
            held.cb = cfg.callback
            return { requestAccessToken: (req?: { prompt?: string }) => { prompts.push(req?.prompt ?? '<none>') } }
          },
          revoke: (_t: string, done?: () => void) => { done?.() },
        },
      },
    }
    const had = 'google' in globalThis
    const real = had ? (globalThis as { google?: unknown }).google : undefined
    Object.defineProperty(globalThis, 'google', { value: fake, configurable: true, writable: true })
    const tick = () => new Promise<void>(r => { setTimeout(r, 0) })
    try {
      // (a) concurrent quiet renewals still share ONE request.
      const a = getToken(), b = getToken(), c = getToken()
      await tick()
      // Widened to number: otherwise the first check narrows the literal type and the second
      // comparison is rejected as having no overlap.
      const quiet: number = prompts.length
      if (quiet !== 1) return `three concurrent getToken() made ${quiet} requests`
      // (b) a gesture raised in that window issues its OWN request rather than joining it.
      const gesture = signIn()
      await tick()
      const total: number = prompts.length
      if (total !== 2) return `a gesture during a quiet renewal made ${total} requests in total`
      // FIFO: the quiet renewal asked first, so it owns the first reply.
      held.cb?.({ access_token: 'quiet', expires_in: 3600 })
      const [ta, tb, tc] = await Promise.all([a, b, c])
      if (ta !== 'quiet' || tb !== 'quiet' || tc !== 'quiet') return `quiet renewal tokens: ${ta}/${tb}/${tc}`
      held.cb?.({ access_token: 'gesture', expires_in: 3600 })
      // A single settle slot would have been overwritten, leaving this pending forever.
      const settled = await Promise.race([
        gesture.then(() => 'ok'),
        new Promise<string>(r => { setTimeout(() => r('never'), 250) }),
      ])
      if (settled !== 'ok') return 'the gesture promise never settled — its settler was overwritten'
      if (!isSignedIn()) return 'the gesture left no live token'
      if (await getToken() !== 'gesture') return 'the token held is not the gesture token'
    } finally {
      await signOut()
      if (had) Object.defineProperty(globalThis, 'google', { value: real, configurable: true, writable: true })
      else Reflect.deleteProperty(globalThis as object, 'google')
    }
    return null
  }],

  ['scroll: row height clamps and excludes the header', () => {
    // 6.5 rows fill the area BELOW the sticky header, or "6.5 weeks fill the
    // viewport" is false by exactly one header.
    if (rowHeightFor(844, 56) !== (844 - 56) / 6.5) return `phone: ${rowHeightFor(844, 56)}`
    if (rowHeightFor(400, 56) !== 74) return `short viewport did not clamp to MIN_ROW_H: ${rowHeightFor(400, 56)}`
    if (rowHeightFor(4000, 56) !== 190) return `tall viewport did not clamp to MAX_ROW_H: ${rowHeightFor(4000, 56)}`
    if (rowHeightFor(900, 56) <= 74 || rowHeightFor(900, 56) >= 190) return 'desktop should sit inside the clamps'
    return null
  }],

  ['scroll: posOf/heightOf/weekAtY round-trip, uniform and expanded', () => {
    const H = 120
    for (const ex of [null, { week: asWeek(3), delta: 260 }] as Expanded[]) {
      for (let w = -5; w <= 10; w++) {
        const week = asWeek(w)
        const y = posOf(week, H, ex)
        if (weekAtY(y, H, ex) !== w) return `${ex ? 'expanded' : 'uniform'}: week ${w} -> y ${y} -> ${weekAtY(y, H, ex)}`
        // every point inside a row maps back to that row
        const mid = y + heightOf(week, H, ex) / 2
        if (weekAtY(mid, H, ex) !== w) return `${ex ? 'expanded' : 'uniform'}: midpoint of week ${w} -> ${weekAtY(mid, H, ex)}`
      }
    }
    const ex: Expanded = { week: asWeek(3), delta: 260 }
    if (heightOf(asWeek(3), H, ex) !== H + 260) return 'the expanded row did not grow'
    if (heightOf(asWeek(2), H, ex) !== H) return 'a row above the expanded one changed height'
    if (heightOf(asWeek(4), H, ex) !== H) return 'a row below the expanded one changed height'
    if (posOf(asWeek(2), H, ex) !== posOf(asWeek(2), H, null)) return 'a row ABOVE the expanded one moved'
    if (posOf(asWeek(4), H, ex) !== posOf(asWeek(4), H, null) + 260) return 'a row below did not shift by exactly delta'
    // delta 0 must be indistinguishable from no expansion — this is what stage 03 ships with
    for (let w = -3; w <= 6; w++) {
      if (posOf(asWeek(w), H, { week: asWeek(3), delta: 0 }) !== posOf(asWeek(w), H, null)) return `delta 0 differed at week ${w}`
    }
    return null
  }],

  ['scroll: anchor sequence and the 15/30/45 modulus', () => {
    const d = (y: number, m: number, day: number) => civilToDay(y, m, day)
    const show = (n: DayNumber) => { const c = dayToCivil(n); return `${c.y}-${c.m}-${c.d}` }
    // modulus 1 (setting 15): every anchor — the 1st and the 16th
    if (nearestAnchor(d(2026, 3, 10), 1, 1) !== d(2026, 3, 16)) return `15 next from Mar 10: ${show(nearestAnchor(d(2026, 3, 10), 1, 1))}`
    if (nearestAnchor(d(2026, 3, 20), 1, 1) !== d(2026, 4, 1)) return `15 next from Mar 20: ${show(nearestAnchor(d(2026, 3, 20), 1, 1))}`
    if (nearestAnchor(d(2026, 3, 10), 1, -1) !== d(2026, 3, 1)) return `15 prev from Mar 10: ${show(nearestAnchor(d(2026, 3, 10), 1, -1))}`
    // modulus 2 (setting 30): the 1st of each month only
    if (nearestAnchor(d(2026, 3, 10), 2, 1) !== d(2026, 4, 1)) return `30 next from Mar 10: ${show(nearestAnchor(d(2026, 3, 10), 2, 1))}`
    if (nearestAnchor(d(2026, 3, 20), 2, -1) !== d(2026, 3, 1)) return `30 prev from Mar 20: ${show(nearestAnchor(d(2026, 3, 20), 2, -1))}`
    // modulus 3 (setting 45): every third anchor — 1.5 months apart
    const a = nearestAnchor(d(2026, 1, 5), 3, 1)
    const b = nearestAnchor(a, 3, 1)
    const c = nearestAnchor(b, 3, 1)
    const gaps = [show(a), show(b), show(c)].join(' ')
    if (gaps !== '2026-2-16 2026-4-1 2026-5-16') return `45 sequence: ${gaps}`
    // year boundary
    if (nearestAnchor(d(2026, 12, 20), 2, 1) !== d(2027, 1, 1)) return `year roll: ${show(nearestAnchor(d(2026, 12, 20), 2, 1))}`
    if (nearestAnchor(d(2027, 1, 5), 2, -1) !== d(2027, 1, 1)) return `back over year roll: ${show(nearestAnchor(d(2027, 1, 5), 2, -1))}`
    // dir 0 picks the closer side
    if (nearestAnchor(d(2026, 3, 3), 2, 0) !== d(2026, 3, 1)) return `nearest from Mar 3: ${show(nearestAnchor(d(2026, 3, 3), 2, 0))}`
    if (nearestAnchor(d(2026, 3, 28), 2, 0) !== d(2026, 4, 1)) return `nearest from Mar 28: ${show(nearestAnchor(d(2026, 3, 28), 2, 0))}`
    // every returned anchor is a 1st or a 16th, never a rolling day count
    for (const m of [1, 2, 3] as const) {
      for (let k = 0; k < 12; k++) {
        const day = dayToCivil(nearestAnchor(d(2026, 1, 1 + k * 29), m, 1)).d
        if (day !== 1 && day !== 16) return `modulus ${m} returned day-of-month ${day}`
      }
    }
    return null
  }],

  ['scroll: snap target puts the anchor row top at viewport centre', () => {
    const H = 120, VP = 780
    const t = snapTargetY(asWeek(4), H, null, VP)
    // Scrolled to t, the top edge of week 4 sits at exactly SNAP_ALIGN of the viewport.
    if (posOf(asWeek(4), H, null) - t !== VP * 0.5) return `anchor row top landed at ${posOf(asWeek(4), H, null) - t}, want ${VP * 0.5}`
    // With a row expanded above it, the target shifts by exactly delta and the
    // anchor still lands dead centre.
    const ex: Expanded = { week: asWeek(1), delta: 300 }
    const t2 = snapTargetY(asWeek(4), H, ex, VP)
    if (t2 - t !== 300) return `expanded row above did not shift the target by delta: ${t2 - t}`
    if (posOf(asWeek(4), H, ex) - t2 !== VP * 0.5) return 'anchor did not stay centred with a row expanded above'
    return null
  }],

  ['scroll: fitY keeps the expanded row on screen without pushing its top off', () => {
    const H = 120, VH = 700
    // Week 2's top sits at 240; y = 0 means the viewport starts at the top of week 0.
    const ex: Expanded = { week: asWeek(2), delta: 300 }
    // Fully visible already (240 + 420 = 660 <= 700): nothing moves.
    if (fitY(0, ex, H, VH) !== 0) return `visible row moved: ${fitY(0, ex, H, VH)}`
    // No expansion is never a reason to scroll.
    if (fitY(137, null, H, VH) !== 137) return 'fitY moved the view with nothing expanded'
    // Overruns the bottom by 20 (top 300, bottom 720 = 300 + (120 + 300)): shift up by exactly 20.
    if (fitY(-60, ex, H, VH) !== -40) return `bottom overrun: ${fitY(-60, ex, H, VH)}`
    // Row taller than the viewport: clamp at the row's own top, never past it.
    const tall: Expanded = { week: asWeek(2), delta: 900 }
    const clamped = fitY(0, tall, H, VH)
    if (clamped !== 240) return `tall row did not clamp to its own top: ${clamped}`
    if (posOf(asWeek(2), H, tall) - clamped !== 0) return 'the clamped row top is not at the fold'
    // Row above the fold: pull it down to the top edge, not past it.
    if (fitY(400, ex, H, VH) !== 240) return `above the fold: ${fitY(400, ex, H, VH)}`
    // Idempotent — fitting an already-fitted view is a no-op.
    const once = fitY(-500, ex, H, VH)
    if (fitY(once, ex, H, VH) !== once) return `not idempotent: ${once} -> ${fitY(once, ex, H, VH)}`
    return null
  }],

  ['scroll: projection, settle duration and easing', () => {
    // velocity is px/ms; projection looks PROJECT_MS ahead
    if (projectY(1000, 0) !== 1000) return 'zero velocity moved the projection'
    if (projectY(1000, 2) !== 1000 + 2 * 300) return `projectY: ${projectY(1000, 2)}`
    if (projectY(1000, -2) !== 1000 - 2 * 300) return `negative projectY: ${projectY(1000, -2)}`
    // settle: base at zero distance, grows per week, capped
    if (settleMs(0, 120) !== 280) return `settle at rest: ${settleMs(0, 120)}`
    if (settleMs(120, 120) !== 280 + 42) return `settle one row: ${settleMs(120, 120)}`
    if (settleMs(120 * 100, 120) !== 760) return `settle did not cap: ${settleMs(120 * 100, 120)}`
    if (settleMs(-120, 120) !== 280 + 42) return 'settle ignored direction'
    // easing: anchored, monotonic, and decelerating (it must not hard-stop)
    if (easeOutCubic(0) !== 0 || easeOutCubic(1) !== 1) return 'easing is not anchored at 0 and 1'
    let prev = -1
    for (let i = 0; i <= 20; i++) {
      const v = easeOutCubic(i / 20)
      if (v < prev) return 'easing is not monotonic'
      prev = v
    }
    if (!(easeOutCubic(0.5) > 0.5)) return 'easeOutCubic must be above the diagonal (decelerating)'
    return null
  }],

  ['categories: the mood ladder holds in both schemes', () => {
    const lightness = (hex: string) => {
      const n = parseInt(hex.slice(1), 16)
      const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
      return (Math.max(r, g, b) + Math.min(r, g, b)) / 2
    }
    const grab = (css: string, scheme: 'light' | 'dark', token: string): string => {
      // the dark block is everything after the media query opener
      const idx = css.indexOf('@media (prefers-color-scheme: dark)')
      const hay = scheme === 'light' ? css.slice(0, idx) : css.slice(idx)
      const m = new RegExp(`--${token}:\\s*(#[0-9A-Fa-f]{6})`).exec(hay)
      return m?.[1] ?? ''
    }
    configure({})
    for (const mood of ['warm', 'paper', 'cool', 'sage', 'dusk'] as MoodId[]) {
      const css = themeCss(mood)
      for (const scheme of ['light', 'dark'] as const) {
        const rung = ['surface', 'band-a-end', 'band-a', 'band-b-end', 'band-b']
          .map(t => ({ t, hex: grab(css, scheme, t) }))
        for (const { t, hex } of rung) {
          if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return `${mood}/${scheme}: --${t} missing or malformed (${hex || 'absent'})`
        }
        // The ladder: ground darkest, then weekend-a, a, weekend-b, b. Identical
        // ordering in both schemes — light inverts the SURFACE logic, not the ladder.
        for (let i = 1; i < rung.length; i++) {
          const lo = rung[i - 1]!, hi = rung[i]!
          if (!(lightness(hi.hex) > lightness(lo.hex))) {
            return `${mood}/${scheme}: --${hi.t} (${hi.hex}) is not lighter than --${lo.t} (${lo.hex})`
          }
        }
        // A weekend sits UNDER its own band, not beside it.
        const byToken = Object.fromEntries(rung.map(r => [r.t, r.hex]))
        if (!(lightness(byToken['band-a-end']!) < lightness(byToken['band-a']!))) return `${mood}/${scheme}: weekend a is not under band a`
        if (!(lightness(byToken['band-b-end']!) < lightness(byToken['band-b']!))) return `${mood}/${scheme}: weekend b is not under band b`
      }
    }
    // The seed near-black belongs to Cool, not Warm — it was always hue 220.
    if (grab(themeCss('cool'), 'dark', 'surface').toUpperCase() !== '#0F1115') return 'cool/dark ground is no longer the seed near-black'
    return null
  }],

  ['render: lane packing is longest-first, compact and deterministic', () => {
    const ev = (id: string, allDay: boolean) => ({
      id, title: id, category: 'work', allDay, start: asDay(0), end: asDay(0),
    } as unknown as CalendarEvent)   // why: only id/allDay/category are read by packLanes
    const span = (id: string, from: number, to: number, allDay = true): EventSpan => ({
      event: ev(id, allDay), week: asWeek(0),
      from: asOffset(from), to: asOffset(to), continuesBefore: false, continuesAfter: false,
    })
    // A long span must take lane 0 even though a short one starts earlier —
    // but the short span does not overlap it (day 0 vs days 1-6), so true
    // interval packing gives it lane 0 too, sharing rather than wasting a lane.
    const a = packLanes([span('short', 0, 0), span('long', 1, 6)])
    if (a.find(s => s.event.id === 'long')?.lane !== 0) return `longest-first violated: long got lane ${a.find(s => s.event.id === 'long')?.lane}`
    if (a.find(s => s.event.id === 'short')?.lane !== 0) return `short got lane ${a.find(s => s.event.id === 'short')?.lane}, expected 0 (it does not overlap long)`
    // Non-overlapping spans of equal length share a lane.
    const b = packLanes([span('x', 0, 1), span('y', 3, 4)])
    if (b[0]?.lane !== 0 || b[1]?.lane !== 0) return `disjoint spans did not share a lane: ${b.map(s => s.lane).join(',')}`
    // Overlapping spans never share one.
    const c = packLanes([span('p', 0, 3), span('q', 2, 5)])
    if (c[0]?.lane === c[1]?.lane) return 'overlapping spans shared a lane'
    // Timed events are chips, never bars (DECISIONS "In force — scroll and render").
    const d = packLanes([span('bar', 0, 2, true), span('chip', 0, 2, false)])
    if (d.length !== 1 || d[0]?.event.id !== 'bar') return `timed event was packed as a bar: ${d.map(s => s.event.id).join(',')}`
    // Deterministic: input order must not change the result, or a repaint
    // reshuffles lanes under the user.
    const input = [span('m', 0, 2), span('n', 0, 2), span('o', 3, 6), span('p', 1, 1)]
    const once = packLanes(input).map(s => `${s.event.id}:${s.lane}`).sort().join(' ')
    const again = packLanes([...input].reverse()).map(s => `${s.event.id}:${s.lane}`).sort().join(' ')
    if (once !== again) return `not deterministic:\n  ${once}\n  ${again}`
    return null
  }],

  ['render: visibilityFor never drops a hidden bar or a spilled chip (Critical regression)', () => {
    // Hand-built packed spans — visibilityFor only reads from/to/lane, so a
    // full EventSpan is not needed. This calls the REAL exported arithmetic
    // renderWeek itself calls; it does not re-derive a copy of it, which is
    // exactly what made the previous version of this case vacuous.
    const bar = (from: number, to: number, lane: number): PackedSpan =>
      ({ from: asOffset(from), to: asOffset(to), lane } as unknown as PackedSpan)
      // why: visibilityFor's body only touches from/to/lane; event/week/
      // continuesBefore/continuesAfter are never read.

    // L: lane 0, days 0-3 (visible at cap 1). M: lane 1, days 2-5 (hidden at
    // cap 1) — overlapping L on days 2-3, alone on days 4-5.
    const packed = [bar(0, 3, 0), bar(2, 5, 1)]
    const cap = 1
    // Day 0: L alone, room to spare, but 2 chips still can't fit past cap 1
    // once L holds the only slot — those chips must spill into overflow.
    // Day 6: no bars at all, exactly 1 chip — fits with room to spare.
    const chipCounts = [2, 0, 0, 0, 0, 0, 1]
    const v = visibilityFor(packed, chipCounts, cap)
    if (v.length !== 7) return `expected 7 entries, got ${v.length}`

    // A bar at or above cap must be counted as hidden, with overflow > 0,
    // on every single day it covers — days 2-5 for M (days 2-3 also carry
    // L visible; days 4-5 M is the only bar present at all).
    for (const o of [2, 3, 4, 5]) {
      const day = v[o]!
      if (day.hiddenBars < 1) return `day ${o}: expected hiddenBars >= 1, got ${day.hiddenBars}`
      if (day.overflow < 1) return `day ${o}: a hidden bar vanished with no "+N" — overflow=${day.overflow}`
    }
    // Day 4 specifically: no visible bar, no chips, exactly the hidden M.
    if (v[4]!.visibleBars !== 0) return `day 4: expected 0 visible bars, got ${v[4]!.visibleBars}`
    if (v[4]!.overflow !== 1) return `day 4: expected overflow 1, got ${v[4]!.overflow}`

    // Chips that don't fit in remaining room are counted too, not just bars.
    if (v[0]!.chipsShown !== 0) return `day 0: expected 0 chips shown (no room), got ${v[0]!.chipsShown}`
    if (v[0]!.overflow !== 2) return `day 0: expected both spilled chips in overflow, got ${v[0]!.overflow}`

    // A day where everything fits shows no "+N" at all.
    if (v[6]!.chipsShown !== 1) return `day 6: expected the 1 chip shown, got ${v[6]!.chipsShown}`
    if (v[6]!.overflow !== 0) return `day 6: expected overflow 0 when everything fits, got ${v[6]!.overflow}`
    return null
  }],

  ['render: the expanded row column template, desktop and phone', () => {
    // Every track is minmax(0, Nfr) — never a bare <flex> — so a collapsed
    // neighbour's minimum is a literal 0, not an auto (content) floor, and so
    // the template's track-sizing FUNCTION matches style.css's resting rule
    // (round 4 review: a mismatched function type is where
    // grid-template-columns stops interpolating and starts snapping).
    const desk = columnsFor(asOffset(2), false)
    if (desk !== 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 3fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)') {
      return `desktop offset 2: "${desk}"`
    }
    const phone = columnsFor(asOffset(0), true)
    if (phone !== 'minmax(0, 1fr) minmax(0, 0fr) minmax(0, 0fr) minmax(0, 0fr) minmax(0, 0fr) minmax(0, 0fr) minmax(0, 0fr)') {
      return `phone offset 0: "${phone}"`
    }
    const last = columnsFor(asOffset(6), true)
    if (last !== 'minmax(0, 0fr) minmax(0, 0fr) minmax(0, 0fr) minmax(0, 0fr) minmax(0, 0fr) minmax(0, 0fr) minmax(0, 1fr)') {
      return `phone offset 6: "${last}"`
    }
    // Always exactly seven tracks, or the bar overlay stops lining up with the row.
    for (let o = 0; o <= 6; o++) {
      for (const full of [false, true]) {
        const parts = columnsFor(asOffset(o), full).split(/(?<=\)) /)
        if (parts.length !== 7) return `offset ${o} full=${full}: ${parts.length} tracks`
        // Every track keeps the SAME function shape — only the flex factor
        // varies, and the factor is unsigned (a negative flex factor is not
        // a valid track).
        if (!parts.every(p => /^minmax\(0, \d+fr\)$/.test(p))) return `offset ${o} full=${full}: not uniform minmax(0, Nfr): ${parts}`
        // The picked track's flex factor is what actually distinguishes
        // phone from desktop — 3fr there, 1fr here — pinned to the exact
        // expected value, not merely "one of the two". An earlier version of
        // this check instead compared the whole templates for `full` and
        // `!full` as strings, which is always true by construction (a phone
        // neighbour is 0fr, a desktop one is 1fr, so the two whole-row
        // strings can never match regardless of whether `full` is wired
        // correctly) — that comparison was dead and could never fail.
        const picked = parts[o]
        const wantPicked = full ? 'minmax(0, 1fr)' : 'minmax(0, 3fr)'
        if (picked !== wantPicked) return `offset ${o} full=${full}: picked track "${picked}", expected "${wantPicked}"`
      }
    }
    if (PHONE_MAX_W !== 560) return `phone breakpoint drifted from the SPEC: ${PHONE_MAX_W}`
    return null
  }],

  ['render: rangeLabel three shapes — same month, same-year straddle, cross-year', () => {
    const savedAnchor = today()
    try {
      // Pin to 2026-08-11, a Tuesday in August. week 0 is the week containing today (that week's Monday).
      // An anchor on the 11th puts Monday the 10th as the start of week 0.
      _setAnchorForTest(civilToDay(2026, 8, 11))

      // Week 0 runs Mon 8/10 – Sun 8/16 (all in August). Last day is 8/16.
      // rangeLabel(0, 0) should produce "Aug 2026" (same month).
      const sameMonth = rangeLabel(asWeek(0), asWeek(0))
      if (sameMonth !== 'Aug 2026') return `same month: expected "Aug 2026", got "${sameMonth}"`

      // Week 1 runs Mon 8/17 – Sun 8/23 (still in August).
      // rangeLabel(0, 1) spans from Mon 8/10 to Sun 8/23 (same month).
      const stillAug = rangeLabel(asWeek(0), asWeek(1))
      if (stillAug !== 'Aug 2026') return `two weeks same month: expected "Aug 2026", got "${stillAug}"`

      // Week 2 runs Mon 8/24 – Sun 8/30 (still in August).
      // Week 3 runs Mon 8/31 – Sun 9/6 (September starts on Sunday).
      // rangeLabel(0, 3) spans Mon 8/10 to Sun 9/6 (August to September).
      const straddleYear = rangeLabel(asWeek(0), asWeek(3))
      if (straddleYear !== 'Aug – Sep 2026') return `same-year straddle: expected "Aug – Sep 2026", got "${straddleYear}"`

      // Now test cross-year. Anchor on 2026-12-28 (a Monday in December).
      _setAnchorForTest(civilToDay(2026, 12, 28))

      // Week 0 runs Mon 12/28 – Sun 2027-1/3 (December to January).
      const crossYear = rangeLabel(asWeek(0), asWeek(0))
      if (crossYear !== 'Dec 2026 – Jan 2027') return `cross-year straddle: expected "Dec 2026 – Jan 2027", got "${crossYear}"`

      return null
    } finally { _setAnchorForTest(savedAnchor) }
  }],

  ['day: form validation rules', () => {
    const base: EventDraft = {
      title: 'Standup', category: 'work', allDay: false,
      start: civilToDay(2026, 9, 2), end: civilToDay(2026, 9, 2),
      startMin: 9 * 60, endMin: 10 * 60, repeat: 'none',
    }
    if (validate(base) !== null) return `a good draft was rejected: ${validate(base)}`
    if (validate({ ...base, title: '' }) === null) return 'an empty title was accepted'
    if (validate({ ...base, title: '   ' }) === null) return 'a whitespace title was accepted'
    // End before start, both forms.
    const backwards = { ...base, end: civilToDay(2026, 9, 1) }
    if (validate(backwards) === null) return 'an end BEFORE the start was accepted'
    // Same day, end time not after start.
    if (validate({ ...base, endMin: 9 * 60 }) === null) return 'a zero-length timed event was accepted'
    if (validate({ ...base, endMin: 8 * 60 }) === null) return 'a backwards timed event was accepted'
    // Crossing midnight is legal: the end DAY is later, so the clock may go backwards.
    const overnight = { ...base, end: civilToDay(2026, 9, 3), startMin: 23 * 60, endMin: 60 }
    if (validate(overnight) !== null) return `an overnight event was rejected: ${validate(overnight)}`
    // All-day ignores the clock entirely; the end day is INCLUSIVE in the form.
    const allDay: EventDraft = { ...base, allDay: true, startMin: 0, endMin: 0 }
    if (validate(allDay) !== null) return `a one-day all-day event was rejected: ${validate(allDay)}`
    if (validate({ ...allDay, end: civilToDay(2026, 9, 5) }) !== null) return 'a multi-day all-day event was rejected'
    // Out-of-range minutes cannot reach the wire.
    if (validate({ ...base, startMin: -1 }) === null) return 'a negative start minute was accepted'
    if (validate({ ...base, endMin: 1440 }) === null) return 'minute 1440 was accepted'
    return null
  }],

  ['state: a signed-out session issues ONE token request, and a gesture re-arms it', async () => {
    const savedAnchor = today()
    // Every reply fails: this is a signed-out session, and GIS's popup is blocked.
    const s = stubStorage(), g = stubGis([{ error: 'popup_failed' }])
    const f = stubFetch([{ body: { items: [] } }])
    try {
      _resetForTest(); configure({})
      _setAnchorForTest(civilToDay(2026, 2, 11))
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (monthState('2026-02') !== 'error') return `state after a failed token: ${monthState('2026-02')}`
      if (f.calls.length !== 0) return `${f.calls.length} requests reached the wire with no token`
      const cold = g.prompts.length
      if (cold !== 1) return `a cold window made ${cold} token requests, not 1`
      // THE LOOP: each range move re-runs the same months, which are now `error`,
      // and needsFetch says yes every time. The gate must stop it dead.
      for (let i = 0; i < 5; i++) { ensureMonthsFor([asWeek(0)]); await _settleForTest() }
      if (g.prompts.length !== cold) return `the gate leaked: ${g.prompts.length} token requests after 5 range moves`
      // A write is NOT gated: a Save press is itself the gesture a popup needs,
      // and the user has to learn it failed.
      const draft: EventDraft = {
        title: 'T', category: 'work', allDay: true,
        start: civilToDay(2026, 2, 11), end: civilToDay(2026, 2, 11), repeat: 'none',
      }
      const wrote = await createEvent(draft).then(() => true, () => false)
      if (wrote) return 'a create succeeded with no token'
      if (g.prompts.length !== cold + 1) return 'a write was blocked by the auth gate'
      // A gesture re-arms: the error month is refetch-eligible the moment the gate is down.
      const armed = g.prompts.length
      clearAuthGate()
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (g.prompts.length !== armed + 1) return `clearAuthGate did not re-arm: ${g.prompts.length} vs ${armed + 1}`
    } finally { await signOut(); f.restore(); g.restore(); s.restore(); _resetForTest(); _setAnchorForTest(savedAnchor) }
    return null
  }],

  ['state: a successful write-path renewal clears the auth gate on its own', async () => {
    const savedAnchor = today()
    // Reply 0 fails (arms the gate on a background load); reply 1+ succeeds (a write's
    // gesture, then anything after it — stubGis repeats the last reply).
    const s = stubStorage(), g = stubGis([{ error: 'popup_failed' }, { access_token: 'tok-good', expires_in: 3600 }])
    const f = stubFetch([
      { body: { id: 'real-9', summary: 'T', colorId: '9', start: { date: '2026-03-05' }, end: { date: '2026-03-05' } } },
      { body: { items: [{ id: 'real-9', summary: 'T', colorId: '9', start: { date: '2026-03-05' }, end: { date: '2026-03-05' } }] } },
      { body: { items: [] } },
    ])
    try {
      _resetForTest(); configure({})
      _setAnchorForTest(civilToDay(2026, 2, 11))
      // Arm the gate the same way as the case above: a background load whose opening
      // getToken() rejects.
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (monthState('2026-02') !== 'error') return `state after a failed token: ${monthState('2026-02')}`
      const cold = g.prompts.length
      // A write in a DIFFERENT month (March), so its own refetch never touches the
      // still-`error` February month — isolating what the gate, not the refetch,
      // does for February.
      const draft: EventDraft = {
        title: 'T', category: 'work', allDay: true,
        start: civilToDay(2026, 3, 5), end: civilToDay(2026, 3, 5), repeat: 'none',
      }
      const saved = await createEvent(draft).then(v => v, (e: Error) => { throw e })
      if (saved.id !== 'real-9') return `create did not resolve: ${JSON.stringify(saved)}`
      if (g.prompts.length <= cold) return 'the write never asked for a token'
      // THE BUG: withToken's opening getToken() succeeded for the write, but never
      // cleared authGate. February is still `error`; a background load over it must
      // now actually go fetch, because a successful token acquisition on ANY path —
      // not just clearAuthGate() — is a successful renewal (SPEC "State API").
      // getToken() caches the token the write just acquired, so this second
      // acquisition resolves from cache with no NEW GIS prompt — the wire call is
      // the observable signal here, not the prompt count.
      const beforeCalls = f.calls.length
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (f.calls.length === beforeCalls) return 'the gate never cleared: no wire request for February after a successful write'
      if (monthState('2026-02') === 'error') return 'February is still `error` after the gate should have cleared'
    } finally { await signOut(); f.restore(); g.restore(); s.restore(); _resetForTest(); _setAnchorForTest(savedAnchor) }
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
