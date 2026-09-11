// STAGE 03 — year view. 365/366 cells in one pass; no virtualization.
// PLANNING LAYER (2026-09-05) — the plan strip, paint and erase modes. The
// drag/paint/erase controller below is written against a host interface so
// iteration D can mount it on the month grid (SPEC "Planning layer — Both
// views"); it reads nothing from mount()'s closures.
import type { CalendarEvent, DayNumber, EventDraft, MonthKey, WriteScope } from './types.ts'
import { asDay, civilToDay, dayToCivil, monthKey, offsetOf } from './dates.ts'
import { assignLanes, tline } from './render.ts'
import { createEvent, deleteEvent, ensureMonthsFor, eventsForMonth, today, weekOf } from './state.ts'
import { all as allCategories } from './categories.ts'
import { daysAdded, daysUsed, firstBlocked, runOf } from './plan.ts'
import type { Run } from './plan.ts'

/** toast: write errors and refusals surface here, so year.ts never imports chrome.ts (SPEC). */
export type YearHost = { onPickDay(day: DayNumber): void; toast(message: string): void }
export type YearController = {
  setYear(y: number): void
  /** Repaint for a cache change; the caller filters by year first (SPEC). */
  invalidate(): void
  /** Leave paint/erase mode, abandoning a run in progress. main.ts calls it
   *  from showYear(false): leaving the year view exits the mode (SPEC). */
  exitMode(): void
  destroy(): void
}

// ---- the planning controller: mode, pointer capture, run highlight, the
// conflict check, the write, Escape. Host-agnostic by ruling (SPEC "Both views").

export type PlanMode = { kind: 'paint'; cat: string } | { kind: 'erase' } | null

export type PlanHost = {
  /** Carries `data-mode` and the listeners. */
  root: HTMLElement
  /** Captures the pointer for the drag (the year grid host; D: the scroller). */
  surface: HTMLElement
  /** Pointer position -> the day cell under it, via elementFromPoint. */
  cellAt(x: number, y: number): Element | null
  /** Every mounted cell of the run, for the highlight. */
  cellsIn(run: Run): Element[]
  dayOf(cell: Element): DayNumber | null
  /** The all-day event erase would remove from this cell, or null. */
  laneZeroId(cell: Element): string | null
  /** Events touching the run — duplicates across months are harmless (plan.ts). */
  eventsIn(run: Run): CalendarEvent[]
  /** Clipping range for a run (the displayed year here). */
  bounds(): Run
  createEvent(draft: EventDraft): Promise<unknown>
  deleteEvent(id: string, scope: WriteScope): Promise<void>
  toast(message: string): void
  /** Fired after every mode change, including exit; the host suppresses its
   *  hover panel and syncs its chips here. */
  onModeChange(mode: PlanMode): void
}

export type PlanController = {
  mode(): PlanMode
  /** Select a mode, or deselect it when it is already the current one (the
   *  strip is the mode switch: click a chip to paint, click it again to stop). */
  toggle(mode: NonNullable<PlanMode>): void
  exit(): void
  destroy(): void
}

/** A pointer that travels further than this was a drag, not a tap. main.ts's
 *  own TAP_SLOP, copied by value — main.ts is not importable from here. */
const TAP_SLOP = 6

