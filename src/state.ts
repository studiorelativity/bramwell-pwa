// STAGE 01 — event cache, today() anchor, DayNumber<->WeekIndex math, persistence, write orchestration, demo.
// Only the anchor and the layout conversion are implemented in stage 01.
import type {
  DayNumber, WeekIndex, DayOffset, MonthKey, CalendarEvent, EventDraft, EventSpan,
  EventCache, Prefs, WriteScope,
} from './types.ts'
import { asDay, asWeek, civilToDay, offsetOf } from './dates.ts'

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

// ---------- Stubs: stage 02 ----------

const NOT_IMPLEMENTED = 'STAGE 02: not implemented'

export function loadCache(): EventCache { throw new Error(NOT_IMPLEMENTED) }
export function saveCache(_cache: EventCache): void { throw new Error(NOT_IMPLEMENTED) }
export function loadPrefs(): Prefs { throw new Error(NOT_IMPLEMENTED) }
export function savePrefs(_prefs: Prefs): void { throw new Error(NOT_IMPLEMENTED) }
export function eventsForMonth(_key: MonthKey): CalendarEvent[] { throw new Error(NOT_IMPLEMENTED) }
export function spansForWeek(_week: WeekIndex): EventSpan[] { throw new Error(NOT_IMPLEMENTED) }
export function createEvent(_draft: EventDraft): Promise<CalendarEvent> { throw new Error(NOT_IMPLEMENTED) }
export function updateEvent(_id: string, _draft: EventDraft, _scope: WriteScope): Promise<CalendarEvent> { throw new Error(NOT_IMPLEMENTED) }
export function deleteEvent(_id: string, _scope: WriteScope): Promise<void> { throw new Error(NOT_IMPLEMENTED) }
export function onCacheChange(_fn: (months: MonthKey[]) => void): () => void { throw new Error(NOT_IMPLEMENTED) }
export function enableDemo(): void { throw new Error('STAGE 06: not implemented') }
