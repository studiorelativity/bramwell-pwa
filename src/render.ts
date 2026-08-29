// STAGE 03 — week rows, bars, chips, lane packing, month badges, header. Sets data-cat and nothing else per frame.
import type { EventSpan, WeekIndex } from './types.ts'
/** EventSpan with the lane render.ts assigned. Not persisted, not exported beyond render.ts's consumers. */
export type PackedSpan = EventSpan & { lane: number }
export function renderWeek(_week: WeekIndex, _spans: EventSpan[]): HTMLElement { throw new Error('STAGE 03: not implemented') }
