// STAGE 02 — the event cache and every write to it: the today() anchor, the
// DayNumber<->WeekIndex layout conversion, localStorage persistence of cache and prefs,
// month reads (eventsForMonth / spansForWeek), lazy month loading with staleness and
// coalescing, the 401 re-auth retry, and optimistic create/update/delete with rollback.
// DOM-free: it notifies through onCacheChange and rethrows rather than toasting.
// STAGE 06 adds demo: a module flag under which the cache is a deterministic in-memory
// seed, storage is neither read nor written, no path reaches gcal.ts, and every write
// verb throws DemoError before its optimistic apply.
import type {
  DayNumber, WeekIndex, DayOffset, MonthKey, MonthLoadState, MonthEntry, CalendarEvent,
  EventDraft, EventSpan, EventCache, StoredEvent, PendingWrite, Prefs, WriteScope,
} from './types.ts'
import { asDay, asOffset, asWeek, addDays, civilToDay, dayToCivil, monthKey, offsetOf } from './dates.ts'
import { all as allCategories, categoryFor } from './categories.ts'
import { getToken, invalidateToken } from './auth.ts'
import {
  createEvent as gcalCreate, deleteEvent as gcalDelete, updateEvent as gcalUpdate,
  GcalError, listMonth,
} from './gcal.ts'

// ---------- Anchor ----------

function localToday(): DayNumber {
  const n = new Date()   // display boundary: the local clock
  return civilToDay(n.getFullYear(), n.getMonth() + 1, n.getDate())
}

/** Captured once at load. A session left open across midnight keeps its anchor until reload. */
let anchor: DayNumber = localToday()
/** Monday of the anchor's week: WeekIndex 0, DayOffset 0. */
let anchorMonday: DayNumber = asDay(anchor - offsetOf(anchor))

export function today(): DayNumber {
  return anchor
}

/** Test-only. Re-pins the anchor so the selftest can place a known date in week 0. */
export function _setAnchorForTest(day: DayNumber): void {
  anchor = day
  anchorMonday = asDay(anchor - offsetOf(anchor))
}

// ---------- Layout conversion (the only place DayNumber <-> WeekIndex happens) ----------

export function weekOf(day: DayNumber): WeekIndex {
  return asWeek(Math.floor((day - anchorMonday) / 7))
}

export function dayAt(week: WeekIndex, offset: DayOffset): DayNumber {
  return asDay(anchorMonday + week * 7 + offset)
}

// ---------- Storage ----------

const CACHE_KEY = 'bramwell.cache.v1'
const PREFS_KEY = 'bramwell.prefs.v1'
/** A ready month older than this is refetched when it comes back into range. */
const STALE_MS = 5 * 60_000
const SAVE_DEBOUNCE_MS = 250

let cache: EventCache = { v: 1, months: {} }
let prefsValue: Prefs = {}
let loaded = false
/** Optimistic overlay, keyed by event id (tempId for creates). Never serialized. */
const pending = new Map<string, PendingWrite>()
/** Stage 06. Set by enableDemo(); read by every storage writer, the fetch path and the
 *  write verbs. See the Demo section at the bottom. */
let demo = false

/** Inside a function, never at module scope: node has none, and a locked-down browser throws. */
function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null
  } catch {
    return null
  }
}

function readCache(): EventCache {
  const s = storage()
  if (s === null) return { v: 1, months: {} }
  try {
    const raw = s.getItem(CACHE_KEY)
    if (raw === null) return { v: 1, months: {} }
    const parsed = JSON.parse(raw) as { v?: number; months?: Record<MonthKey, MonthEntry> }
    if (parsed.v !== 1 || typeof parsed.months !== 'object' || parsed.months === null) return { v: 1, months: {} }
    return { v: 1, months: parsed.months }
  } catch {
    return { v: 1, months: {} }   // unparseable or unreadable: the cache is never truth
  }
}

function readPrefs(): Prefs {
  const s = storage()
  if (s === null) return {}
  try {
    const raw = s.getItem(PREFS_KEY)
    if (raw === null) return {}
    const p = JSON.parse(raw) as Prefs
    return typeof p === 'object' && p !== null ? p : {}
  } catch {
    return {}
  }
}

