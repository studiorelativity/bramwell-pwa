// STAGE 02 — Calendar API. The ONLY file calling googleapis.com. Owns wire <-> DayNumber.
import type { DayNumber, EventDraft, MonthKey, RepeatRule, StoredEvent } from './types.ts'
import { asDay, civilToDay, dayToCivil } from './dates.ts'

const BASE = 'https://www.googleapis.com/calendar/v3'
const CAL = 'primary'
/** Lower to force pagination during a gate; restore to 250. */
export const MAX_RESULTS = 250
const MAX_PAGES = 20
const RETRY_MS = 500

/** Thrown for every non-OK response. state.ts keys its 401 re-auth retry off `status`. */
export class GcalError extends Error {
  status: number
  body: unknown
  // Written out rather than as constructor parameter properties: node's type stripping
  // erases types only and cannot emit the assignments those imply.
  constructor(status: number, body: unknown) {
    super(`Google Calendar API ${status}`)
    this.name = 'GcalError'
    this.status = status
    this.body = body
  }
}

// ---------- Wire shapes ----------

type WireDate = { date?: string; dateTime?: string; timeZone?: string }
type WireEvent = {
  id?: string; status?: string; summary?: string; description?: string
  colorId?: string; recurringEventId?: string; start?: WireDate; end?: WireDate
}
type WireList = { items?: WireEvent[]; nextPageToken?: string }

// ---------- Formatting (the only Date objects in this module) ----------

const p2 = (n: number) => String(n).padStart(2, '0')

function ymd(day: DayNumber): string {
  const { y, m, d } = dayToCivil(day)
  return `${y}-${p2(m)}-${p2(d)}`
}

function parseYmd(s: string): DayNumber {
  const [y, m, d] = s.split('-').map(Number)
  return civilToDay(y ?? 0, m ?? 1, d ?? 1)
}

/** RFC3339 with the local offset, as SPEC "Calendar API" requires. */
function rfc3339Local(day: DayNumber, minutes: number): string {
  const { y, m, d } = dayToCivil(day)
  const t = new Date(y, m - 1, d, 0, minutes, 0, 0)   // API boundary
  const off = -t.getTimezoneOffset()
  const abs = Math.abs(off)
  return `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}` +
    `T${p2(t.getHours())}:${p2(t.getMinutes())}:00` +
    `${off < 0 ? '-' : '+'}${p2(Math.floor(abs / 60))}:${p2(abs % 60)}`
}

// ---------- Mapping ----------

function fromWire(w: WireEvent): StoredEvent | null {
  if (w.id === undefined) return null
  let ev: StoredEvent
  const sd = w.start?.date, ed = w.end?.date
  if (sd !== undefined && ed !== undefined) {
    ev = {
      id: w.id, title: w.summary ?? '', allDay: true,
      start: parseYmd(sd),
      // API end is EXCLUSIVE, internal end is INCLUSIVE. Converted here and nowhere else.
      end: asDay(parseYmd(ed) - 1),
    }
  } else {
    const st = w.start?.dateTime, et = w.end?.dateTime
    if (st === undefined || et === undefined) return null
    const s = new Date(st), e = new Date(et)   // API boundary
    ev = {
      id: w.id, title: w.summary ?? '', allDay: false,
      start: civilToDay(s.getFullYear(), s.getMonth() + 1, s.getDate()),
      end: civilToDay(e.getFullYear(), e.getMonth() + 1, e.getDate()),
      startMin: s.getHours() * 60 + s.getMinutes(),
      endMin: e.getHours() * 60 + e.getMinutes(),
    }
  }
  if (w.colorId !== undefined) ev.colorId = w.colorId
  if (w.description !== undefined) ev.notes = w.description
  if (w.recurringEventId !== undefined) ev.recurringEventId = w.recurringEventId
  return ev
}

const RRULE: Record<RepeatRule, string | null> = {
  none: null,
  daily: 'RRULE:FREQ=DAILY',
  weekly: 'RRULE:FREQ=WEEKLY',
  monthly: 'RRULE:FREQ=MONTHLY',
  yearly: 'RRULE:FREQ=YEARLY',
}

/** Changed fields only. A change to dates must carry allDay, start and end together:
 *  the dates block below fires only when start and end are both present, and state.ts
 *  builds its changes object so they are set together or not at all. It does NOT pass
 *  the whole draft — it omits `repeat` always, and omits the dates for a series edit. */
