// STAGE 01 — shared types. No runtime code in this file.
// Sources: SPEC.md "Dates", "Calendar API", "Categories and customization";
// HABITS.md "Schema"; DECISIONS.md "Rebuild rulings — stage 01 types".

// ---------- Dates ----------

declare const DAY: unique symbol
declare const WEEK: unique symbol
declare const OFF: unique symbol

/** Absolute civil date: days since 1970-01-01, from Date.UTC(y, m-1, d). DST-immune. The only date form that is persisted. */
export type DayNumber = number & { readonly [DAY]: true }
/** Layout row relative to the anchor: 0 = the week containing today(). Never persisted. */
export type WeekIndex = number & { readonly [WEEK]: true }
/** Column within a week: 0 = Mon … 6 = Sun. Also the vocabulary of Cadence.days. Never persisted as layout. */
export type DayOffset = number & { readonly [OFF]: true }

/** "YYYY-MM" in the civil calendar; the cache and load-state key. */
export type MonthKey = string
export type MonthLoadState = 'absent' | 'loading' | 'ready' | 'error'

// ---------- Events (Google Calendar) ----------

export type RepeatRule = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
export type WriteScope = 'instance' | 'series'

type EventBase = {
  /** Google event id. For a series instance this is the instance id. */
  id: string
  /** Present ⇒ this is an instance of a series; the series id for scope 'series'. */
  recurringEventId?: string
  title: string
  /** As read from Google. Truth. Absent when Google sent none. */
  colorId?: string
  /** StoredCategory.name resolved from colorId against current prefs at read time.
   *  Derived, never serialized; rehydration and prefs changes re-resolve it. */
  category: string
  /** Google `description`. */
  notes?: string
  start: DayNumber
  /** All-day: INCLUSIVE end day (gcal.ts converts from the API's exclusive end).
   *  Timed: the civil day the end clock time falls on; equals start unless the event crosses midnight. */
  end: DayNumber
}

export type CalendarEvent =
  | (EventBase & { allDay: true; startMin?: never; endMin?: never })
  | (EventBase & {
      allDay: false
      /** Minutes from local midnight of `start`, 0..1439. */
      startMin: number
      /** Minutes from local midnight of `end`, 0..1439. */
      endMin: number
    })

/** CalendarEvent as persisted in bramwell.cache.v1: `category` is derived from colorId
 *  and never serialized. Two arms written out — Omit<> over a union collapses the discriminant. */
export type StoredEvent =
  | (Omit<EventBase, 'category'> & { allDay: true; startMin?: never; endMin?: never })
  | (Omit<EventBase, 'category'> & { allDay: false; startMin: number; endMin: number })

/** In-progress form state. Deliberately flat so toggling allDay keeps the times;
 *  the CalendarEvent is built from it field by field in state.ts. */
export type EventDraft = {
  title: string
  category: string
  notes?: string
  allDay: boolean
  start: DayNumber
  end: DayNumber
  startMin?: number
  endMin?: number
  repeat: RepeatRule
}

/** One event's presence on one week row. Built in state.ts; render.ts adds the lane. */
export type EventSpan = {
  event: CalendarEvent
  week: WeekIndex
  from: DayOffset
  /** Inclusive. */
  to: DayOffset
  continuesBefore: boolean
  continuesAfter: boolean
}

// ---------- Event cache (localStorage bramwell.cache.v1) ----------

export type MonthEntry = {
  state: MonthLoadState
  /** Server truth only, category stripped; eventsForMonth() re-resolves it. Only 'ready' months are persisted. An event spanning a month boundary appears in both months. */
  events: StoredEvent[]
  /** Date.now() of the last successful fetch; 0 when never fetched. */
  fetchedAt: number
}

export type EventCache = {
  v: 1
  months: Record<MonthKey, MonthEntry>
}

/** Optimistic overlay, keyed by event id (tempId for creates). Merged on read, never serialized. */
export type PendingWrite =
  | { kind: 'create'; tempId: string; event: CalendarEvent }
  | { kind: 'update'; event: CalendarEvent; prior: CalendarEvent }
  | { kind: 'delete'; id: string; prior: CalendarEvent }

// ---------- Categories ----------

/** One of Google's 11 event colours. `hex` is Google's own paint, used as the
 *  light-mode colour of any category with no `displayHex`. */
export type GoogleColor = { id: string; name: string; hex: string }

// ---------- Prefs (localStorage bramwell.prefs.v1) ----------

export type MoodId = 'warm' | 'paper' | 'cool' | 'sage' | 'dusk'

export type StoredCategory = {
  /** Stable key. Never changes; renaming edits label only. */
  name: string
  label: string
  /** Google event colorId "1".."11". No two categories share one. */
  colorId: string
  /** Optional on-screen override of the Google colour. */
  displayHex?: string
  /** Days per calendar year the user means to spend on it, integer 1..366
   *  (SPEC "Planning layer", 2026-09-05). Absent = no budget. */
  budgetDays?: number
  /** Days carrying an event of this category may not be planned over.
   *  Literally `true` or absent — sanitize() drops anything else. */
  blocks?: true
}

export type Prefs = {
  /** Absent -> seed. */
  categories?: StoredCategory[]
  /** Absent -> "other". */
  fallbackCategory?: string
  /** Absent -> "warm". */
  mood?: MoodId
  /** Absent -> 30. */
  snapStepDays?: 15 | 30 | 45
  /** Absent -> "last" (2026-09-05). Read at launch: "cal"/"year" open that view;
   *  "last" opens whatever lastView holds, falling back to "year" (2026-09-10). */
  defaultView?: 'cal' | 'year' | 'last'
  /** Written on every Month/Year switch; read at launch only when defaultView
   *  is "last" or absent (SPEC "Settings", amended 2026-09-05). */
  lastView?: 'cal' | 'year'
  /** Written at dock, not read at launch. */
  lastDockedDay?: DayNumber
}

// ---------- Habits (Supabase, HABITS.md "Schema") ----------

export type Cadence =
  | { kind: 'daily' }
  /** DayOffset numbering: 0=Mon … 6=Sun. Not ISO. */
  | { kind: 'weekdays'; days: DayOffset[] }
  | { kind: 'per_week'; n: number }

export type Habit = {
  id: string
  name: string
  cadence: Cadence
  /** Completions per day that count as done. */
  target: number
  /** Optional hex; absent -> neutral. */
  color?: string
  sort: number
  /** ISO timestamp; present ⇒ hidden everywhere. */
  archivedAt?: string
}

export type HabitLog = {
  habitId: string
  /** Civil day; ISO date on the wire. One row per habit per day. */
  day: DayNumber
  value: number
  note?: string
}

export type HabitMonthEntry = {
  state: MonthLoadState
  logs: HabitLog[]
  fetchedAt: number
}

/** localStorage bramwell.habits.v1 */
export type HabitCache = {
  v: 1
  habits: Habit[]
  /** Load state of the habit list itself (not monthly; the MonthLoadState vocabulary is reused). */
  habitsState: MonthLoadState
  months: Record<MonthKey, HabitMonthEntry>
}
