// STAGE 03 — year view. 365/366 cells in one pass; no virtualization.
import type { CalendarEvent, DayNumber, MonthKey } from './types.ts'
import { asDay, civilToDay, dayToCivil, monthKey, offsetOf } from './dates.ts'
import { assignLanes } from './render.ts'
import { ensureMonthsFor, eventsForMonth, today, weekOf } from './state.ts'

export type YearHost = { onPickDay(day: DayNumber): void }
export type YearController = {
  setYear(y: number): void
  /** Repaint for a cache change; the caller filters by year first (SPEC). */
  invalidate(): void
  destroy(): void
}

const WDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
/** Bars beyond this lane are dropped in the grid; the panel lists them all (SPEC). */
const MAX_LANES = 3
/** Gap between a cell and its panel. */
const PANEL_GAP = 6

/** 28 columns (four weeks) on desktop; 14 on tablets AND phones. Phones
 *  default to 14, not 7 — OPEN.md flags 7 as "a long scroll" and this
 *  stage's gate settles it. 7 is kept only for very narrow windows. */
export function columnsFor(width: number): number {
  return width >= 1100 ? 28 : width >= 360 ? 14 : 7
}

/** "9:05am" — meridiem start time for the panel (SPEC "Year view"). */
export function meridiem(min: number): string {
  const h = Math.floor(min / 60), m = min % 60
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`
}

function eventsOn(day: DayNumber): CalendarEvent[] {
  return eventsForMonth(monthKey(day))
    .filter(e => e.start <= day && e.end >= day)
    .sort((a, b) => Number(!a.allDay) - Number(!b.allDay) || (a.startMin ?? 0) - (b.startMin ?? 0) || (a.id < b.id ? -1 : 1))
}

export function mount(root: HTMLElement, host: YearHost): YearController {
  let year = dayToCivil(today()).y
  // The grid is rebuilt as a whole, but only THIS child is replaced, so the
  // panel beside it survives a repaint (SPEC "Year view").
  const gridHost = document.createElement('div')
  gridHost.className = 'yrgrid'
  const panel = document.createElement('div')
  panel.className = 'yrpanel'
  panel.hidden = true
  root.append(gridHost, panel)
  /** Day the panel currently shows; null when hidden. */
  let shown: DayNumber | null = null

  function build(): void {
    // A hidden root (main.ts hides the year view under the calendar) reads
    // clientWidth 0, and columnsFor(0) maps to a real column count (7) —
    // not an error, so nothing downstream would notice it is wrong. A
    // component that measures itself refuses to measure while it has no
    // size, the same guard scroll.ts's measure() uses for the same reason.
    if (root.clientWidth === 0) return
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
          if (seen.has(ev.id)) continue
          // Timed events get a bar HERE, unlike a calendar week row, where
          // render.ts's packLanes excludes them because they already have a
          // chip. The year grid has no chips, so the same exclusion made a day
          // with only timed events read as empty — the whole point of the view
          // is seeing where the year is busy (SPEC "Year view": bars are for
          // "that day's events", not that day's all-day events).
          // A timed event occupies its START day only, the rule day.ts's
          // eventsOn already uses; only an all-day event runs on to ev.end.
          const last = ev.allDay ? ev.end : ev.start
          if (last < day || ev.start > day) continue
          seen.add(ev.id)
          // One cell for a timed event; a real run for an all-day one, so
          // longest-first still hands multi-day events their lane first.
          const to = ev.allDay ? Math.min(cols - 1, i + (ev.end - day)) : i
          items.push({ from: i, to, id: ev.id, cat: ev.category })
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
    // A background repaint rebuilds the panel IN PLACE — never hides it — so
    // it cannot flicker under the pointer (SPEC "Year view").
    if (shown !== null) {
      const cell = cellFor(shown)
      if (cell !== null) showPanel(cell, shown)
    }
    // Opening a year fetches its months (SPEC). ensureMonthsFor takes weeks;
    // the week holding each 1st covers that month's key.
    ensureMonthsFor(Array.from({ length: 12 }, (_, i) => weekOf(civilToDay(year, i + 1, 1))))
  }

  function cellFor(day: DayNumber): HTMLElement | null {
    return gridHost.querySelector<HTMLElement>(`.yrcell[data-day="${day}"]`)
  }

  // ---- hover panel: previous / hovered / next day, every event in full ----

  function fillPanel(day: DayNumber): void {
    const frag = document.createDocumentFragment()
    for (const d of [asDay(day - 1), day, asDay(day + 1)]) {
      const c = dayToCivil(d)
      const head = document.createElement('div')
      head.className = 'yrp-day'
      if (d === day) head.dataset['focus'] = ''
      // Locale order, not a hardcoded one: `${c.d}/${c.m}` read as 30/8, which a
      // US reader parses as a nonexistent 30th month. This is a DISPLAY boundary,
      // so a Date is allowed here (CONVENTIONS), and timeZone UTC is required —
      // DayNumber is a UTC civil date, the same pattern day.ts's header and the
      // month badge above already use. en-US gives 8/30, en-GB 30/08.
      const md = new Date(Date.UTC(c.y, c.m - 1, c.d))
        .toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', timeZone: 'UTC' })
      head.textContent = `${WDAY[offsetOf(d)] ?? ''} ${md}`
      frag.append(head)
      const evs = eventsOn(d)
      if (evs.length === 0) {
        const none = document.createElement('div'); none.className = 'yrp-none'; none.textContent = '—'
        frag.append(none)
      }
      for (const e of evs) {
        const row = document.createElement('div')
        row.className = 'yrp-ev'
        row.dataset['cat'] = e.category
        const dot = document.createElement('span'); dot.className = 'dot'
        const at = document.createElement('span'); at.className = 'at'
        at.textContent = e.allDay ? '' : meridiem(e.startMin)
        const ttl = document.createElement('span'); ttl.className = 'ttl'; ttl.textContent = e.title
        row.append(dot, at, ttl)
        frag.append(row)
      }
    }
    panel.replaceChildren(frag)
  }

  /** Below the cell; flips above when there is no room. Coordinates are in
   *  root's scrolled content space, since the panel is absolute inside it. */
  function showPanel(cell: HTMLElement, day: DayNumber): void {
    fillPanel(day)
    panel.hidden = false
    const r = cell.getBoundingClientRect()
    const rr = root.getBoundingClientRect()
    const pw = panel.offsetWidth, ph = panel.offsetHeight
    const fitsBelow = r.bottom + PANEL_GAP + ph <= rr.bottom
    const top = fitsBelow ? r.bottom + PANEL_GAP : r.top - PANEL_GAP - ph
    const left = Math.max(rr.left + PANEL_GAP, Math.min(r.left, rr.right - pw - PANEL_GAP))
    panel.style.left = `${left - rr.left + root.scrollLeft}px`
    panel.style.top = `${top - rr.top + root.scrollTop}px`
    panel.dataset['flip'] = fitsBelow ? 'below' : 'above'
    shown = day
  }
  function hidePanel(): void { panel.hidden = true; shown = null }

  function cellOf(e: Event): { cell: HTMLElement; day: DayNumber } | null {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.yrcell[data-day]')
    const d = cell?.dataset['day']
    return cell && d !== undefined ? { cell, day: asDay(Number(d)) } : null
  }

  function onOver(e: PointerEvent): void {
    // Touch raises the panel from the click flow below, not from the
    // pointerover that precedes a tap — otherwise the first tap would count
    // as the second.
    if (e.pointerType === 'touch') return
    const hit = cellOf(e)
    if (hit !== null && hit.day !== shown) showPanel(hit.cell, hit.day)
  }
  function onLeave(): void { hidePanel() }

  /** Touch: first tap raises the panel, a second tap on the SAME day opens
   *  it, a tap elsewhere dismisses. Pointer: a click opens. (SPEC) */
  function onClick(e: Event): void {
    const hit = cellOf(e)
    if (hit === null) { hidePanel(); return }
    const coarse = window.matchMedia('(hover: none)').matches
    if (coarse && shown !== hit.day) { showPanel(hit.cell, hit.day); return }
    host.onPickDay(hit.day)
  }

  root.addEventListener('click', onClick)
  root.addEventListener('pointerover', onOver)
  root.addEventListener('pointerleave', onLeave)
  window.addEventListener('resize', build)
  build()

  return {
    setYear(y) {
      if (y !== year) hidePanel()          // the one case the panel is dropped (SPEC)
      year = y
      build()
    },
    invalidate() { build() },
    destroy() {
      root.removeEventListener('click', onClick)
      root.removeEventListener('pointerover', onOver)
      root.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('resize', build)
      root.replaceChildren()
    },
  }
}
