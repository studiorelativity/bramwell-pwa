// STAGE 04 — inline day expansion content: event list, form, habits, journal.
// NEVER imports gcal.ts: writes go UI -> state.ts -> gcal.ts (SPEC "Write orchestration").
// No DOM at module scope — this module is in the selftest graph, which runs under bare node.
import type { CalendarEvent, DayNumber, EventDraft, RepeatRule, WriteScope } from './types.ts'
import { civilToDay, dayToCivil, monthKey } from './dates.ts'
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

/** Pure, and exported so the selftest pins the exact rules the form runs rather
 *  than a copy of them (CONVENTIONS). Returns the message to show, or null. */
export function validate(d: EventDraft): string | null {
  if (d.title.trim() === '') return 'A title is required.'
  if (d.end < d.start) return 'The end date is before the start date.'
  if (d.allDay) return null
  const s = d.startMin ?? 0
  const e = d.endMin ?? 0
  if (s < 0 || s > 1439 || e < 0 || e > 1439) return 'Times must be between 00:00 and 23:59.'
  // Only a same-day event constrains the clock: crossing midnight legitimately runs backwards.
  if (d.end === d.start && e <= s) return 'The end time is not after the start time.'
  return null
}

// ---------- the form ----------

let form: HTMLFormElement | null = null
/** The event being edited; null means a new event. */
let editing: CalendarEvent | null = null
let picked = ''

export function isFormOpen(): boolean { return form !== null && form.isConnected }

