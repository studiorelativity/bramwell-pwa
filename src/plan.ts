// PLANNING LAYER (2026-09-05) — the pure core: run selection, budget usage,
// the conflict check, and the planning half of the category loader. DOM-free;
// imports types.ts and dates.ts only. year.ts owns the strip, the drag and the
// writes (SPEC "Planning layer"); this file never sees an element.
import type { CalendarEvent, DayNumber } from './types.ts'

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
