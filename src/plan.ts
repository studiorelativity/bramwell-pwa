// PLANNING LAYER (2026-09-05) — the pure core: run selection, budget usage,
// the conflict check, and the planning half of the category loader. DOM-free;
// imports types.ts and dates.ts only. year.ts owns the strip, the drag and the
// writes (SPEC "Planning layer"); this file never sees an element.
import type { CalendarEvent, DayNumber } from './types.ts'
import { asDay } from './dates.ts'

/** The planning half of `categories.sanitize()`: a bad value costs the FIELD,
 *  never the row. Returns only the keys that are valid, in the shape
 *  exactOptionalPropertyTypes wants (never `budgetDays: undefined`). */
export function sanitizePlanning(row: Record<string, unknown>): { budgetDays?: number; blocks?: true } {
  const out: { budgetDays?: number; blocks?: true } = {}
  const b = row['budgetDays']
  if (typeof b === 'number' && Number.isInteger(b) && b >= 1 && b <= 366) out.budgetDays = b
  if (row['blocks'] === true) out.blocks = true
  return out
}

export type Run = { start: DayNumber; end: DayNumber }

/** The days between two ends, whichever order they arrive in, clipped to the
 *  year at both ends (SPEC: a run is a date RANGE, not a rectangle, and is
 *  clipped to the displayed year). Inclusive. */
export function runOf(a: DayNumber, b: DayNumber, yearStart: DayNumber, yearEnd: DayNumber): Run {
  return {
    start: asDay(Math.max(Math.min(a, b), yearStart)),
    end: asDay(Math.min(Math.max(a, b), yearEnd)),
  }
}

/** Distinct days in [yearStart, yearEnd] covered by at least one ALL-DAY event
 *  of the category. Overlapping runs count a day once; timed events never
 *  count (SPEC "The plan strip"). Counting distinct days is also what makes
 *  the caller's input safe to hand over unfiltered: eventsForMonth stores a
 *  boundary-crossing event in both months, and the same event twice adds the
 *  same days to the same set — no id dedupe is needed here or upstream. */
export function daysUsed(events: readonly CalendarEvent[], categoryName: string, yearStart: DayNumber, yearEnd: DayNumber): number {
  const days = new Set<number>()
  for (const ev of events) {
    if (!ev.allDay || ev.category !== categoryName) continue
    const from = Math.max(ev.start, yearStart), to = Math.min(ev.end, yearEnd)
    for (let d = from; d <= to; d++) days.add(d)
  }
  return days.size
}

/** The lowest day of the run carrying an all-day event whose category is in
 *  the set, or null when the run is clear (SPEC "The conflict rule"). A timed
 *  event never blocks: the rule is about days, and a timed event is not a day. */
export function firstBlocked(run: Run, events: readonly CalendarEvent[], blockingNames: ReadonlySet<string>): DayNumber | null {
  let lowest: number | null = null
  for (const ev of events) {
    if (!ev.allDay || !blockingNames.has(ev.category)) continue
    if (ev.end < run.start || ev.start > run.end) continue
    const first = Math.max(ev.start, run.start)
    if (lowest === null || first < lowest) lowest = first
  }
  return lowest === null ? null : asDay(lowest)
}
