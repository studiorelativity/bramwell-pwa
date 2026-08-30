// STAGE 03 — week rows, bars, chips, lane packing, month badges, header. Sets data-cat and nothing else per frame.
import type { EventSpan, WeekIndex } from './types.ts'
import { dayAt, today } from './state.ts'
import { asOffset, dayToCivil } from './dates.ts'
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
  // Per-lane interval lists: a span goes in the lowest lane whose existing
  // intervals it genuinely does not overlap. Longest-first only orders
  // placement; overlap is decided by true interval intersection, not by
  // tracking each lane's rightmost occupied offset — that heuristic assumes
  // spans arrive left to right, which longest-first does not guarantee (a
  // later, earlier-starting, non-overlapping span could get shoved into a
  // wasted lane).
  const lanes: { from: number; to: number }[][] = []
  const out: PackedSpan[] = []
  for (const s of bars) {
    let lane = 0
    while (lane < lanes.length && lanes[lane]!.some(iv => s.from <= iv.to && s.to >= iv.from)) lane++
    if (lane === lanes.length) lanes.push([])
    lanes[lane]!.push({ from: s.from, to: s.to })
    out.push({ ...s, lane })
  }
  return out
}

const WDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const BAR_H = 20        // must match --bar height + gap in style.css
const HEAD_H = 20       // day-number band at the top of a tile
const FOOT_H = 16       // the "+N" line

function capacityFor(rowH: number): number {
  return Math.max(0, Math.floor((rowH - HEAD_H - FOOT_H) / BAR_H))
}

/** Fills a RECYCLED node; never creates one. Sets data-cat and nothing else
 *  per frame — all colour comes from categories.themeCss(). */
export function renderWeek(node: HTMLElement, week: WeekIndex, spans: EventSpan[], rowH: number): void {
  const t = today()
  const cap = capacityFor(rowH)
  const packed = packLanes(spans)

  // Per-day visible/hidden bar counts collected DURING packing, not by a
  // per-cell lookup afterwards (~98 redundant scans per repaint otherwise —
  // DECISIONS). A bar at or beyond capacity is HIDDEN, not skipped silently
  // — it still has to land in a count so "+N" can report it.
  const visibleBars: number[] = [0, 0, 0, 0, 0, 0, 0]
  const hiddenBars: number[] = [0, 0, 0, 0, 0, 0, 0]
  for (const p of packed) {
    const bucket = p.lane < cap ? visibleBars : hiddenBars
    for (let o = p.from; o <= p.to; o++) bucket[o] = (bucket[o] ?? 0) + 1
  }
  const chips: EventSpan[][] = [[], [], [], [], [], [], []]
  for (const s of spans) if (!s.event.allDay) chips[s.from]!.push(s)
  for (const list of chips) list.sort((a, b) => (a.event.startMin ?? 0) - (b.event.startMin ?? 0))

  node.replaceChildren()
  let firstOfMonth = -1

  for (let o = 0; o < 7; o++) {
    const day = dayAt(week, asOffset(o))
    const { m, d } = dayToCivil(day)
    const cell = document.createElement('div')
    cell.className = 'day'
    cell.dataset['band'] = m % 2 === 0 ? 'a' : 'b'
    if (o >= 5) cell.dataset['weekend'] = ''
    if (day === t) cell.dataset['today'] = ''
    cell.dataset['day'] = String(day)

    const num = document.createElement('span')
    num.className = 'daynum'
    num.textContent = String(d)
    cell.append(num)

    if (d === 1) {
      firstOfMonth = o
      const badge = document.createElement('span')
      badge.className = 'badge'
      badge.textContent = new Date(Date.UTC(2000, m - 1, 1)).toLocaleString(undefined, { month: 'short', timeZone: 'UTC' })
      cell.append(badge)
    }

    const chipList = chips[o] ?? []
    const room = Math.max(0, cap - (visibleBars[o] ?? 0))
    const shown = Math.min(chipList.length, room)
    if (shown > 0) {
      const box = document.createElement('div')
      box.className = 'chips'
      for (const s of chipList.slice(0, shown)) {
        const chip = document.createElement('div')
        chip.className = 'chip'
        chip.dataset['cat'] = s.event.category
        const dot = document.createElement('span'); dot.className = 'dot'
        const at = document.createElement('span'); at.className = 'at'
        const min = s.event.startMin ?? 0
        at.textContent = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
        const ttl = document.createElement('span'); ttl.className = 'ttl'
        ttl.textContent = s.event.title            // text nodes are not flex items (DECISIONS)
        chip.append(dot, at, ttl)
        box.append(chip)
      }
      cell.append(box)
    }

    // Nothing is suppressed without being counted: every bar hidden above
    // and every chip cut off by room here lands in this total.
    const overflow = (hiddenBars[o] ?? 0) + (chipList.length - shown)
    if (overflow > 0) {
      const more = document.createElement('span')
      more.className = 'more'
      more.textContent = `+${overflow}`
      cell.append(more)
    }
    node.append(cell)
  }

  const layer = document.createElement('div')
  layer.className = 'bars'
  for (const p of packed) {
    if (p.lane >= cap) continue          // counted in "+N" above
    const bar = document.createElement('div')
    bar.className = 'bar'
    bar.dataset['cat'] = p.event.category
    bar.style.gridColumn = `${p.from + 1} / ${p.to + 2}`
    bar.style.setProperty('--lane', String(p.lane))
    if (p.continuesBefore) bar.dataset['contBefore'] = ''
    if (p.continuesAfter) bar.dataset['contAfter'] = ''
    // Title once, on the true start; continuations carry none.
    if (!p.continuesBefore) bar.textContent = p.event.title
    layer.append(bar)
  }
  node.append(layer)

  if (firstOfMonth >= 0) {
    const rule = document.createElement('div')
    rule.className = 'rule'
    rule.style.left = `calc(${firstOfMonth} * (100% / 7))`
    rule.style.right = '0'
    node.append(rule)
  }
  void WDAY   // used by year.ts in Task 9
}
