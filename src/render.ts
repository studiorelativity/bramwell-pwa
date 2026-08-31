// STAGE 03 — week rows, bars, chips, lane packing, month badges, header. Sets data-cat and nothing else per frame.
import type { EventSpan, WeekIndex, DayOffset } from './types.ts'
import { dayAt, today } from './state.ts'
import { asOffset, dayToCivil } from './dates.ts'
/** EventSpan with the lane render.ts assigned. Not persisted, not exported beyond render.ts's consumers. */
export type PackedSpan = EventSpan & { lane: number }

/** Longest-first first-fit over any column range. Shared by the week rows
 *  and the year grid so a multi-day event holds ONE lane across a row in
 *  both. The id tie-break is load-bearing: without it a repaint can
 *  reshuffle lanes under the user.
 *
 *  Per-lane interval lists: an item goes in the lowest lane whose existing
 *  intervals it genuinely does not overlap. Longest-first only orders
 *  placement; overlap is decided by true interval intersection, not by
 *  tracking each lane's rightmost occupied column — that heuristic assumes
 *  items arrive left to right, which longest-first does not guarantee (a
 *  later, earlier-starting, non-overlapping item could get shoved into a
 *  wasted lane). */
export function assignLanes<T extends { from: number; to: number; id: string }>(items: T[]): (T & { lane: number })[] {
  const sorted = [...items].sort((a, b) =>
    (b.to - b.from) - (a.to - a.from) ||
    a.from - b.from ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const lanes: { from: number; to: number }[][] = []
  const out: (T & { lane: number })[] = []
  for (const it of sorted) {
    let lane = 0
    while (lane < lanes.length && lanes[lane]!.some(iv => it.from <= iv.to && it.to >= iv.from)) lane++
    if (lane === lanes.length) lanes.push([])
    lanes[lane]!.push({ from: it.from, to: it.to })
    out.push({ ...it, lane })
  }
  return out
}

/** Bars are all-day only — timed events render as chips (DECISIONS "In force — scroll and render"). */
export function packLanes(spans: EventSpan[]): PackedSpan[] {
  const bars = spans.filter(s => s.event.allDay)
    .map(s => ({ span: s, from: s.from as number, to: s.to as number, id: s.event.id }))
  return assignLanes(bars).map(x => ({ ...x.span, lane: x.lane }))
}

/** SPEC "Inline day expansion": the phone rule is ≤560px. */
export const PHONE_MAX_W = 560
/** Desktop: the open day takes three tracks to a neighbour's one. */
export const EXPAND_FR = 3

/** The expanded row's column template. `full` is the phone rule: neighbours go to
 *  `0fr` and the picked day takes the whole row — the same mechanism as the
 *  desktop `3fr`, not a second shell (DECISIONS "Stage 04 rulings"). Always seven
 *  tracks, because the bar overlay is set from the same string.
 *
 *  Every track is `minmax(0, Nfr)`, never a bare `Nfr` (round 4 review): a bare
 *  `<flex>` track's MIN sizing function is `auto`, which floors it at its
 *  content's automatic minimum size — a neighbour's `0fr` track still held its
 *  populated `.day` cell's own minimum, so "collapsed" was never actually 0px
 *  (measured ~12px on phone), and `.bars`'s inherited copy, resolving the same
 *  0fr against an EMPTY track with nothing to floor it, genuinely hit 0 — the
 *  two grids disagreeing, and the phone rule (picked day takes the WHOLE row)
 *  not actually being delivered. `minmax(0, Nfr)` fixes the minimum at a literal
 *  0 regardless of content, so both grids collapse a neighbour to nothing.
 *  Uniform `minmax(0, …)` on every track, and matched by `.week`'s resting CSS
 *  rule in style.css, is what keeps `grid-template-columns` interpolable: the
 *  transition only carries a track's numeric value across if the two states'
 *  track sizing FUNCTIONS match — mixing bare `<flex>` and `minmax()` (or
 *  resting-vs-generated forms) would trade this bug for a snap. */
export function columnsFor(offset: DayOffset, full: boolean): string {
  return Array.from({ length: 7 }, (_, i) =>
    `minmax(0, ${i === offset ? (full ? '1' : String(EXPAND_FR)) : (full ? '0' : '1')}fr)`).join(' ')
}

const BAR_H = 20        // must match --bar height + gap in style.css
const HEAD_H = 20       // day-number band at the top of a tile
const FOOT_H = 16       // the "+N" line

function capacityFor(rowH: number): number {
  return Math.max(0, Math.floor((rowH - HEAD_H - FOOT_H) / BAR_H))
}

export type DayVisibility = { visibleBars: number; hiddenBars: number; chipsShown: number; overflow: number }

/** Pure per-day accounting of what a row can actually show, given the bars
 *  `packLanes` already placed and how many timed chips start on each day.
 *  Exported so the selftest pins this exact arithmetic under bare node
 *  rather than a copy of it — `renderWeek` calls this same function, it
 *  does not re-derive the numbers. Always returns exactly seven entries,
 *  one per day offset 0..6.
 *
 *  A bar is HIDDEN, not skipped silently, when its lane is at or beyond
 *  `cap` — it still has to land in `overflow` so "+N" can report it.
 *  Nothing is suppressed without being counted. */
export function visibilityFor(packed: PackedSpan[], chipCounts: number[], cap: number): DayVisibility[] {
  const visibleBars: number[] = [0, 0, 0, 0, 0, 0, 0]
  const hiddenBars: number[] = [0, 0, 0, 0, 0, 0, 0]
  for (const p of packed) {
    const bucket = p.lane < cap ? visibleBars : hiddenBars
    for (let o = p.from; o <= p.to; o++) bucket[o] = (bucket[o] ?? 0) + 1
  }
  return visibleBars.map((v, o) => {
    const h = hiddenBars[o] ?? 0
    const chips = chipCounts[o] ?? 0
    const chipsShown = Math.min(chips, Math.max(0, cap - v))
    return { visibleBars: v, hiddenBars: h, chipsShown, overflow: h + (chips - chipsShown) }
  })
}

/** Fills a RECYCLED node; never creates one. Sets data-cat and nothing else
 *  per frame — all colour comes from categories.themeCss(). */
export function renderWeek(node: HTMLElement, week: WeekIndex, spans: EventSpan[], rowH: number): void {
  const t = today()
  const cap = capacityFor(rowH)
  const packed = packLanes(spans)

  const chips: EventSpan[][] = [[], [], [], [], [], [], []]
  for (const s of spans) if (!s.event.allDay) chips[s.from]!.push(s)
  for (const list of chips) list.sort((a, b) => (a.event.startMin ?? 0) - (b.event.startMin ?? 0))
  const visibility = visibilityFor(packed, chips.map(list => list.length), cap)

  node.replaceChildren()
  let firstOfMonth = -1
  let firstOfMonthNum = 0

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
      firstOfMonthNum = m
      // No `.badge` on the cell: the month band below names the month, and
      // printing it twice on the 1st is the duplicate rendering CONVENTIONS'
      // stand-down rule exists to stop — the same call the year grid made.
      // SPEC "Layout details" exempts both views from the shared badge now.
    }

    const chipList = chips[o] ?? []
    const { chipsShown: shown, overflow } = visibility[o] ?? { visibleBars: 0, hiddenBars: 0, chipsShown: 0, overflow: 0 }
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

    // overflow comes straight from visibilityFor: nothing is suppressed
    // without being counted.
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
    // The month band: the year view's spine, laid horizontally because this
    // view runs vertically. Still absolutely positioned inside the week row,
    // exactly as the hairline it replaces was — it costs no layout height and
    // the virtualizer never learns it exists, so uniform row maths and the one
    // variable-height row are untouched.
    const rule = document.createElement('div')
    rule.className = 'rule'
    rule.style.left = `calc(${firstOfMonth} * (100% / 7))`
    rule.style.right = '0'
    const name = document.createElement('span')
    name.className = 'rule-m'
    name.textContent = new Date(Date.UTC(2000, firstOfMonthNum - 1, 1))
      .toLocaleString(undefined, { month: 'long', timeZone: 'UTC' })
    rule.append(name)
    node.append(rule)
  }
}

