// STAGE 03 — year view. 365/366 cells in one pass; no virtualization.
import type { DayNumber, MonthKey } from './types.ts'
import { asDay, civilToDay, dayToCivil, monthKey, offsetOf } from './dates.ts'
import { assignLanes } from './render.ts'
import { ensureMonthsFor, eventsForMonth, today, weekOf } from './state.ts'

export type YearHost = { onPickDay(day: DayNumber): void }
export type YearController = {
  setYear(y: number): void
  /** Repaint for a cache change. `months` lets the caller skip years not on screen. */
  invalidate(): void
  destroy(): void
}

const WDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
/** Bars beyond this lane are dropped in the grid; the panel lists them all (SPEC). */
const MAX_LANES = 3

/** 28 columns (four weeks) on desktop; 14 on tablets AND phones. Phones
 *  default to 14, not 7 — OPEN.md flags 7 as "a long scroll" and this
 *  stage's gate settles it. 7 is kept only for very narrow windows. */
export function columnsFor(width: number): number {
  return width >= 1100 ? 28 : width >= 360 ? 14 : 7
}

function monthsOfYear(y: number): MonthKey[] {
  return Array.from({ length: 12 }, (_, i) => monthKey(civilToDay(y, i + 1, 1)))
}

export function mount(root: HTMLElement, host: YearHost): YearController {
  let year = dayToCivil(today()).y
  // The grid is rebuilt as a whole, but only THIS child is replaced, so a
  // sibling (the hover panel, Task 10) survives a repaint (SPEC "Year view").
  const gridHost = document.createElement('div')
  gridHost.className = 'yrgrid'
  root.append(gridHost)

  function build(): void {
    const cols = columnsFor(root.clientWidth)
    const jan1 = civilToDay(year, 1, 1)
    const indent = offsetOf(jan1)                 // 0 = Mon, so every column is one weekday
    const dec31 = civilToDay(year, 12, 31)
    const t = today()

    const grid = document.createElement('div')
    grid.className = 'yr'
    grid.style.setProperty('--cols', String(cols))

    const cells: HTMLElement[] = []
    for (let i = 0; i < indent; i++) {
      const pad = document.createElement('div')
      pad.className = 'yrcell'
      pad.dataset['pad'] = ''
      cells.push(pad)
    }
    for (let d = jan1; d <= dec31; d = asDay(d + 1)) {
      const { m, d: dom } = dayToCivil(d)
      const cell = document.createElement('div')
      cell.className = 'yrcell'
      cell.dataset['band'] = m % 2 === 0 ? 'a' : 'b'
      const off = offsetOf(d)
      if (off >= 5) cell.dataset['weekend'] = ''
      if (d === t) cell.dataset['today'] = ''
      cell.dataset['day'] = String(d)
      const wd = document.createElement('span'); wd.className = 'yrwd'; wd.textContent = WDAY[off] ?? ''
      const num = document.createElement('span'); num.className = 'yrnum'; num.textContent = String(dom)
      cell.append(wd, num)
      if (dom === 1) {
        const badge = document.createElement('span'); badge.className = 'badge'
        badge.textContent = new Date(Date.UTC(2000, m - 1, 1)).toLocaleString(undefined, { month: 'short', timeZone: 'UTC' })
        cell.append(badge)
      }
      cells.push(cell)
    }

    // One row per `cols` cells, each with its own bar overlay — the same
    // shape as a week row, so a multi-day run holds ONE lane across the row
    // and crosses the tile gaps as one object (DECISIONS).
    for (let start = 0; start < cells.length; start += cols) {
      const rowCells = cells.slice(start, start + cols)
      const row = document.createElement('div')
      row.className = 'yrrow'
      row.append(...rowCells)

      const items: { from: number; to: number; id: string; cat: string }[] = []
      const seen = new Set<string>()
      rowCells.forEach((cell, i) => {
        const dayAttr = cell.dataset['day']
        if (dayAttr === undefined) return
        const day = asDay(Number(dayAttr))
        for (const ev of eventsForMonth(monthKey(day))) {
          if (!ev.allDay || seen.has(ev.id)) continue
          if (ev.end < day || ev.start > day) continue
          seen.add(ev.id)
          items.push({ from: i, to: Math.min(cols - 1, i + (ev.end - day)), id: ev.id, cat: ev.category })
        }
      })
      const layer = document.createElement('div')
      layer.className = 'yrbars'
      for (const it of assignLanes(items)) {
        if (it.lane >= MAX_LANES) continue
        const bar = document.createElement('div')
        bar.className = 'yrbar'
        bar.dataset['cat'] = it.cat
        bar.style.gridColumn = `${it.from + 1} / ${it.to + 2}`
        bar.style.setProperty('--lane', String(it.lane))
        layer.append(bar)
      }
      row.append(layer)
      grid.append(row)
    }
    gridHost.replaceChildren(grid)
    // Opening a year fetches its months (SPEC). ensureMonthsFor takes weeks;
    // the week holding each 1st covers that month's key.
    ensureMonthsFor(monthsOfYear(year).map((_, i) => weekOf(civilToDay(year, i + 1, 1))))
  }

  function onClick(e: Event): void {
    const cell = (e.target as HTMLElement).closest('.yrcell') as HTMLElement | null
    const d = cell?.dataset['day']
    if (d !== undefined) host.onPickDay(asDay(Number(d)))
  }
  root.addEventListener('click', onClick)
  window.addEventListener('resize', build)
  build()

  return {
    setYear(y) { year = y; build() },
    invalidate() { build() },
    destroy() {
      root.removeEventListener('click', onClick)
      window.removeEventListener('resize', build)
      root.replaceChildren()
    },
  }
}
