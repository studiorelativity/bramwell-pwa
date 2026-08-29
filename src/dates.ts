// STAGE 01 — anchorless civil-date core. Imports nothing. Anything may import this.
// Date objects appear here only as Date.UTC scratch; none escape.
import type { DayNumber, WeekIndex, DayOffset, MonthKey } from './types.ts'

const MS_PER_DAY = 86_400_000
/** 1970-01-01 was a Thursday: DayOffset 3 under 0=Mon. */
const EPOCH_OFFSET = 3

export const asDay = (n: number): DayNumber => n as DayNumber
export const asWeek = (n: number): WeekIndex => n as WeekIndex
export const asOffset = (n: number): DayOffset => n as DayOffset

/** m is 1..12. Out-of-range d normalises the way Date.UTC does (Feb 29 in a common year -> Mar 1). */
export function civilToDay(y: number, m: number, d: number): DayNumber {
  return asDay(Date.UTC(y, m - 1, d) / MS_PER_DAY)
}

export function dayToCivil(day: DayNumber): { y: number; m: number; d: number } {
  const t = new Date(day * MS_PER_DAY)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

export const addDays = (day: DayNumber, n: number): DayNumber => asDay(day + n)

/** Weekday of an absolute day, 0=Mon … 6=Sun. Works for negative days. */
export function offsetOf(day: DayNumber): DayOffset {
  return asOffset((((day + EPOCH_OFFSET) % 7) + 7) % 7)
}

export function monthKey(day: DayNumber): MonthKey {
  const { y, m } = dayToCivil(day)
  return `${y}-${String(m).padStart(2, '0')}`
}