/** "Aug 14" — the toast's day, locale-formatted at a display boundary (CONVENTIONS). */
function shortDate(day: DayNumber): string {
  return new Date(day * 86_400_000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function mountPlanner(host: PlanHost): PlanController {
  let mode: PlanMode = null
  let drag: { id: number; startDay: DayNumber; lastDay: DayNumber; x: number; y: number; cell: Element } | null = null
  let painted = new Set<Element>()

  function unpaint(cell: Element): void {
    cell.removeAttribute('data-paint')
    cell.removeAttribute('data-cat')
  }
  function clearPaint(): void {
    for (const c of painted) unpaint(c)
    painted = new Set()
  }
  /** Re-marks the run: cells leaving it are cleared, cells entering it are set.
   *  `data-cat` rides along so the cell's `--cat` resolves through the same
   *  `[data-cat]` rule the bars use (SPEC: the highlight is the bar fill). */
  function highlight(run: Run, cat: string): void {
    const next = new Set(host.cellsIn(run))
    for (const c of painted) if (!next.has(c)) unpaint(c)
    for (const c of next) {
      c.setAttribute('data-paint', '')
      c.setAttribute('data-cat', cat)
    }
    painted = next
  }
  function release(): void {
    if (drag === null) return
    try { host.surface.releasePointerCapture(drag.id) } catch { /* already released */ }
    drag = null
  }
  function abandon(): void {
    release()
    clearPaint()
  }
  function set(m: PlanMode): void {
    abandon()
    mode = m
    if (m === null) delete host.root.dataset['mode']
    else host.root.dataset['mode'] = m.kind
    host.onModeChange(m)
  }
  const same = (a: NonNullable<PlanMode>, b: NonNullable<PlanMode>): boolean =>
    a.kind === b.kind && (a.kind !== 'paint' || b.kind !== 'paint' || a.cat === b.cat)

  function onDown(e: PointerEvent): void {
    if (mode === null || !e.isPrimary) return
    const cell = host.cellAt(e.clientX, e.clientY)
    if (cell === null) return
    const day = host.dayOf(cell)
    if (day === null) return
    e.preventDefault()
    abandon()
    drag = { id: e.pointerId, startDay: day, lastDay: day, x: e.clientX, y: e.clientY, cell }
    try { host.surface.setPointerCapture(e.pointerId) } catch { /* a synthetic pointer has no capture */ }
    if (mode.kind === 'paint') {
      const b = host.bounds()
      highlight(runOf(day, day, b.start, b.end), mode.cat)
    }
  }
  function onMove(e: PointerEvent): void {
    if (drag === null || mode?.kind !== 'paint' || e.pointerId !== drag.id) return
    // elementFromPoint on every move: after capture the event's own target is
    // the surface, not the cell (SPEC "Paint mode").
    const cell = host.cellAt(e.clientX, e.clientY)
    if (cell === null) return
    const day = host.dayOf(cell)
    if (day === null) return
    drag.lastDay = day
    const b = host.bounds()
    highlight(runOf(drag.startDay, day, b.start, b.end), mode.cat)
  }
  function onUp(e: PointerEvent): void {
    if (drag === null || e.pointerId !== drag.id) return
    const d = drag
    release()
    clearPaint()
    if (mode === null) return
    if (mode.kind === 'erase') {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP) return   // a drag, not a click
      const id = host.laneZeroId(d.cell)
      if (id === null) return                                                // nothing under it: nothing happens
      const one = { start: d.startDay, end: d.startDay }
      const ev = host.eventsIn(one).find(x => x.id === id)
      if (ev?.recurringEventId !== undefined) { host.toast('Recurring — edit it from the month view'); return }
      void host.deleteEvent(id, 'instance').catch(err => host.toast(errorMessage(err)))
      return
    }
    const cat = allCategories().find(c => c.name === (mode as { cat: string }).cat)
    if (cat === undefined) return                                            // deleted mid-mode; the strip exits it on repaint
    const b = host.bounds()
    const run = runOf(d.startDay, d.lastDay, b.start, b.end)
    // The conflict rule: refused BEFORE the optimistic apply, unless the chip
    // itself blocks — that is how blackouts are laid down (SPEC).
    if (cat.blocks !== true) {
      const blocking = new Set(allCategories().filter(c => c.blocks === true).map(c => c.name))
      const hit = firstBlocked(run, host.eventsIn(run), blocking)
      if (hit !== null) { host.toast(`${shortDate(hit)} is blocked`); return }
    }
    // The budget warning (SPEC, 2026-09-05): a run that takes the category past
    // its budget still paints — a budget is the user's own allowance — but says
    // so. Counts only the days the run newly adds, so repainting over an
    // existing run never warns twice.
    if (cat.budgetDays !== undefined) {
      const after = daysUsed(host.eventsIn(b), cat.name, b.start, b.end) + daysAdded(run, host.eventsIn(run), cat.name)
      if (after > cat.budgetDays) host.toast(`${cat.label}: ${after} of ${cat.budgetDays} days`)
    }
    void host.createEvent({
      title: cat.label, category: cat.name, allDay: true, start: run.start, end: run.end, repeat: 'none',
    }).catch(err => host.toast(errorMessage(err)))
  }
  function onCancel(e: PointerEvent): void {
    if (drag !== null && e.pointerId === drag.id) abandon()
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && mode !== null) set(null)    // mid-drag: abandon() inside set()
  }

  host.root.addEventListener('pointerdown', onDown)
  host.root.addEventListener('pointermove', onMove)
  host.root.addEventListener('pointerup', onUp)
  host.root.addEventListener('pointercancel', onCancel)
  document.addEventListener('keydown', onKey)

  return {
    mode: () => mode,
    toggle(m) { set(mode !== null && same(mode, m) ? null : m) },
    exit() { if (mode !== null) set(null) },
    destroy() {
      set(null)
      host.root.removeEventListener('pointerdown', onDown)
      host.root.removeEventListener('pointermove', onMove)
      host.root.removeEventListener('pointerup', onUp)
      host.root.removeEventListener('pointercancel', onCancel)
      document.removeEventListener('keydown', onKey)
    },
  }
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

/** Coarse pointer: the panel carries "Tap again to open" and is itself tappable
 *  (SPEC "Year view — Touch", amended 2026-09-05). */
const coarse = (): boolean => window.matchMedia('(hover: none)').matches

export function mount(root: HTMLElement, host: YearHost): YearController {
  let year = dayToCivil(today()).y
  // The strip sits between the header and the grid, always visible in the year
  // view (SPEC "The plan strip"). Its own child so a grid rebuild never touches it.
  const strip = document.createElement('div')
  strip.className = 'planstrip'
  const hint = document.createElement('p')
  hint.className = 'planhint'
  hint.setAttribute('aria-live', 'polite')
  const head = document.createElement('div')
  head.className = 'planhead'
  head.append(strip, hint)
  // The grid is rebuilt as a whole, but only THIS child is replaced, so the
  // panel beside it survives a repaint (SPEC "Year view").
  const gridHost = document.createElement('div')
  gridHost.className = 'yrgrid'
  const panel = document.createElement('div')
  panel.className = 'yrpanel'
  panel.hidden = true
  root.append(head, gridHost, panel)

  function setHint(m: PlanMode): void {
    if (m === null) {
      hint.textContent = 'Click a colour, drag days.'
    } else if (m.kind === 'erase') {
      hint.textContent = 'Click a run to erase it. Esc to stop.'
    } else {
      const label = allCategories().find(c => c.name === m.cat)?.label ?? m.cat
      hint.textContent = `Drag to paint ${label}. Esc to stop.`
    }
  }
  setHint(null)
  /** Day the panel currently shows; null when hidden. */
  let shown: DayNumber | null = null

  const yearBounds = (): Run => ({ start: civilToDay(year, 1, 1), end: civilToDay(year, 12, 31) })
  /** Every event of the displayed year, months concatenated. A boundary
   *  crosser appears twice; plan.ts's counts are distinct-day sets, so that
   *  is harmless and no dedupe is done here (documented on daysUsed). */
  function eventsIn(run: Run): CalendarEvent[] {
    const out: CalendarEvent[] = []
    let key: MonthKey | null = null
    for (let d = run.start; d <= run.end; d = asDay(d + 1)) {
      const k = monthKey(d)
      if (k === key) continue
      key = k
      out.push(...eventsForMonth(k))
    }
    return out
  }

  const planner = mountPlanner({
    root,
    surface: gridHost,
    cellAt: (x, y) => document.elementFromPoint(x, y)?.closest('.yrcell[data-day]') ?? null,
    cellsIn: run => {
      const out: Element[] = []
      for (let d = run.start; d <= run.end; d = asDay(d + 1)) {
        const c = cellFor(d)
        if (c !== null) out.push(c)
      }
      return out
    },
    dayOf: cell => {
      const d = (cell as HTMLElement).dataset['day']
      return d === undefined ? null : asDay(Number(d))
    },
    laneZeroId: cell => (cell as HTMLElement).dataset['lane0'] ?? null,
    eventsIn,
    bounds: yearBounds,
    createEvent,
    deleteEvent,
    toast: m => host.toast(m),
    onModeChange: m => {
      hidePanel()          // suppressed for the whole mode: it would flicker under a drag (SPEC)
      syncChips(m)
      setHint(m)
    },
  })

  function syncChips(m: PlanMode): void {
    for (const chip of strip.querySelectorAll<HTMLElement>('.planchip')) {
      const on = m !== null && (m.kind === 'erase'
        ? chip.dataset['erase'] !== undefined
        : chip.dataset['cat'] === m.cat)
      chip.setAttribute('aria-pressed', String(on))
    }
  }

  /** One chip per category plus Erase; figures from daysUsed over the displayed
   *  year (SPEC "The plan strip"). Rebuilt on every build() — 365 days × 11
   *  categories is cheap — and BEFORE build()'s width guard, so a budget set
   *  in Settings while the year view is hidden still lands on the next show. */
  function buildStrip(): void {
    const b = yearBounds()
    const events = eventsIn(b)
    const frag = document.createDocumentFragment()
    const cats = allCategories()
    for (const c of cats) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'planchip'
      chip.dataset['cat'] = c.name
      chip.setAttribute('aria-pressed', 'false')
      const dot = document.createElement('span'); dot.className = 'planchip-dot'
      const lbl = document.createElement('span'); lbl.className = 'planchip-lbl'; lbl.textContent = c.label
      chip.append(dot, lbl)
      const used = daysUsed(events, c.name, b.start, b.end)
      // Budgeted: "used / budget". Otherwise the count alone, omitted at zero
      // so a fresh install is not a row of zeros (ruling, iteration A).
      if (c.budgetDays !== undefined || used > 0) {
        const fig = document.createElement('span')
        fig.className = 'planchip-fig'
        fig.textContent = c.budgetDays === undefined ? String(used) : `${used} / ${c.budgetDays}`
        // Over budget: --ink-strong at 620 and nothing else (SPEC).
        if (c.budgetDays !== undefined && used > c.budgetDays) fig.dataset['over'] = ''
        chip.append(fig)
      }
      chip.addEventListener('click', () => planner.toggle({ kind: 'paint', cat: c.name }))
      frag.append(chip)
    }
    const erase = document.createElement('button')
    erase.type = 'button'
    erase.className = 'planchip'
    erase.dataset['erase'] = ''
    erase.setAttribute('aria-pressed', 'false')
    const elbl = document.createElement('span'); elbl.className = 'planchip-lbl'; elbl.textContent = 'Erase'
    erase.append(elbl)
    erase.addEventListener('click', () => planner.toggle({ kind: 'erase' }))
    frag.append(erase)
    strip.replaceChildren(frag)
    // A category deleted in Settings while it was the paint chip: exit rather
    // than paint with a name nothing resolves.
    const m = planner.mode()
    if (m?.kind === 'paint' && !cats.some(c => c.name === m.cat)) planner.exit()
    syncChips(planner.mode())
  }

  function build(): void {
    buildStrip()
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

      const items: { from: number; to: number; id: string; cat: string; allDay: boolean }[] = []
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
          items.push({ from: i, to: trackOfDay.get(endDay) ?? i, id: ev.id, cat: ev.category, allDay: ev.allDay })
        }
      })

      // Computed once, here, and never transitioned: interpolating
      // grid-template-columns is the recorded KNOWN LIMITATION (SPEC "Scroll
      // engine API"), which is why the stretch is static and hover feedback is
      // the compositor-only lift instead.
      // 2.2fr at 28 columns; 1.35fr at 14 — measured on a 375px device, where
      // a busy row at 2.2fr crushed its plain days (SPEC "Planning layer",
      // retuned 2026-09-05). Still off at 7.
      const STRETCH = wide ? '2.2fr' : '1.35fr'
      row.style.setProperty('--yr-cols', rowCells.map(el =>
        el.classList.contains('yrspine') ? SPINE_W
          : stretchOn && el.dataset['hasEv'] !== undefined ? STRETCH
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
      // Erase's target per cell: the lowest-lane ALL-DAY bar among the drawn
      // lanes (SPEC "Erase": "the ONE all-day event under it"; a timed event
      // can hold lane 0 in this grid, and erase does not touch those).
      const laneOf = new Map<HTMLElement, number>()
      for (const it of assignLanes(items)) {
        if (it.lane >= MAX_LANES) continue
        if (it.allDay) {
          for (let i = it.from; i <= it.to; i++) {
            const c = rowCells[i]
            if (c === undefined || c.dataset['day'] === undefined) continue
            const have = laneOf.get(c)
            if (have !== undefined && have <= it.lane) continue
            laneOf.set(c, it.lane)
            c.dataset['lane0'] = it.id
          }
        }
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
    if (coarse()) {
      const open = document.createElement('div')
      open.className = 'yrpanel-open'
      open.textContent = 'Tap again to open'
      frag.append(open)
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
    if (planner.mode() !== null) return    // paint/erase: no panel under a drag (SPEC)
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
    // In a mode the pointer sequence owns the cell; the strip's chips have
    // their own listeners and their clicks land here afterwards.
    if (planner.mode() !== null) return
    // Touch: the panel is tappable and opens the shown day — the same as the
    // second tap on the cell (SPEC, amended 2026-09-05). Under hover it is
    // pointer-events: none and this branch is unreachable.
    if (panel.contains(e.target as Node)) {
      if (shown !== null) host.onPickDay(shown)
      return
    }
    const hit = cellOf(e)
    if (hit === null) { hidePanel(); return }
    if (coarse() && shown !== hit.day) { showPanel(hit.cell, hit.day); return }
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
    exitMode() { planner.exit() },
    destroy() {
      planner.destroy()
      root.removeEventListener('click', onClick)
      root.removeEventListener('pointerover', onOver)
      root.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('resize', build)
      root.replaceChildren()
    },
  }
}
