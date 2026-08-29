// STAGE 01 — pure self-test over the date core. No DOM. Cases 5–9 are added in Task 4.
import type { DayNumber, StoredCategory, MoodId } from './types.ts'
import { asDay, asWeek, asOffset, civilToDay, dayToCivil, addDays, offsetOf, monthKey } from './dates.ts'
import {
  today, weekOf, dayAt, _setAnchorForTest, _resetForTest, _flushForTest,
  prefs, savePrefs, monthState, eventsForMonth, spansForWeek,
  ensureMonthsFor, onCacheChange, _settleForTest,
  createEvent, updateEvent, deleteEvent,
} from './state.ts'
import { all, brighten, categoryFor, configure, fallback, sanitize, themeCss } from './categories.ts'
import { getToken, isSignedIn, signOut } from './auth.ts'
import {
  createEvent as gcalCreate, deleteEvent as gcalDelete, updateEvent as gcalUpdate,
  GcalError, listMonth, MAX_RESULTS,
} from './gcal.ts'

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
    // Mood values are stage 03: every id resolves to warm for now, and none of them throws.
    for (const m of ['warm', 'paper', 'cool', 'sage', 'dusk'] as MoodId[]) {
      if (themeCss(m) !== css) return `mood ${m} differs from warm before stage 03 fills MOODS`
    }
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
      await signOut()
    } finally { g.restore() }
    // A token whose expires_in has already been consumed by the skew is re-requested.
    const short = stubGis([{ access_token: 'x-1', expires_in: 0 }, { access_token: 'x-2', expires_in: 3600 }])
    try {
      if (await getToken() !== 'x-1') return 'short-lived token was not returned'
      if (isSignedIn()) return 'a token inside the 60s skew still reads as signed in'
      if (await getToken() !== 'x-2') return 'an expired token was served from cache'
      await signOut()
    } finally { short.restore() }
    // Concurrent callers share one in-flight renewal rather than racing three popups.
    const dedupe = stubGis([{ access_token: 'd-1', expires_in: 3600 }])
    try {
      const [p, q, r] = await Promise.all([getToken(), getToken(), getToken()])
      if (p !== 'd-1' || q !== 'd-1' || r !== 'd-1') return `concurrent tokens: ${p}/${q}/${r}`
      if (dedupe.prompts.length !== 1) return `concurrent callers made ${dedupe.prompts.length} requests`
      await signOut()
    } finally { dedupe.restore() }
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
      await signOut()
    } finally { g.restore() }
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
    } finally { s.restore(); _resetForTest() }
    return null
  }],

  ['state: ensureMonthsFor fetches absent months, skips fresh ones, coalesces', async () => {
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
      await signOut()
    } finally { f.restore(); g.restore(); s.restore(); _resetForTest() }
    return null
  }],

  ['state: a failed refresh sets error and keeps the prior events', async () => {
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
      await signOut()
    } finally { g.restore(); s.restore(); _resetForTest() }
    return null
  }],

  ['state: withToken retries a 401 exactly once with a fresh token', async () => {
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
      await signOut()
    } finally { f.restore(); g.restore(); s.restore(); _resetForTest() }
    // A second 401 surfaces rather than looping.
    const s2 = stubStorage()
    const g2 = stubGis([{ access_token: 'a', expires_in: 3600 }, { access_token: 'b', expires_in: 3600 }])
    const f2 = stubFetch([{ status: 401, body: {} }])
    try {
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (f2.calls.length !== 2) return `a repeated 401 made ${f2.calls.length} calls`
      if (monthState('2026-02') !== 'error') return `a repeated 401 left state ${monthState('2026-02')}`
      await signOut()
    } finally { f2.restore(); g2.restore(); s2.restore(); _resetForTest() }
    return null
  }],

  ['state: onCacheChange notifies with changed keys and unsubscribes', async () => {
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
      await signOut()
    } finally { f.restore(); g.restore(); s.restore(); _resetForTest() }
    return null
  }],

  ['state: create applies optimistically, then reconciles from the server', async () => {
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
      await signOut()
    } finally { f.restore(); g.restore(); s.restore(); _resetForTest() }
    return null
  }],

  ['state: a failed create rolls the overlay back and rethrows', async () => {
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
      await signOut()
    } finally { f.restore(); g.restore(); s.restore(); _resetForTest() }
    return null
  }],

  ['state: scope picks the id, and a series write stales every resident month', async () => {
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
      await signOut()
    } finally { g.restore(); s.restore(); _resetForTest() }
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
