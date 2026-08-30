// STAGE 04 — inline day expansion content: event list, form, habits, journal.
// NEVER imports gcal.ts: writes go UI -> state.ts -> gcal.ts (SPEC "Write orchestration").
// No DOM at module scope — this module is in the selftest graph, which runs under bare node.
import type { CalendarEvent, DayNumber } from './types.ts'
import { dayToCivil, monthKey } from './dates.ts'
import * as state from './state.ts'
import { all as allCategories } from './categories.ts'

export type DayHost = {
  toast(message: string): void
  /** The panel's natural height may have changed: remeasure and re-set the delta. */
  onHeightChange(): void
  /** The form just closed, so a background repaint held while typing may now run. */
  onFormClosed(): void
}

let host: DayHost = { toast: () => {}, onHeightChange: () => {}, onFormClosed: () => {} }
export function configure(h: DayHost): void { host = h }

/** ONE panel node, moved between cells. A refill or a resize re-attaches the SAME
 *  DOM, which is what makes the transient-UI rule structural rather than remembered
 *  (CONVENTIONS): typed text cannot be wiped by anything but an explicit rebuild. */
let panel: HTMLElement | null = null
let shown: DayNumber | null = null
let list: HTMLElement | null = null

function el(tag: string, className: string, text?: string): HTMLElement {
  const n = document.createElement(tag)
  n.className = className
  if (text !== undefined) n.textContent = text
  return n
}

/** Staggered entry: --i is a plain integer, the 40ms cadence is a token in motion.css. */
function staggered(node: HTMLElement, i: number): HTMLElement {
  node.classList.add('enter')
  node.style.setProperty('--i', String(i))
  return node
}

function build(): HTMLElement {
  const p = el('div', 'dp')
  // scroll.ts captures the pointer on every pointerdown in the scroller, which
  // retargets the compat click and would break every control in here. One stop
  // fixes it without scroll.ts learning what a day panel is.
  p.addEventListener('pointerdown', e => e.stopPropagation())
  p.append(staggered(el('div', 'dp-head'), 0))
  // The panel's identity never changes after this point (a single node moved
  // between cells, not rebuilt), so `list` is captured once, here, rather
  // than re-queried on every expand().
  list = staggered(el('div', 'dp-list'), 1)
  p.append(list)
  const habits = el('div', 'dp-slot')          // stage 07 fills this
  habits.dataset['slot'] = 'habits'
  habits.hidden = true
  const journal = el('div', 'dp-slot')         // stage 08 fills this
  journal.dataset['slot'] = 'journal'
  journal.hidden = true
  p.append(habits, journal)
  const add = staggered(el('button', 'dp-add', '+ Add'), 2)
  add.addEventListener('click', () => { if (shown !== null) openForm(shown, null) })
  p.append(add)
  return p
}

function labelFor(name: string): string {
  return allCategories().find(c => c.name === name)?.label ?? name
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

/** Every event touching `d`, all-day first, then timed by start (SPEC "Inline day expansion"). */
function eventsOn(d: DayNumber): CalendarEvent[] {
  const out = state.eventsForMonth(monthKey(d)).filter(ev => {
    const end = ev.allDay ? ev.end : ev.start
    return ev.start <= d && end >= d
  })
  return out.sort((a, b) =>
    Number(b.allDay) - Number(a.allDay) ||
    (a.allDay ? 0 : a.startMin - (b.allDay ? 0 : b.startMin)) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function renderList(): void {
  if (list === null || shown === null) return
  const events = eventsOn(shown)
  list.replaceChildren()
  if (events.length === 0) {
    list.append(el('p', 'dp-none', 'Nothing on this day.'))
    return
  }
  for (const ev of events) {
    const row = el('button', 'dp-ev')
    row.dataset['cat'] = ev.category
    row.dataset['id'] = ev.id
    row.append(el('span', 'dp-at', ev.allDay ? 'All day' : hhmm(ev.startMin)))
    row.append(el('span', 'dp-ttl', ev.title))
    // The category LABEL, never its name (SPEC "Event form").
    row.append(el('span', 'dp-cat', labelFor(ev.category)))
    row.addEventListener('click', () => { if (shown !== null) openForm(shown, ev) })
    list.append(row)
  }
}

/** Rebuild the list. NO-OP while the form is open: a background refresh must never
 *  wipe text being typed (CONVENTIONS transient-UI rule). This is the inner,
 *  structural half of that rule; main.ts holds the repaint as the outer half. */
export function refresh(): void {
  if (isFormOpen()) return
  renderList()
  host.onHeightChange()
}

/** Attach the panel to `into` and show `d`. Called from main.ts's fillRow seam on
 *  every refill of the open row, so it must be idempotent. */
export function expand(d: DayNumber, into: HTMLElement): void {
  if (panel === null) panel = build()
  const dayChanged = shown !== d
  shown = d
  if (panel.parentElement !== into) into.append(panel)
  if (dayChanged) dropForm()
  const { y, m, d: dd } = dayToCivil(d)
  const head = panel.querySelector('.dp-head')
  if (head !== null) {
    head.textContent = new Date(Date.UTC(y, m - 1, dd))
      .toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  }
  refresh()
  for (const n of panel.querySelectorAll<HTMLElement>('.enter')) {
    n.removeAttribute('data-out')
    n.dataset['in'] = ''
  }
}

/** Fade the content out. The panel stays in the DOM, clipped by the shrinking cell,
 *  until detach() — so there is nothing to see when the row reaches its rest height. */
export function beginCollapse(): void {
  if (panel === null) return
  for (const n of panel.querySelectorAll<HTMLElement>('.enter')) {
    n.removeAttribute('data-in')
    n.dataset['out'] = ''
  }
}

export function detach(): void {
  dropForm()
  panel?.remove()
  shown = null
}

/** Panel height measured from the cell's top edge, including the panel's own bottom
 *  padding. main.ts turns this into the delta with scroll's rowHeight(). */
export function contentHeight(): number {
  if (panel === null || panel.parentElement === null) return 0
  return panel.offsetTop + panel.offsetHeight
}

// --- replaced in Task 7 ---
export function isFormOpen(): boolean { return false }
function openForm(_d: DayNumber, _ev: CalendarEvent | null): void {}
function dropForm(): void {}
// BRIEF DEFECT (found, worked around): Step 4's Escape handler in main.ts calls
// day.closeForm(), but the brief's placeholder list for this task omits it —
// only isFormOpen/openForm/dropForm are listed. Since main.ts does `import *
// as day`, an unexported member is a TS2339 build error, not a runtime one,
// even though isFormOpen() always returning false makes the call dead code
// this task. Added here under the same "keep the build green" rationale as
// the other three; Task 7 replaces this too.
export function closeForm(): void {}