function toWire(draft: Partial<EventDraft>, colorId: string | undefined): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (draft.title !== undefined) body['summary'] = draft.title
  if (draft.notes !== undefined) body['description'] = draft.notes
  if (colorId !== undefined) body['colorId'] = colorId
  if (draft.start !== undefined && draft.end !== undefined) {
    if (draft.allDay === true) {
      body['start'] = { date: ymd(draft.start) }
      // internal end INCLUSIVE -> API end EXCLUSIVE. Converted here and nowhere else.
      body['end'] = { date: ymd(asDay(draft.end + 1)) }
    } else if (draft.allDay === false) {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
      body['start'] = { dateTime: rfc3339Local(draft.start, draft.startMin ?? 0), timeZone }
      body['end'] = { dateTime: rfc3339Local(draft.end, draft.endMin ?? 0), timeZone }
    }
  }
  if (draft.repeat !== undefined) {
    const rule = RRULE[draft.repeat]
    if (rule !== null) body['recurrence'] = [rule]
  }
  return body
}

// ---------- Transport ----------

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function retriable(status: number, body: unknown): boolean {
  if (status >= 500 || status === 429) return true
  if (status !== 403) return false
  const reason = (body as { error?: { errors?: { reason?: string }[] } } | null)?.error?.errors?.[0]?.reason
  return reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded'
}

/** One retry on 403-rate-limit / 429 / 5xx, then surface. `fetch` is resolved at call
 *  time, never captured at module scope, so a test can swap globalThis.fetch. */
async function request(path: string, token: string, init: RequestInit = {}): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` }
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetch(`${BASE}${path}`, { ...init, headers })
    if (res.ok) return res.status === 204 ? null : await res.json()
    const body = await res.json().catch(() => null)
    if (attempt === 0 && retriable(res.status, body)) {
      await sleep(RETRY_MS)
      continue
    }
    throw new GcalError(res.status, body)
  }
}

// ---------- API ----------

export async function listMonth(key: MonthKey, token: string): Promise<StoredEvent[]> {
  const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7))
  const first = civilToDay(y, m, 1)
  const next = civilToDay(y, m + 1, 1)   // civilToDay normalises month 13 into January
  const out: StoredEvent[] = []
  let pageToken: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({
      timeMin: rfc3339Local(first, 0),
      timeMax: rfc3339Local(next, 0),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(MAX_RESULTS),
    })
    if (pageToken !== undefined) q.set('pageToken', pageToken)
    const res = await request(`/calendars/${CAL}/events?${q}`, token) as WireList
    for (const w of res.items ?? []) {
      if (w.status === 'cancelled') continue
      const ev = fromWire(w)
      if (ev !== null) out.push(ev)
    }
    if (res.nextPageToken === undefined) return out
    pageToken = res.nextPageToken
  }
  throw new GcalError(0, `nextPageToken did not terminate after ${MAX_PAGES} pages`)
}

export async function createEvent(draft: EventDraft, colorId: string, token: string): Promise<StoredEvent> {
  const res = await request(`/calendars/${CAL}/events`, token, {
    method: 'POST',
    body: JSON.stringify(toWire(draft, colorId)),
  })
  const ev = fromWire(res as WireEvent)
  if (ev === null) throw new GcalError(0, 'create returned an event that could not be mapped')
  return ev
}

/** `id` is the caller's choice: the instance id for this occurrence, `recurringEventId`
 *  for the whole series. Only state.ts holds the event carrying both. */
export async function updateEvent(id: string, changes: Partial<EventDraft>, colorId: string | undefined, token: string): Promise<StoredEvent> {
  const res = await request(`/calendars/${CAL}/events/${encodeURIComponent(id)}`, token, {
    method: 'PATCH',
    body: JSON.stringify(toWire(changes, colorId)),
  })
  const ev = fromWire(res as WireEvent)
  if (ev === null) throw new GcalError(0, 'update returned an event that could not be mapped')
  return ev
}

export async function deleteEvent(id: string, token: string): Promise<void> {
  await request(`/calendars/${CAL}/events/${encodeURIComponent(id)}`, token, { method: 'DELETE' })
}