function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  cache = readCache()
  prefsValue = readPrefs()
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function writeCacheNow(): void {
  if (demo) return   // guarded at the writer, not only at saveCache: _flushForTest reaches here too
  const s = storage()
  if (s === null) return
  const months: Record<MonthKey, MonthEntry> = {}
  for (const [k, m] of Object.entries(cache.months)) if (m.state === 'ready') months[k] = m
  try {
    s.setItem(CACHE_KEY, JSON.stringify({ v: 1, months }))
  } catch {
    // Quota. Swallowed by decision: the cache is never truth.
  }
}

/** Debounced: an optimistic write must not re-serialize the whole blob synchronously. */
function saveCache(): void {
  if (demo || saveTimer !== null) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    writeCacheNow()
  }, SAVE_DEBOUNCE_MS)
}

// ---------- Prefs ----------

export function prefs(): Prefs {
  ensureLoaded()
  return { ...prefsValue }
}

export function savePrefs(p: Prefs): void {
  ensureLoaded()
  prefsValue = { ...p }
  if (demo) return   // SPEC "Demo mode": customization works in memory and persists nothing
  const s = storage()
  if (s === null) return
  try {
    s.setItem(PREFS_KEY, JSON.stringify(prefsValue))
  } catch {
    // Quota.
  }
}

// ---------- Reads ----------

export function monthState(key: MonthKey): MonthLoadState {
  ensureLoaded()
  return cache.months[key]?.state ?? 'absent'
}

/** category is derived here and nowhere else, on every read, against current prefs. */
function resolve(se: StoredEvent): CalendarEvent {
  const category = categoryFor(se.colorId).name
  return se.allDay ? { ...se, allDay: true, category } : { ...se, allDay: false, category }
}

function monthsSpanned(start: DayNumber, end: DayNumber): MonthKey[] {
  const keys: MonthKey[] = []
  for (let d = start; ; d = addDays(d, 1)) {
    const k = monthKey(d)
    if (keys[keys.length - 1] !== k) keys.push(k)
    if (d >= end) break
  }
  return keys
}

export function eventsForMonth(key: MonthKey): CalendarEvent[] {
  ensureLoaded()
  const out: CalendarEvent[] = []
  for (const se of cache.months[key]?.events ?? []) {
    const p = pending.get(se.id)
    if (p?.kind === 'delete') continue
    out.push(p?.kind === 'update' ? p.event : resolve(se))
  }
  for (const p of pending.values()) {
    if (p.kind === 'create' && monthsSpanned(p.event.start, p.event.end).includes(key)) out.push(p.event)
  }
  return out
}

export function spansForWeek(week: WeekIndex): EventSpan[] {
  ensureLoaded()
  const mon = dayAt(week, asOffset(0))
  const sun = addDays(mon, 6)
  const seen = new Set<string>()
  const out: EventSpan[] = []
  // One or two month keys; an event crossing the boundary is stored in both, so dedupe by id.
  for (const key of new Set([monthKey(mon), monthKey(sun)])) {
    for (const ev of eventsForMonth(key)) {
      if (seen.has(ev.id)) continue
      seen.add(ev.id)
      // A timed event renders on its start day even when its end crosses midnight.
      const evEnd = ev.allDay ? ev.end : ev.start
      if (evEnd < mon || ev.start > sun) continue
      out.push({
        event: ev,
        week,
        from: asOffset(Math.max(0, ev.start - mon)),
        to: asOffset(Math.min(6, evEnd - mon)),
        continuesBefore: ev.start < mon,
        continuesAfter: evEnd > sun,
      })
    }
  }
  return out
}

// ---------- Test-only (extends stage-01 ruling 2) ----------

export function _resetForTest(): void {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
  cache = { v: 1, months: {} }
  prefsValue = {}
  pending.clear()
  loaded = false
  inflight.clear()
  authGate = false
  demo = false
}

export function _flushForTest(): void {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
  writeCacheNow()
}

export async function _settleForTest(): Promise<void> {
  while (inflight.size > 0) await Promise.all([...inflight.values()])
}

// ---------- Notification ----------

const listeners = new Set<(months: MonthKey[]) => void>()

