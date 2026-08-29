// STAGE 08 — journal link/index resolution. No network of its own. DOM-free; never imports state.ts.
import type { DayNumber } from './types.ts'
const E = () => new Error('STAGE 08: not implemented')
export function linkFor(_day: DayNumber): string { throw E() }
