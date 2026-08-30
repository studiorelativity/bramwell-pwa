// STAGE 03 — week rows, bars, chips, lane packing, month badges, header. Sets data-cat and nothing else per frame.
import type { EventSpan, WeekIndex } from './types.ts'
/** EventSpan with the lane render.ts assigned. Not persisted, not exported beyond render.ts's consumers. */
export type PackedSpan = EventSpan & { lane: number }

/** Longest-first first-fit. The id tie-break is load-bearing: without it a
 *  repaint can reshuffle lanes under the user. Bars are all-day only — timed
 *  events render as chips (DECISIONS "In force — scroll and render"). */
export function packLanes(spans: EventSpan[]): PackedSpan[] {
  const bars = spans.filter(s => s.event.allDay)
  bars.sort((a, b) =>
    (b.to - b.from) - (a.to - a.from) ||
    a.from - b.from ||
    (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0))
  const lastUsed: number[] = []   // lastUsed[lane] = rightmost offset occupied
  const out: PackedSpan[] = []
  for (const s of bars) {
    let lane = 0
    while (lane < lastUsed.length && (lastUsed[lane] ?? -1) >= s.from) lane++
    lastUsed[lane] = s.to
    out.push({ ...s, lane })
  }
  return out
}

export function renderWeek(_week: WeekIndex, _spans: EventSpan[]): HTMLElement { throw new Error('STAGE 03: not implemented') }