/** Pure: "Aug – Sep 2026" when the view straddles, which at rest it does (DECISIONS).
 *  Three shapes: same month, same year with month boundary, cross-year boundary. */
export function rangeLabel(firstWeek: WeekIndex, lastWeek: WeekIndex): string {
  const a = dayToCivil(dayAt(firstWeek, asOffset(0)))
  const b = dayToCivil(dayAt(lastWeek, asOffset(6)))
  const name = (m: number) => new Date(Date.UTC(2000, m - 1, 1)).toLocaleString(undefined, { month: 'short', timeZone: 'UTC' })
  return a.y === b.y
    ? (a.m === b.m ? `${name(a.m)} ${a.y}` : `${name(a.m)} – ${name(b.m)} ${a.y}`)
    : `${name(a.m)} ${a.y} – ${name(b.m)} ${b.y}`
}

/** Only the label's text changes per dock; the buttons are built once by main.ts. */
export function renderRange(node: HTMLElement, firstWeek: WeekIndex, lastWeek: WeekIndex): void {
  const next = rangeLabel(firstWeek, lastWeek)
  if (node.textContent === next) return          // no cross-fade when nothing changed
  node.classList.add('enter')                    // ensure .enter is present
  node.removeAttribute('data-in')                // snap to hidden with no animation
  void node.offsetWidth                          // commit the snap
  node.textContent = next                        // swap text while invisible
  node.dataset['in'] = ''                        // animate from 0 to 1
}
