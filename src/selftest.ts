// STAGE 01 — pure self-test over the date core. No DOM. Cases 5–8 are added in Task 4.
import type { DayNumber } from './types.ts'
import { asDay, asWeek, asOffset, civilToDay, dayToCivil, addDays, offsetOf, monthKey } from './dates.ts'
import { today, weekOf, dayAt, _setAnchorForTest } from './state.ts'

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
    if (offsetOf(asDay(-4)) !== 6) return `1969-12-28 offset ${offsetOf(asDay(-4))}`
    return null
  }],

  ['801-day weekday oracle', () => {
    // Oracle: Date.getUTCDay() (0=Sun) remapped to 0=Mon. 801 days from 2023-12-01 crosses one Feb 29 and three year boundaries.
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

  ['Monday start', () => {
    for (let w = -3; w <= 3; w++) {
      const mon = dayAt(asWeek(w), asOffset(0))
      if (offsetOf(mon) !== 0) return `week ${w} starts on offset ${offsetOf(mon)}`
      const sun = dayAt(asWeek(w), asOffset(6))
      if (offsetOf(sun) !== 6) return `week ${w} ends on offset ${offsetOf(sun)}`
      if (sun - mon !== 6) return `week ${w} spans ${sun - mon} days`
    }
    return null
  }],

  ['year boundary in one row', () => {
    // 2024-12-30 (Mon) .. 2025-01-05 (Sun) is one row. Pin the anchor inside it.
    const saved = today()
    _setAnchorForTest(civilToDay(2025, 1, 2))
    try {
      const mon = civilToDay(2024, 12, 30), sun = civilToDay(2025, 1, 5)
      if (weekOf(mon) !== 0 || weekOf(sun) !== 0) return `weekOf: ${weekOf(mon)} / ${weekOf(sun)}`
      if (dayAt(asWeek(0), asOffset(0)) !== mon) return `row start ${dayAt(asWeek(0), asOffset(0))} want ${mon}`
      if (dayAt(asWeek(0), asOffset(6)) !== sun) return `row end ${dayAt(asWeek(0), asOffset(6))} want ${sun}`
      if (weekOf(addDays(mon, -1)) !== -1) return `Sunday before is week ${weekOf(addDays(mon, -1))}`
      return null
    } finally { _setAnchorForTest(saved) }
  }],

  ['DST-safe stepping across two local years', () => {
    // Walk two local-clock years day by day with Date#setDate (which honours local DST),
    // and demand that addDays over DayNumber lands on the same civil date every step.
    const start = new Date(2024, 0, 1)   // local midnight
    let day = civilToDay(2024, 1, 1)
    const cursor = new Date(start)
    for (let i = 0; i < 731; i++) {
      const c = dayToCivil(day)
      if (c.y !== cursor.getFullYear() || c.m !== cursor.getMonth() + 1 || c.d !== cursor.getDate())
        return `step ${i}: DayNumber says ${c.y}-${c.m}-${c.d}, local clock says ${cursor.getFullYear()}-${cursor.getMonth() + 1}-${cursor.getDate()}`
      cursor.setDate(cursor.getDate() + 1)
      day = addDays(day, 1)
    }
    return null
  }],

  ['weekOf/dayAt round-trip', () => {
    const t = today()
    for (let n = -400; n <= 400; n += 7) {
      for (let o = 0; o < 7; o++) {
        const d = addDays(t, n + o - offsetOf(t))
        const back = dayAt(weekOf(d), offsetOf(d))
        if (back !== d) return `${d} -> week ${weekOf(d)} off ${offsetOf(d)} -> ${back}`
      }
    }
    return null
  }],

  ['week 0 contains today', () => {
    const t = today()
    if (weekOf(t) !== 0) return `today is week ${weekOf(t)}`
    const mon = dayAt(asWeek(0), asOffset(0))
    if (!(mon <= t && t <= addDays(mon, 6))) return `today ${t} outside row ${mon}..${addDays(mon, 6)}`
    const { y, m, d } = dayToCivil(t)
    const now = new Date()
    if (y !== now.getFullYear() || m !== now.getMonth() + 1 || d !== now.getDate()) return `today() is ${y}-${m}-${d}`
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
