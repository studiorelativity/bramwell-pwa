// STAGE 01 — pure self-test over the date core. No DOM. Cases 5–8 are added in Task 4.
import type { DayNumber } from './types.ts'
import { asWeek, asOffset, civilToDay, dayToCivil, addDays, offsetOf, monthKey } from './dates.ts'

export type SelfTestResult = { name: string; pass: boolean; detail: string }

type Case = [name: string, run: () => string | null] // null = pass, string = failure detail

const cases: Case[] = [
  ['civil round-trip incl. leap day', () => {
    const probes: [number, number, number][] = [
      [1970, 1, 1], [2000, 2, 29], [2024, 2, 29], [2026, 8, 29], [1999, 12, 31], [2100, 3, 1],
    ]
    for (const [y, m, d] of probes) {
      const back = dayToCivil(civilToDay(y, m, d))
      if (back.y !== y || back.m !== m || back.d !== d) return `${y}-${m}-${d} -> ${JSON.stringify(back)}`
    }
    // 2023 is not a leap year: Feb 29 must normalise to Mar 1, not round-trip
    const notLeap = dayToCivil(civilToDay(2023, 2, 29))
    if (!(notLeap.m === 3 && notLeap.d === 1)) return `2023-02-29 normalised to ${JSON.stringify(notLeap)}`
    return null
  }],

  ['epoch anchoring', () => {
    if (civilToDay(1970, 1, 1) !== 0) return `1970-01-01 = ${civilToDay(1970, 1, 1)}`
    if (civilToDay(1970, 1, 2) !== 1) return `1970-01-02 = ${civilToDay(1970, 1, 2)}`
    if (civilToDay(1969, 12, 31) !== -1) return `1969-12-31 = ${civilToDay(1969, 12, 31)}`
    if (civilToDay(2000, 1, 1) !== 10957) return `2000-01-01 = ${civilToDay(2000, 1, 1)}`
    return null
  }],

  ['801-day weekday oracle', () => {
    // Oracle: Date.getUTCDay() (0=Sun) remapped to 0=Mon. 801 days crosses two Feb 29s from 2023-12-01.
    let day = civilToDay(2023, 12, 1)
    for (let i = 0; i < 801; i++) {
      const { y, m, d } = dayToCivil(day)
      const expect = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
      if (offsetOf(day) !== expect) return `day ${day} (${y}-${m}-${d}): got ${offsetOf(day)} want ${expect}`
      day = addDays(day, 1)
    }
    return null
  }],

  ['month keys across a boundary', () => {
    const jan31 = civilToDay(2026, 1, 31)
    const pairs: [DayNumber, string][] = [
      [jan31, '2026-01'], [addDays(jan31, 1), '2026-02'],
      [civilToDay(2025, 12, 31), '2025-12'], [civilToDay(2026, 1, 1), '2026-01'],
      [civilToDay(2026, 9, 5), '2026-09'],
    ]
    for (const [d, want] of pairs) if (monthKey(d) !== want) return `${d}: got ${monthKey(d)} want ${want}`
    return null
  }],
]

export function selfTest(): SelfTestResult[] {
  return cases.map(([name, run]) => {
    try {
      const detail = run()
      return { name, pass: detail === null, detail: detail ?? 'ok' }
    } catch (e) {
      return { name, pass: false, detail: `threw: ${(e as Error).message}` }
    }
  })
}
