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
  | (EventBase & { allDay: true })
  | (EventBase & {
      allDay: false
      /** Minutes from local midnight of `start`, 0..1439. */
      startMin: number
      /** Minutes from local midnight of `end`, 0..1439. */
      endMin: number
    })

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
  /** Server truth only. An event that spans a month boundary appears in both months. */
  events: CalendarEvent[]
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
}

export type Prefs = {
  /** Absent -> seed. */
  categories?: StoredCategory[]
  /** Absent -> "other". */
  fallbackCategory?: string
  /** Absent -> "warm". */
  mood?: MoodId
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
