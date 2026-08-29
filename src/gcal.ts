// STAGE 02 — Calendar API. The ONLY file calling googleapis.com. Owns wire <-> DayNumber.
import type { CalendarEvent, EventDraft, MonthKey, WriteScope } from './types.ts'
const E = () => new Error('STAGE 02: not implemented')
/** Lower to force pagination during a gate; restore to 250. */
export const MAX_RESULTS = 250
export function listMonth(_key: MonthKey, _token: string): Promise<CalendarEvent[]> { throw E() }
export function createEvent(_draft: EventDraft, _colorId: string, _token: string): Promise<CalendarEvent> { throw E() }
export function updateEvent(_id: string, _changes: Partial<EventDraft>, _scope: WriteScope, _token: string): Promise<CalendarEvent> { throw E() }
export function deleteEvent(_id: string, _scope: WriteScope, _token: string): Promise<void> { throw E() }
