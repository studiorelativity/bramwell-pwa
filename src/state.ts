// STAGE 01 — event cache, today() anchor, DayNumber<->WeekIndex math, persistence, write orchestration, demo.
// Only the anchor and the layout conversion are implemented in stage 01.
import type {
  DayNumber, WeekIndex, DayOffset, MonthKey, MonthLoadState, MonthEntry, CalendarEvent,
  EventDraft, EventSpan, EventCache, StoredEvent, PendingWrite, Prefs, WriteScope,
} from './types.ts'
import { asDay, asOffset, asWeek, addDays, civilToDay, monthKey, offsetOf } from './dates.ts'
import { all as allCategories, categoryFor } from './categories.ts'

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
  if (saveTimer !== null) return
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
}

export function _flushForTest(): void {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
  writeCacheNow()
}

// ---------- Stubs: tasks 8 and 9 ----------

const NOT_IMPLEMENTED = 'STAGE 02: not implemented'
export function ensureMonthsFor(_weeks: WeekIndex[]): void { throw new Error(NOT_IMPLEMENTED) }
export function createEvent(_draft: EventDraft): Promise<CalendarEvent> { throw new Error(NOT_IMPLEMENTED) }
export function updateEvent(_id: string, _draft: EventDraft, _scope: WriteScope): Promise<CalendarEvent> { throw new Error(NOT_IMPLEMENTED) }
export function deleteEvent(_id: string, _scope: WriteScope): Promise<void> { throw new Error(NOT_IMPLEMENTED) }
export function onCacheChange(_fn: (months: MonthKey[]) => void): () => void { throw new Error(NOT_IMPLEMENTED) }
export function enableDemo(): void { throw new Error('STAGE 06: not implemented') }
