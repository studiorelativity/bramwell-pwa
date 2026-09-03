// STAGE 03 — year view. 365/366 cells in one pass; no virtualization.
import type { CalendarEvent, DayNumber, MonthKey } from './types.ts'
import { asDay, civilToDay, dayToCivil, monthKey, offsetOf } from './dates.ts'
import { assignLanes, tline } from './render.ts'
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
    // The elapsed-time line marks the CURRENT calendar year only (SPEC "Visual
    // direction"); another year shows a plain grid.
    const markYear = year === dayToCivil(t).y

    const grid = document.createElement('div')
    grid.className = 'yr'
    grid.style.setProperty('--cols', String(cols))

    // 28 columns is the only width wide enough for a full month name and for
    // inline titles; below it the spine carries a 3-letter name and titles are
    // dropped (SPEC "Year view"). Stretch is off entirely at 7 columns, where
    // there is no room to give any cell 2.2fr without crushing the rest.
    const wide = cols >= 28
    const stretchOn = cols > 7
    const SPINE_W = wide ? '24px' : '18px'

    /** The month divider that replaced the year grid's `.badge`. */
    const spineFor = (m: number): HTMLElement => {
      const sp = document.createElement('div')
      sp.className = 'yrspine'
      const name = new Date(Date.UTC(2000, m - 1, 1))
        .toLocaleString(undefined, { month: wide ? 'long' : 'short', timeZone: 'UTC' })
      sp.dataset['monthName'] = name
      sp.textContent = name
      return sp
    }

    const cells: HTMLElement[] = []
    for (let i = 0; i < indent; i++) {
      const pad = document.createElement('div')
      pad.className = 'yrcell'
      pad.dataset['pad'] = ''
      cells.push(pad)
    }
    for (let d = jan1; d <= dec31; d = asDay(d + 1)) {
      const { m, d: dom } = dayToCivil(d)
      // The spine goes IN the cells array, immediately before each 1st (Jan 1
      // included, after the indent pads), so it is a real track and the row's
      // index arithmetic stays honest rather than needing a parallel offset.
      if (dom === 1) cells.push(spineFor(m))
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
      // No `.badge` here any more: the spine names the month, and printing it
      // twice on the 1st is the duplicate rendering CONVENTIONS' stand-down
      // rule exists to stop (SPEC "Layout details" now exempts this view).
      cells.push(cell)
    }

    // Pad the tail to a whole row. The template is now built from the row's
    // OWN tracks rather than a fixed repeat(cols, 1fr), so a short final row
    // would otherwise spread its handful of December cells across the entire
    // width — the same reason the year starts with indent pads.
    const tail = (indent + (dec31 - jan1 + 1)) % cols
    if (tail !== 0) {
      for (let i = tail; i < cols; i++) {
        const pad = document.createElement('div')
        pad.className = 'yrcell'
        pad.dataset['pad'] = ''
        cells.push(pad)
      }
    }

    // Rows hold `cols` DAY cells; spines are EXTRA tracks, so a row carrying a
    // month boundary has cols + 1. Slicing a fixed `cols` ITEMS instead (the
    // old shape) would let each spine steal a day column and cascade the rest
    // of the year sideways from every boundary.
    const rows: HTMLElement[][] = []
    let cur: HTMLElement[] = []
    let dayCount = 0
    for (const el of cells) {
      if (dayCount === cols) { rows.push(cur); cur = []; dayCount = 0 }
      cur.push(el)
      if (!el.classList.contains('yrspine')) dayCount++   // pads hold a column too
    }
    if (cur.length > 0) rows.push(cur)

    // Each row is a grid of tracks plus a bar overlay — the week-row shape at
    // year scale, so a multi-day run holds ONE lane across the row and crosses
    // the tile gaps as one object (DECISIONS).
    for (const rowCells of rows) {
      const row = document.createElement('div')
      row.className = 'yrrow'
      row.append(...rowCells)

      // Day number -> its TRACK index in this row. A multi-day bar's end is
      // looked up here rather than computed as `from + (end - start)`: a spine
      // sitting between the two days is a track the day arithmetic cannot see,
      // so that sum stops one track short of every boundary it crosses.
      const trackOfDay = new Map<number, number>()
      rowCells.forEach((el, i) => {
        const d = el.dataset['day']
        if (d !== undefined) trackOfDay.set(Number(d), i)
      })
      const lastDay = trackOfDay.size > 0 ? Math.max(...trackOfDay.keys()) : 0

      const items: { from: number; to: number; id: string; cat: string }[] = []
      const seen = new Set<string>()
      const titles = new Map<number, { title: string; cat: string }[]>()
      rowCells.forEach((cell, i) => {
        const dayAttr = cell.dataset['day']
        if (dayAttr === undefined) return
        const day = asDay(Number(dayAttr))
        for (const ev of eventsForMonth(monthKey(day))) {
          const last = ev.allDay ? ev.end : ev.start
          if (last < day || ev.start > day) continue
          // Per-cell marks are collected in THIS walk, never a second per-cell
          // lookup (DECISIONS: markers collected during lane packing). Every
          // covering event counts here, including ones `seen` skips below —
          // `seen` dedupes BARS, not day occupancy.
          cell.dataset['hasEv'] = ''
          if (stretchOn) cell.dataset['stretch'] = ''
          const list = titles.get(i) ?? []
          if (list.length < 2) { list.push({ title: ev.title, cat: ev.category }); titles.set(i, list) }
          if (seen.has(ev.id)) continue
          seen.add(ev.id)
          const endDay = ev.allDay ? Math.min(ev.end, lastDay) : day
          items.push({ from: i, to: trackOfDay.get(endDay) ?? i, id: ev.id, cat: ev.category })
        }
      })

      // Computed once, here, and never transitioned: interpolating
      // grid-template-columns is the recorded KNOWN LIMITATION (SPEC "Scroll
      // engine API"), which is why the stretch is static and hover feedback is
      // the compositor-only lift instead.
      row.style.setProperty('--yr-cols', rowCells.map(el =>
        el.classList.contains('yrspine') ? SPINE_W
          : stretchOn && el.dataset['hasEv'] !== undefined ? '2.2fr'
            : '1fr').join(' '))

      // Inline titles only where a stretched cell is actually wide enough.
      if (wide) {
        for (const [i, list] of titles) {
          const cell = rowCells[i]
          if (cell === undefined) continue
          const box = document.createElement('div')
          box.className = 'yrtitles'
          for (const t of list) {
            const line = document.createElement('div')
            line.className = 'yrtitle'
            line.dataset['cat'] = t.cat
            const dot = document.createElement('span'); dot.className = 'yrtdot'
            const tt = document.createElement('span'); tt.className = 'yrtt'; tt.textContent = t.title
            line.append(dot, tt)
            box.append(line)
          }
          cell.append(box)
        }
      }

      const layer = document.createElement('div')
      layer.className = 'yrbars'
      // The elapsed-time line, one straight segment per class per row, in
      // TRACK indices: a spine between two days is a track the segment simply
      // spans, and the spine (z-index above this layer) interrupts it visibly —
      // a month tick on the year's rail, which is the right thing to see.
      if (markYear) {
        let pf = -1, pt = -1, ff = -1, ft = -1
        for (const [d, i] of trackOfDay) {
          if (d === t) continue
          if (d < t) { if (pf < 0 || i < pf) pf = i; if (i > pt) pt = i }
          else { if (ff < 0 || i < ff) ff = i; if (i > ft) ft = i }
        }
        if (pf >= 0) layer.append(tline('tline-past', pf, pt))
        if (ff >= 0) layer.append(tline('tline-future', ff, ft))
      }
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