const ymd = (d: DayNumber): string => {
  const { y, m, d: dd } = dayToCivil(d)
  return `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}
const parseYmd = (v: string): DayNumber | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  return m === null ? null : civilToDay(Number(m[1]), Number(m[2]), Number(m[3]))
}
const parseHm = (v: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(v)
  return m === null ? null : Number(m[1]) * 60 + Number(m[2])
}

function field<T extends HTMLElement>(sel: string): T | null {
  return form?.querySelector<T>(sel) ?? null
}

function buildForm(d: DayNumber, ev: CalendarEvent | null): HTMLFormElement {
  const f = document.createElement('form')
  f.className = 'dp-form'
  f.addEventListener('submit', e => { e.preventDefault(); void save() })

  const title = document.createElement('input')
  title.className = 'dp-title'
  title.placeholder = 'Title'
  title.value = ev?.title ?? ''
  f.append(title)

  // Category chips carry the user's LABELS, never the stable names (SPEC "Event form").
  const cats = el('div', 'dp-cats')
  picked = ev?.category ?? (allCategories()[0]?.name ?? '')
  for (const c of allCategories()) {
    const chip = el('button', 'dp-chip', c.label) as HTMLButtonElement
    chip.type = 'button'
    chip.dataset['cat'] = c.name
    chip.setAttribute('aria-pressed', String(c.name === picked))
    chip.addEventListener('click', () => {
      picked = c.name
      for (const other of cats.querySelectorAll('.dp-chip')) {
        other.setAttribute('aria-pressed', String(other === chip))
      }
    })
    cats.append(chip)
  }
  f.append(cats)

  const allDayLine = el('label', 'dp-line')
  const allDay = document.createElement('input')
  allDay.type = 'checkbox'
  allDay.className = 'dp-allday'
  allDay.checked = ev?.allDay ?? false
  allDayLine.append(allDay, document.createTextNode('All day'))
  f.append(allDayLine)

  const when = el('div', 'dp-when')
  const start = document.createElement('input'); start.type = 'date'; start.className = 'dp-start'
  const startT = document.createElement('input'); startT.type = 'time'; startT.className = 'dp-startt'
  const end = document.createElement('input'); end.type = 'date'; end.className = 'dp-end'
  const endT = document.createElement('input'); endT.type = 'time'; endT.className = 'dp-endt'
  start.value = ymd(ev?.start ?? d)
  end.value = ymd(ev?.end ?? d)
  startT.value = hhmm(ev !== null && !ev.allDay ? ev.startMin : 9 * 60)
  endT.value = hhmm(ev !== null && !ev.allDay ? ev.endMin : 10 * 60)
  when.append(start, startT, end, endT)
  f.append(when)
  // All-day keeps the times in the DOM so toggling back does not lose them
  // (types.ts: EventDraft is deliberately flat for exactly this).
  const syncAllDay = (): void => { startT.hidden = allDay.checked; endT.hidden = allDay.checked }
  allDay.addEventListener('change', syncAllDay)
  syncAllDay()

  const repeat = document.createElement('select')
  repeat.className = 'dp-repeat'
  for (const [value, text] of [['none', 'Does not repeat'], ['daily', 'Daily'], ['weekly', 'Weekly'],
    ['monthly', 'Monthly'], ['yearly', 'Yearly']]) {
    const o = document.createElement('option')
    o.value = value!; o.textContent = text!
    repeat.append(o)
  }
  // Disabled when editing: Google rejects an RRULE PATCHed against an instance id
  // (DECISIONS "In force — auth and wire").
  repeat.disabled = ev !== null
  f.append(repeat)

  const notes = document.createElement('textarea')
  notes.className = 'dp-notes'
  notes.placeholder = 'Notes'
  notes.value = ev?.notes ?? ''
  f.append(notes)

  // Scope picker ONLY for a recurring event; default "this occurrence" (SPEC).
  if (ev?.recurringEventId !== undefined) {
    const scope = el('div', 'dp-scope')
    for (const [value, text] of [['instance', 'This occurrence'], ['series', 'Whole series']]) {
      const line = el('label', 'dp-line')
      const radio = document.createElement('input')
      radio.type = 'radio'; radio.name = 'dp-scope'; radio.value = value!
      radio.checked = value === 'instance'
      radio.addEventListener('change', resetDeleteConfirm)
      line.append(radio, document.createTextNode(text!))
      scope.append(line)
    }
    f.append(scope)
  }

  const err = el('p', 'dp-err')
  err.hidden = true
  f.append(err)

  const actions = el('div', 'dp-actions')
  const save_ = el('button', 'dp-save', 'Save') as HTMLButtonElement
  save_.type = 'submit'
  const cancel = el('button', 'dp-cancel', 'Cancel') as HTMLButtonElement
  cancel.type = 'button'
  cancel.addEventListener('click', () => closeForm())
  actions.append(save_, cancel)
  if (ev !== null) {
    const del = el('button', 'dp-del', 'Delete') as HTMLButtonElement
    del.type = 'button'
    del.addEventListener('click', () => { void remove() })
    actions.append(del)
  }
  f.append(actions)
  return f
}

function scopeValue(): WriteScope {
  return field<HTMLInputElement>('input[name="dp-scope"][value="series"]')?.checked === true
    ? 'series' : 'instance'
}

function resetDeleteConfirm(): void {
  const del = field<HTMLButtonElement>('.dp-del')
  if (del === null) return
  del.removeAttribute('data-confirm')
  del.textContent = 'Delete'
}

function readDraft(): EventDraft {
  const allDay = field<HTMLInputElement>('.dp-allday')?.checked ?? false
  // `shown` is never null while a form is open; today() is a fallback that keeps
  // the function total rather than a case that happens.
  const start = parseYmd(field<HTMLInputElement>('.dp-start')?.value ?? '') ?? shown ?? state.today()
  const end = parseYmd(field<HTMLInputElement>('.dp-end')?.value ?? '') ?? start
  const draft: EventDraft = {
    title: field<HTMLInputElement>('.dp-title')?.value ?? '',
    category: picked,
    allDay,
    start,
    end,
    repeat: (field<HTMLSelectElement>('.dp-repeat')?.value ?? 'none') as RepeatRule,
  }
  const notes = field<HTMLTextAreaElement>('.dp-notes')?.value ?? ''
  if (notes !== '') draft.notes = notes
  if (!allDay) {
    draft.startMin = parseHm(field<HTMLInputElement>('.dp-startt')?.value ?? '') ?? 0
    draft.endMin = parseHm(field<HTMLInputElement>('.dp-endt')?.value ?? '') ?? 0
  }
  return draft
}

function showError(message: string | null): void {
  const err = field<HTMLElement>('.dp-err')
  if (err === null) return
  err.textContent = message ?? ''
  err.hidden = message === null
}

function busy(on: boolean): void {
  if (form === null) return
  if (on) { form.dataset['busy'] = '' } else { form.removeAttribute('data-busy') }
}

/** day.ts never imports gcal.ts, so an error is read as an Error, not as a GcalError. */
function messageFor(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.startsWith('Google Calendar API 401') ? 'Google rejected the session. Reconnect and try again.'
    : raw.startsWith('Google Calendar API') ? `${raw} — the change was not saved.`
    : raw
}

async function save(): Promise<void> {
  const draft = readDraft()
  const bad = validate(draft)
  if (bad !== null) { showError(bad); return }
  showError(null)
  busy(true)
  try {
    if (editing === null) { await state.createEvent(draft) }
    else { await state.updateEvent(editing.id, draft, scopeValue()) }
    closeForm()
  } catch (e) {
    // Both surfaces, every time (SPEC "Event form").
    const msg = messageFor(e)
    showError(msg)
    host.toast(msg)
  } finally { busy(false) }
}

async function remove(): Promise<void> {
  if (editing === null) return
  const scope = scopeValue()
  const del = field<HTMLButtonElement>('.dp-del')
  // A series delete confirms first (SPEC). Two-step inline, never confirm() —
  // a modal for this was rejected at stage 08 of v3 (DECISIONS "Rejected").
  if (scope === 'series' && del !== null && del.dataset['confirm'] === undefined) {
    del.dataset['confirm'] = ''
    del.textContent = 'Delete every occurrence?'
    host.onHeightChange()
    return
  }
  busy(true)
  try {
    await state.deleteEvent(editing.id, scope)
    closeForm()
  } catch (e) {
    const msg = messageFor(e)
    showError(msg)
    host.toast(msg)
  } finally { busy(false) }
}

function openForm(d: DayNumber, ev: CalendarEvent | null): void {
  if (panel === null) return
  dropForm()
  editing = ev
  form = buildForm(d, ev)
  form.classList.add('enter')
  form.style.setProperty('--i', '0')
  panel.append(form)
  void form.offsetWidth                     // commit the hidden state before entering
  form.dataset['in'] = ''
  host.onHeightChange()
  field<HTMLInputElement>('.dp-title')?.focus()
}

/** Silent teardown, used when the form is being replaced or the panel is going away. */
function dropForm(): void {
  form?.remove()
  form = null
  editing = null
}

/** The public close: the DAY stays open and the list repaints, because after
 *  saving an event the thing you want to see is the day you just changed.
 *  Releasing the held background repaint is the last step, not the first —
 *  the form is already gone by then, so nothing it repaints can be wiped. */
export function closeForm(): void {
  if (!isFormOpen()) return
  dropForm()
  renderList()
  host.onHeightChange()
  host.onFormClosed()
}

/** The FAB entry point (stage 05 calls it): expand the day and open a blank form. */
export function openAdd(d: DayNumber): void {
  if (shown !== d || panel === null) return
  openForm(d, null)
}