export function onCacheChange(fn: (months: MonthKey[]) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function notify(months: MonthKey[]): void {
  for (const fn of [...listeners]) fn(months)
}

// ---------- Network ----------

/** Set when a token request fails; stops every BACKGROUND month load from asking
 *  again for the rest of the session. Signed out, `getToken()` already coalesces
 *  concurrent callers, so a cold window costs one request — but each range move
 *  re-runs `ensureMonthsFor` over months left in `error`, and on a phone every
 *  retry is a popup the browser blocks without a gesture (SPEC "First-run and
 *  connection state"; observed on iOS Safari as dozens per second). Writes are
 *  deliberately NOT gated: a Save press is itself the gesture, and the user has
 *  to learn the write failed. Cleared only by main.ts, on a successful sign-in
 *  or renewal. */
let authGate = false

export function clearAuthGate(): void {
  authGate = false
}

/** The one place the 401 rule lives. gcal.ts owns the transport retry; this owns identity. */
async function withToken<T>(fn: (t: string) => Promise<T>): Promise<T> {
  // Belt and braces at the identity boundary: every path into gcal.ts passes here, so no
  // future caller can reach the wire in demo even if it forgets its own guard.
  if (demo) throw new DemoError()
  let t: string
  try {
    t = await getToken()
  } catch (e) {
    // Identity failed, not the API. Arm the gate and let the caller surface it.
    authGate = true
    throw e
  }
  // Any successful token acquisition is a successful renewal, whatever path asked for
  // it — a background load or a write's gesture — so background loading must resume
  // (SPEC "State API": the gate clears "on a successful signIn() or renewal").
  authGate = false
  try {
    return await fn(t)
  } catch (e) {
    if (!(e instanceof GcalError) || e.status !== 401) throw e
    let t2: string
    try {
      t2 = await getToken(true)
    } catch (renewalError) {
      // The forced renewal itself failed: symmetric with the opening getToken() above,
      // this IS an identity failure (may be an AuthError, not a GcalError) and must
      // arm the gate the same way, not just fall through unnoticed.
      authGate = true
      throw renewalError
    }
    authGate = false   // a successful forced renewal is a successful renewal too.
    try {
      return await fn(t2)
    } catch (retryError) {
      // A freshly minted token was rejected too, so the grant is gone rather than stale.
      // Clear locally — never revoke — so isSignedIn() goes false and stage 05's reconnect
      // pill stands, while a later quiet renewal is still free to succeed.
      if (retryError instanceof GcalError && retryError.status === 401) invalidateToken()
      throw retryError
    }
  }
}

const inflight = new Map<MonthKey, Promise<void>>()

function needsFetch(key: MonthKey): boolean {
  const m = cache.months[key]
  if (m === undefined) return true
  if (m.state === 'loading') return false
  if (m.state === 'ready') return Date.now() - m.fetchedAt > STALE_MS
  return true   // absent | error
}

/** Unconditional: staleness and coalescing are decided by fetchMonth, never here. */
function startFetch(key: MonthKey): Promise<void> {
  const prior = cache.months[key]
  cache.months[key] = { state: 'loading', events: prior?.events ?? [], fetchedAt: prior?.fetchedAt ?? 0 }
  notify([key])
  const p = withToken(t => listMonth(key, t)).then(
    events => {
      cache.months[key] = { state: 'ready', events, fetchedAt: Date.now() }
      saveCache()
    },
    () => {
      // Keep whatever was on screen: a refresh failure must not blank a month.
      const kept = cache.months[key]
      cache.months[key] = { state: 'error', events: kept?.events ?? [], fetchedAt: kept?.fetchedAt ?? 0 }
    },
  ).finally(() => {
    inflight.delete(key)
    notify([key])
  })
  inflight.set(key, p)
  return p
}

/** `force` is the post-write path. A request already in flight was issued BEFORE the write
 *  reached Google, so it cannot carry the result: a forced call queues behind it and then
 *  starts its own, rather than joining it, and skips the staleness check. The requeue never
 *  recurses — once the awaited promise settles its `finally` has cleared `inflight`, so it
 *  either starts a fetch or joins one that was itself issued after the write. */
function fetchMonth(key: MonthKey, force = false): Promise<void> {
  // Inert in demo (SPEC): unseeded months stay `absent`, seeded ones never go stale.
  // A forced post-write refetch cannot arise — the write verbs throw first.
  if (demo) return Promise.resolve()
  const running = inflight.get(key)
  if (running !== undefined) {
    if (!force) return running
    const behind = (): Promise<void> => inflight.get(key) ?? startFetch(key)
    return running.then(behind, behind)
  }
  if (authGate && !force) return Promise.resolve()
  if (!force && !needsFetch(key)) return Promise.resolve()
  return startFetch(key)
}

/** The one staling rule: a write forces its months, whatever their fetchedAt says. */
async function refetch(keys: MonthKey[]): Promise<void> {
  await Promise.all(keys.map(k => fetchMonth(k, true)))
}

/** Stage 03 owns *when* to call this; stage 02 owns the rule. */
export function ensureMonthsFor(weeks: WeekIndex[]): void {
  ensureLoaded()
  const keys = new Set<MonthKey>()
  for (const w of weeks) {
    const mon = dayAt(w, asOffset(0))
    keys.add(monthKey(mon))
    keys.add(monthKey(addDays(mon, 6)))
  }
  for (const key of keys) void fetchMonth(key)
}

// ---------- Writes ----------

function colorIdFor(name: string): string {
  return (allCategories().find(c => c.name === name) ?? categoryFor(undefined)).colorId
}

function findEvent(id: string): CalendarEvent | null {
  const p = pending.get(id)
  if (p !== undefined && p.kind !== 'create') return p.kind === 'update' ? p.event : p.prior
  for (const key of Object.keys(cache.months)) {
    for (const ev of eventsForMonth(key)) if (ev.id === id) return ev
  }
  return null
}

/** Field by field, never by spreading the draft: a spread can smuggle startMin into an all-day event. */
function build(id: string, draft: EventDraft, colorId: string, recurringEventId: string | undefined): CalendarEvent {
  const ev: CalendarEvent = draft.allDay
    ? { id, title: draft.title, category: draft.category, colorId, start: draft.start, end: draft.end, allDay: true }
    : {
        id, title: draft.title, category: draft.category, colorId,
        start: draft.start, end: draft.end, allDay: false,
        startMin: draft.startMin ?? 0, endMin: draft.endMin ?? 0,
      }
  if (draft.notes !== undefined) ev.notes = draft.notes
  if (recurringEventId !== undefined) ev.recurringEventId = recurringEventId
  return ev
}

function assertOnline(): void {
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator
  if (nav?.onLine === false) throw new Error('Offline — this change was not saved.')
}

export async function createEvent(draft: EventDraft): Promise<CalendarEvent> {
  ensureLoaded()
  if (demo) throw new DemoError()   // BEFORE the optimistic apply (DECISIONS); offline fires after it
  const colorId = colorIdFor(draft.category)
  const tempId = `tmp:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const event = build(tempId, draft, colorId, undefined)
  const touched = monthsSpanned(event.start, event.end)
  pending.set(tempId, { kind: 'create', tempId, event })
  notify(touched)
  try {
    assertOnline()   // inside the try, after the apply, so the rollback path really runs
    const saved = await withToken(t => gcalCreate(draft, colorId, t))
    pending.delete(tempId)
    await refetch([...new Set([...touched, ...monthsSpanned(saved.start, saved.end)])])
    return resolve(saved)
  } catch (e) {
    pending.delete(tempId)
    notify(touched)
    throw e   // the caller raises the toast; state.ts stays DOM-free
  }
}

export async function updateEvent(id: string, draft: EventDraft, scope: WriteScope): Promise<CalendarEvent> {
  ensureLoaded()
  if (demo) throw new DemoError()   // before the lookup too: the refusal is unconditional
  const prior = findEvent(id)
  if (prior === null) throw new Error(`unknown event ${id}`)
  const colorId = colorIdFor(draft.category)
  const event = build(id, draft, colorId, prior.recurringEventId)
  const touched = [...new Set([...monthsSpanned(prior.start, prior.end), ...monthsSpanned(event.start, event.end)])]
  pending.set(id, { kind: 'update', event, prior })
  notify(touched)
  try {
    assertOnline()
    const wireId = scope === 'series' ? (prior.recurringEventId ?? prior.id) : prior.id
    // gcalUpdate takes CHANGED FIELDS ONLY, so the changes are built here rather than passing
    // the draft. `repeat` is always omitted: DECISIONS "In force — auth and wire" — "`repeat`
    // is disabled when editing an existing event" — and Google rejects an RRULE PATCHed
    // against an instance id. A series edit also omits the dates: `wireId` is then the series
    // master, and writing this occurrence's start/end would move the whole series onto it.
    const changes: Partial<EventDraft> = { title: draft.title }
    if (draft.notes !== undefined) changes.notes = draft.notes
    if (scope !== 'series') {
      changes.allDay = draft.allDay
      changes.start = draft.start
      changes.end = draft.end
      if (draft.startMin !== undefined) changes.startMin = draft.startMin
      if (draft.endMin !== undefined) changes.endMin = draft.endMin
    }
    const saved = await withToken(t => gcalUpdate(wireId, changes, colorId, t))
    pending.delete(id)
    if (scope === 'series') {
      await refetch(Object.keys(cache.months))
    } else {
      await refetch([...new Set([...touched, ...monthsSpanned(saved.start, saved.end)])])
    }
    return resolve(saved)
  } catch (e) {
    pending.delete(id)
    notify(touched)
    throw e
  }
}

export async function deleteEvent(id: string, scope: WriteScope): Promise<void> {
  ensureLoaded()
  if (demo) throw new DemoError()
  const prior = findEvent(id)
  if (prior === null) throw new Error(`unknown event ${id}`)
  const touched = monthsSpanned(prior.start, prior.end)
  pending.set(id, { kind: 'delete', id, prior })
  notify(touched)
  try {
    assertOnline()
    const wireId = scope === 'series' ? (prior.recurringEventId ?? prior.id) : prior.id
    await withToken(t => gcalDelete(wireId, t))
    pending.delete(id)
    if (scope === 'series') {
      await refetch(Object.keys(cache.months))
    } else {
      await refetch(touched)
    }
  } catch (e) {
    pending.delete(id)
    notify(touched)
    throw e
  }
}

// ---------- Demo seed (stage 06) ----------

/** mulberry32: a 32-bit seeded generator, enough to lay a calendar out the same way on
 *  every run. Uniform in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DEMO_SEED = 0x5EED
/** ~17 months: this many each side of the anchor's month, plus the month itself. */
const DEMO_MONTHS_EACH_WAY = 8

const DEMO_TITLES: Record<'work' | 'personal' | 'other', readonly string[]> = {
  work: ['Design review', '1:1 with Sam', 'Sprint planning', 'Client call', 'Roadmap sync', 'Interview loop', 'Ship review', 'Retro'],
  personal: ['Dentist', 'Yoga', 'Dinner with Ana', 'Haircut', 'Football', 'Book club', 'Parents visit', 'Swim'],
  other: ['Boiler service', 'Parcel pickup', 'Vet', 'Recycling day', 'Car MOT', 'Library books due', 'Bins out'],
}

/** SPEC "Demo mode": deterministic, anchored to the given day, every render path — a 21-day
 *  span across three rows, weekly recurring timed chips with recurringEventId, monthly and
 *  quarterly financial all-days, weekend spans, one day that overflows the year cell's three
 *  bars, every seed category. Category names resolve to colorIds through the configured set,
 *  so the seed never hard-codes a colorId. Pure: `fetchedAt` is a parameter so two calls for
 *  one anchor are byte-identical. An event lives in every in-window month it touches — the
 *  cache invariant spansForWeek's dedupe depends on. */
function demoSeed(anchor: DayNumber, fetchedAt: number): Record<MonthKey, MonthEntry> {
  const rnd = mulberry32(DEMO_SEED)
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1))
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T
  const events: StoredEvent[] = []
  const allDay = (id: string, title: string, cat: string, start: DayNumber, end: DayNumber): void => {
    events.push({ id, title, allDay: true, colorId: colorIdFor(cat), start, end })
  }
  const timed = (id: string, title: string, cat: string, day: DayNumber, startMin: number, endMin: number, series?: string): void => {
    const ev: StoredEvent = { id, title, allDay: false, colorId: colorIdFor(cat), start: day, end: day, startMin, endMin }
    if (series !== undefined) ev.recurringEventId = series
    events.push(ev)
  }

  // The window, as civil months around the anchor's.
  const { y: ay, m: am } = dayToCivil(anchor)
  const months: { y: number; m: number; key: MonthKey; first: DayNumber; last: DayNumber }[] = []
  for (let i = -DEMO_MONTHS_EACH_WAY; i <= DEMO_MONTHS_EACH_WAY; i++) {
    const first = civilToDay(ay, am + i, 1)   // Date.UTC normalises an out-of-range month
    const { y, m } = dayToCivil(first)
    months.push({ y, m, key: monthKey(first), first, last: addDays(civilToDay(y, m + 1, 1), -1) })
  }
  const windowFirst = months[0]?.first ?? anchor
  const windowLast = months[months.length - 1]?.last ?? anchor
  const monday = asDay(anchor - offsetOf(anchor))
  const at = (week: number, offset: number): DayNumber => asDay(monday + week * 7 + offset)

  // 1. A 21-day span, Monday of week +2 through Sunday of week +4: three full rows.
  allDay('demo:offsite', 'Product offsite', 'work', at(2, 0), at(4, 6))
  // 2. Two weekly series of timed chips, every Tuesday and Thursday in the window.
  for (let d = windowFirst; d <= windowLast; d = addDays(d, 1)) {
    const o = offsetOf(d)
    if (o === 1) timed(`demo:sync:${d}`, 'Team sync', 'work', d, 9 * 60 + 15, 10 * 60, 'demo:sync')
    if (o === 3) timed(`demo:run:${d}`, 'Run club', 'personal', d, 18 * 60 + 30, 19 * 60 + 30, 'demo:run')
  }
  // 3. Financial: Rent on the 1st of every month; Quarterly taxes on the 15th of Jan/Apr/Jul/Oct.
  for (const mo of months) {
    allDay(`demo:rent:${mo.key}`, 'Rent', 'financial', mo.first, mo.first)
    if (mo.m % 3 === 1) {
      const fifteenth = civilToDay(mo.y, mo.m, 15)
      allDay(`demo:tax:${mo.key}`, 'Quarterly taxes', 'financial', fifteenth, fifteenth)
    }
  }
  // 4. Weekend spans: a Sat..Sun next week, and a Fri..Mon three weeks back.
  allDay('demo:cabin', 'Cabin weekend', 'personal', at(1, 5), at(1, 6))
  allDay('demo:longweekend', 'Long weekend away', 'personal', at(-3, 4), at(-2, 0))
  // 5. One day, three days out, that overflows the year cell's three bars.
  const stackDay = addDays(anchor, 3)
  const stack: [string, string][] = [['Dentist', 'personal'], ['Car service', 'other'], ['Parcel arrives', 'other'], ['Call Mum', 'personal'], ['Library books due', 'other']]
  stack.forEach(([title, cat], i) => allDay(`demo:stack:${i}`, title, cat, stackDay, stackDay))
  // 6. Filler, 6–10 per month, mostly timed, drawn from the generator so the layout is fixed.
  for (const mo of months) {
    const n = int(6, 10)
    for (let j = 0; j < n; j++) {
      const cat = pick(['work', 'work', 'personal', 'personal', 'other'] as const)
      const title = pick(DEMO_TITLES[cat])
      const day = addDays(mo.first, int(0, mo.last - mo.first))
      const id = `demo:${mo.key}:${j}`
      if (rnd() < 0.7) {
        const startMin = int(8, 17) * 60 + pick([0, 30])
        timed(id, title, cat, day, startMin, startMin + pick([30, 60, 90]))
      } else {
        const end = addDays(day, int(0, 2))
        allDay(id, title, cat, day, end > windowLast ? windowLast : end)
      }
    }
  }

  // Bucket: every in-window month an event touches holds it (the cache invariant).
  const out: Record<MonthKey, MonthEntry> = {}
  for (const mo of months) out[mo.key] = { state: 'ready', events: [], fetchedAt }
  for (const ev of events) {
    for (const key of monthsSpanned(ev.start, ev.end)) out[key]?.events.push(ev)
  }
  return out
}

/** Test-only (extends stage-01 ruling 2). */
export const _demoSeedForTest = demoSeed

// ---------- Demo (stage 06) ----------

/** SPEC "Demo mode": thrown by every write verb BEFORE the optimistic apply, so nothing
 *  is ever notified, overlaid or rolled back. The caller toasts the message verbatim. */
export class DemoError extends Error {
  constructor() {
    super('Demo — connect your Google Calendar to save.')
    this.name = 'DemoError'
  }
}

export function isDemo(): boolean {
  return demo
}

/** Swaps the in-memory cache and prefs for the demo seed. Storage is neither read nor
 *  written again until exitDemo(); the flag lives in memory only, so a reload lands
 *  wherever storage says (SPEC: demo never survives a reload). main.ts re-runs
 *  configure() from prefs() afterwards, which is how the demo category set reaches
 *  categories.ts without state.ts becoming a second writer of it. */
export function enableDemo(): void {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
  demo = true
  loaded = true          // never read storage under the flag
  pending.clear()
  inflight.clear()
  authGate = false
  prefsValue = {}
  cache = { v: 1, months: demoSeed(anchor, Date.now()) }
}

/** Drops every demo byte and re-reads storage. A no-op when not in demo. */
export function exitDemo(): void {
  if (!demo) return
  demo = false
  pending.clear()
  inflight.clear()
  loaded = false
  ensureLoaded()
}
