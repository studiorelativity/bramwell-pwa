# Stage 01 — Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Vite + strict-TS skeleton at repo root, `types.ts` in full, the branded date core (`dates.ts` anchorless, `state.ts` anchored) proven by a 9-case selftest at `/?selftest`, and every other module from the file layout as a throwing stub.

**Architecture:** `src/dates.ts` imports nothing and owns the brands plus `Date.UTC` civil math; `src/state.ts` owns `today()` and the anchored `weekOf`/`dayAt`. Every other module exports its spec-named interface and throws `Error('STAGE NN: not implemented')`. The selftest is a pure function returning results; `main.ts` prints it when the URL carries `?selftest`, and node runs the same function via native type stripping so TDD needs no test framework.

**Tech Stack:** Vite 6, TypeScript 5 strict, vanilla TS, Node 26 (`.node-version`), no runtime dependencies this stage.

**Spec:** `01_scaffold/CONTEXT.md` (contract); `_references/SPEC.md` sections "Stack", "File layout", "Dates", "Auth", "Calendar API", "Categories and customization"; `_references/HABITS.md` "Schema"; `_references/CONVENTIONS.md`; `_references/DECISIONS.md` "In force — data and dates" and "Rebuild rulings — stage 01 types".

## Global Constraints

- TypeScript strict. No `any` without a `// why:` comment. (CONVENTIONS)
- Modules export their spec-defined public interface and nothing else. (CONVENTIONS)
- Leaf modules (`categories`, `gcal`, `habits`, `journal`) are DOM-free and never import `state.ts`. Anything may import `dates.ts`. (SPEC "File layout")
- `DayNumber`, `WeekIndex`, `DayOffset` are branded; constructors live in `dates.ts` only. `DayOffset` 0=Mon … 6=Sun. (DECISIONS)
- `Date` objects only at API and display boundaries — inside `dates.ts` they exist only as `Date.UTC` scratch. (CONVENTIONS)
- No transition or animation literal outside `motion.css`; no colour literal outside tokens. This stage writes no styles beyond seed tokens in `index.html`. (CONVENTIONS)
- Every stub is headed `// STAGE NN` and throws `Error('STAGE NN: not implemented')`. (CONTEXT)
- Storage keys: `bramwell.cache.v1`, `bramwell.prefs.v1`, `bramwell.habits.v1`. Not used this stage; named in `types.ts` comments only.
- Nothing in `.env.local` is committed. `.gitignore` covers it.
- Type-only imports use `import type` (tsconfig `verbatimModuleSyntax`), so node can strip types when running the selftest.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `package.json`, `tsconfig.json`, `vite.config.ts`, `.node-version`, `.gitignore` | toolchain | 1 |
| `index.html` | viewport meta, GIS script, seed tokens, `#app` | 1 |
| `src/style.css`, `src/motion.css` | present, empty | 1 |
| `src/main.ts` | boot; this stage: selftest print only | 1, 4 |
| `src/types.ts` | all shared types, no runtime | 2 |
| `src/dates.ts` | brands, `civilToDay`, `dayToCivil`, `offsetOf`, `addDays`, `monthKey` | 3 |
| `src/selftest.ts` | **not in the layout — see Task 3 step 0** | 3, 4 |
| `src/state.ts` | `today`, `weekOf`, `dayAt`; rest stubbed | 4 |
| `src/auth.ts`, `gcal.ts`, `habits.ts`, `journal.ts`, `categories.ts`, `scroll.ts`, `render.ts`, `year.ts`, `day.ts`, `chrome.ts`, `sw.ts` | stubs | 5 |
| `manifest.webmanifest`, `public/icon-192.png`, `public/icon-512.png`, `public/_headers` | PWA shell files | 6 |
| `01_scaffold/output/verification.md` | gate record | 7 |

---

### Task 1: Toolchain and skeleton

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `.node-version`, `.gitignore`, `index.html`, `src/main.ts`, `src/style.css`, `src/motion.css`

**Interfaces:**
- Produces: `npm run dev|build|preview`, `npx tsc --noEmit`; `index.html` with `<div id="app">` that `main.ts` owns.

- [ ] **Step 1: Initialise git and node version**

```bash
cd /Users/admin/_git/want/bramwell
git init -b main
printf '26\n' > .node-version
```

- [ ] **Step 2: Write `.gitignore`**

```
node_modules
dist
.env.local
.env.*.local
.DS_Store
```

- [ ] **Step 3: Write `package.json`**

```json
{
  "name": "bramwell",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "selftest": "node --experimental-strip-types --no-warnings scripts/selftest.ts"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^6.0.0"
  }
}
```

The `selftest` script's target is created in Task 3; it is declared here so `package.json` is written once. Node 26 strips types by default; the flag is kept so the command also works on Node 22.

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`allowImportingTsExtensions` because node's type stripping needs `./dates.ts`-style specifiers; Vite accepts them too. `scripts/` is not in `include`: node strips its types unchecked, which avoids a `@types/node` devDependency for one `process.exit`. `exactOptionalPropertyTypes` makes `notes?: string` reject an explicit `undefined`, which is what "built field by field, not by spreading the draft" wants enforced.

- [ ] **Step 5: Write `vite.config.ts`**

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  build: { target: 'es2022' },
})
```

- [ ] **Step 6: Write `index.html`**

Seed tokens are paint only (SPEC: "`:root` values in `index.html` are seed paint only"). Category hexes and dark twins are the frozen seed table. Surface/ink values are placeholders that stage 03/04 replace from the "Visual direction" section, which this stage may not read; they exist so the page is not unstyled white.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0f1115" />
    <title>Bramwell</title>
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/icon-192.png" />
    <style>
      /* Seed paint only. Runtime colours come from categories.themeCss() (stage 02). */
      :root {
        --cat-work: #3056D3;
        --cat-personal: #17925A;
        --cat-financial: #D97706;
        --cat-other: #64748B;
        --surface: #f7f6f3;
        --ink: #1a1a1a;
        color-scheme: light dark;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --cat-work: #7B96FF;
          --cat-personal: #4FC48D;
          --cat-financial: #F0A13C;
          --cat-other: #94A3B8;
          --surface: #0f1115;
          --ink: #e8e6e1;
        }
      }
      html, body { margin: 0; background: var(--surface); color: var(--ink); }
    </style>
    <script src="https://accounts.google.com/gsi/client" async defer></script>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 7: Write empty `src/style.css` and `src/motion.css`, and a minimal `src/main.ts`**

```bash
printf '/* Token consumption only. Populated from stage 03. */\n' > src/style.css
printf '/* Motion tokens, elevation scale, enter/exit utility, reduced-motion. Populated in stage 04. */\n' > src/motion.css
```

```ts
// src/main.ts
// STAGE 01 — bootstrapping and wiring; owns the theme <style>.
import './style.css'
import './motion.css'

const app = document.getElementById('app')
if (!app) throw new Error('STAGE 01: #app missing')
app.textContent = 'Bramwell — stage 01'
```

- [ ] **Step 8: Install and verify**

```bash
npm install
npx tsc --noEmit
npm run build
```

Expected: `tsc` prints nothing; `vite build` reports `dist/index.html` and one JS chunk. Then `npm run dev` and load `http://localhost:5173/` — page shows "Bramwell — stage 01" on the seed surface colour; console has no errors (a GIS network warning if offline is acceptable).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "stage 01: toolchain and skeleton"
```

---

### Task 2: `src/types.ts`

**Files:**
- Create: `src/types.ts`

**Interfaces:**
- Produces: every type below, by these exact names. No runtime exports. `dates.ts` (Task 3) provides the brand constructors; this file only declares the branded types.

- [ ] **Step 1: Write the file**

```ts
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
```

- [ ] **Step 2: Type-check, and prove the brands and the union bite**

Write a scratch file, run tsc against it, then delete it:

```ts
// src/_typecheck.ts  (scratch — delete after)
import type { CalendarEvent, DayNumber, WeekIndex } from './types.ts'

const d = 5 as DayNumber
// @ts-expect-error DayNumber is not a WeekIndex
const w: WeekIndex = d
// @ts-expect-error all-day events carry no startMin
const bad: CalendarEvent = { id: 'x', title: 't', category: 'other', start: d, end: d, allDay: true, startMin: 1 }
void w; void bad
```

```bash
npx tsc --noEmit && rm src/_typecheck.ts
```

Expected: `tsc` clean (both `@ts-expect-error` lines are satisfied — if either produced no error, tsc reports "Unused '@ts-expect-error' directive" and the design is not enforced).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "stage 01: types.ts"
```

---

### Task 3: `src/dates.ts` — anchorless date core, test-first

**Files:**
- Create: `src/dates.ts`, `src/selftest.ts`, `scripts/selftest.ts`
- Modify: `_references/SPEC.md` "File layout", `01_scaffold/CONTEXT.md` Outputs (step 0)

**Interfaces:**
- Produces:
  - `asDay(n: number): DayNumber`, `asWeek(n: number): WeekIndex`, `asOffset(n: number): DayOffset`
  - `civilToDay(y: number, m: number, d: number): DayNumber` — `m` is 1..12
  - `dayToCivil(day: DayNumber): { y: number; m: number; d: number }`
  - `addDays(day: DayNumber, n: number): DayNumber`
  - `offsetOf(day: DayNumber): DayOffset` — weekday of an absolute day, 0=Mon
  - `monthKey(day: DayNumber): MonthKey`
  - `selfTest(): SelfTestResult[]` from `src/selftest.ts`, where `SelfTestResult = { name: string; pass: boolean; detail: string }`

- [ ] **Step 0: Add `selftest.ts` to the file layout upstream**

The contract names `selfTest()` but the layout has no home for it; `state.ts` cannot hold it without importing test data into production code, and `main.ts` would pull the whole test into the bundle. CLAUDE.md: a file the layout lacks is added to `SPEC.md` first. Insert into the `SPEC.md` "File layout" block, after the `dates.ts` line:

```
/src/selftest.ts          — pure selfTest() over dates.ts and state.ts; loaded only by main.ts under ?selftest
```

And in `01_scaffold/CONTEXT.md` Outputs, change "a `selfTest()` covering both, reachable at `/?selftest`" to "a `selfTest()` in `src/selftest.ts` covering both, dynamically imported by `main.ts` under `/?selftest`".

- [ ] **Step 1: Write the failing selftest (anchorless cases only)**

```ts
// src/selftest.ts
// STAGE 01 — pure self-test over the date core. No DOM. Cases 5–8 are added in Task 4.
import type { DayNumber } from './types.ts'
import { asWeek, asOffset, civilToDay, dayToCivil, addDays, offsetOf, monthKey } from './dates.ts'

export type SelfTestResult = { name: string; pass: boolean; detail: string }

type Case = [name: string, run: () => string | null] // null = pass, string = failure detail

const cases: Case[] = [
  ['civil round-trip incl. leap day', () => {
    const probes: [number, number, number][] = [
      [1970, 1, 1], [2000, 2, 29], [2024, 2, 29], [2026, 8, 29], [1999, 12, 31], [2100, 3, 1],
    ]
    for (const [y, m, d] of probes) {
      const back = dayToCivil(civilToDay(y, m, d))
      if (back.y !== y || back.m !== m || back.d !== d) return `${y}-${m}-${d} -> ${JSON.stringify(back)}`
    }
    // 2023 is not a leap year: Feb 29 must normalise to Mar 1, not round-trip
    const notLeap = dayToCivil(civilToDay(2023, 2, 29))
    if (!(notLeap.m === 3 && notLeap.d === 1)) return `2023-02-29 normalised to ${JSON.stringify(notLeap)}`
    return null
  }],

  ['epoch anchoring', () => {
    if (civilToDay(1970, 1, 1) !== 0) return `1970-01-01 = ${civilToDay(1970, 1, 1)}`
    if (civilToDay(1970, 1, 2) !== 1) return `1970-01-02 = ${civilToDay(1970, 1, 2)}`
    if (civilToDay(1969, 12, 31) !== -1) return `1969-12-31 = ${civilToDay(1969, 12, 31)}`
    if (civilToDay(2000, 1, 1) !== 10957) return `2000-01-01 = ${civilToDay(2000, 1, 1)}`
    return null
  }],

  ['801-day weekday oracle', () => {
    // Oracle: Date.getUTCDay() (0=Sun) remapped to 0=Mon. 801 days crosses two Feb 29s from 2023-12-01.
    let day = civilToDay(2023, 12, 1)
    for (let i = 0; i < 801; i++) {
      const { y, m, d } = dayToCivil(day)
      const expect = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
      if (offsetOf(day) !== expect) return `day ${day} (${y}-${m}-${d}): got ${offsetOf(day)} want ${expect}`
      day = addDays(day, 1)
    }
    return null
  }],

  ['month keys across a boundary', () => {
    const jan31 = civilToDay(2026, 1, 31)
    const pairs: [DayNumber, string][] = [
      [jan31, '2026-01'], [addDays(jan31, 1), '2026-02'],
      [civilToDay(2025, 12, 31), '2025-12'], [civilToDay(2026, 1, 1), '2026-01'],
      [civilToDay(2026, 9, 5), '2026-09'],
    ]
    for (const [d, want] of pairs) if (monthKey(d) !== want) return `${d}: got ${monthKey(d)} want ${want}`
    return null
  }],
]

export function selfTest(): SelfTestResult[] {
  return cases.map(([name, run]) => {
    try {
      const detail = run()
      return { name, pass: detail === null, detail: detail ?? 'ok' }
    } catch (e) {
      return { name, pass: false, detail: `threw: ${(e as Error).message}` }
    }
  })
}
```

```ts
// scripts/selftest.ts — node runner; not part of the bundle.
import { selfTest } from '../src/selftest.ts'

const results = selfTest()
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : ' — ' + r.detail}`)
const failed = results.filter(r => !r.pass).length
console.log(`${results.length - failed}/${results.length}`)
process.exit(failed ? 1 : 0)
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run selftest
```

Expected: node fails to resolve `./dates.ts` (ERR_MODULE_NOT_FOUND). That is the failing state.

- [ ] **Step 3: Write `src/dates.ts`**

```ts
// STAGE 01 — anchorless civil-date core. Imports nothing. Anything may import this.
// Date objects appear here only as Date.UTC scratch; none escape.
import type { DayNumber, WeekIndex, DayOffset, MonthKey } from './types.ts'

const MS_PER_DAY = 86_400_000
/** 1970-01-01 was a Thursday: DayOffset 3 under 0=Mon. */
const EPOCH_OFFSET = 3

export const asDay = (n: number): DayNumber => n as DayNumber
export const asWeek = (n: number): WeekIndex => n as WeekIndex
export const asOffset = (n: number): DayOffset => n as DayOffset

/** m is 1..12. Out-of-range d normalises the way Date.UTC does (Feb 29 in a common year -> Mar 1). */
export function civilToDay(y: number, m: number, d: number): DayNumber {
  return asDay(Date.UTC(y, m - 1, d) / MS_PER_DAY)
}

export function dayToCivil(day: DayNumber): { y: number; m: number; d: number } {
  const t = new Date(day * MS_PER_DAY)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

export const addDays = (day: DayNumber, n: number): DayNumber => asDay(day + n)

/** Weekday of an absolute day, 0=Mon … 6=Sun. Works for negative days. */
export function offsetOf(day: DayNumber): DayOffset {
  return asOffset((((day + EPOCH_OFFSET) % 7) + 7) % 7)
}

export function monthKey(day: DayNumber): MonthKey {
  const { y, m } = dayToCivil(day)
  return `${y}-${String(m).padStart(2, '0')}`
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm run selftest && npx tsc --noEmit
```

Expected: four `PASS` lines, `4/4`, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/dates.ts src/selftest.ts scripts/selftest.ts _references/SPEC.md 01_scaffold/CONTEXT.md
git commit -m "stage 01: dates.ts anchorless core with selftest"
```

---

### Task 4: `src/state.ts` anchored core, remaining selftest cases, `?selftest` wiring

**Files:**
- Create: `src/state.ts`
- Modify: `src/selftest.ts`, `src/main.ts`

**Interfaces:**
- Consumes: everything from `dates.ts` (Task 3).
- Produces from `state.ts`:
  - `today(): DayNumber` — captured once at module load from the local clock (DECISIONS: a session open across midnight keeps its anchor).
  - `weekOf(day: DayNumber): WeekIndex`
  - `dayAt(week: WeekIndex, offset: DayOffset): DayNumber`
  - `_setAnchorForTest(day: DayNumber): void` — the only way the selftest pins the anchor; documented as test-only.
  - Stubs (throwing): `loadCache`, `saveCache`, `loadPrefs`, `savePrefs`, `eventsForMonth`, `spansForWeek`, `createEvent`, `updateEvent`, `deleteEvent`, `onCacheChange`, `enableDemo`.

- [ ] **Step 1: Add the five anchored cases to `src/selftest.ts`**

Add to the imports (`asWeek`/`asOffset` are already imported from Task 3):

```ts
import { today, weekOf, dayAt, _setAnchorForTest } from './state.ts'
```

Append to `cases` (before the closing `]`):

```ts
  ['Monday start', () => {
    for (let w = -3; w <= 3; w++) {
      const mon = dayAt(asWeek(w), asOffset(0))
      if (offsetOf(mon) !== 0) return `week ${w} starts on offset ${offsetOf(mon)}`
      const sun = dayAt(asWeek(w), asOffset(6))
      if (offsetOf(sun) !== 6) return `week ${w} ends on offset ${offsetOf(sun)}`
      if (sun - mon !== 6) return `week ${w} spans ${sun - mon} days`
    }
    return null
  }],

  ['year boundary in one row', () => {
    // 2024-12-30 (Mon) .. 2025-01-05 (Sun) is one row. Pin the anchor inside it.
    const saved = today()
    _setAnchorForTest(civilToDay(2025, 1, 2))
    try {
      const mon = civilToDay(2024, 12, 30), sun = civilToDay(2025, 1, 5)
      if (weekOf(mon) !== 0 || weekOf(sun) !== 0) return `weekOf: ${weekOf(mon)} / ${weekOf(sun)}`
      if (dayAt(asWeek(0), asOffset(0)) !== mon) return `row start ${dayAt(asWeek(0), asOffset(0))} want ${mon}`
      if (dayAt(asWeek(0), asOffset(6)) !== sun) return `row end ${dayAt(asWeek(0), asOffset(6))} want ${sun}`
      if (weekOf(addDays(mon, -1)) !== -1) return `Sunday before is week ${weekOf(addDays(mon, -1))}`
      return null
    } finally { _setAnchorForTest(saved) }
  }],

  ['DST-safe stepping across two local years', () => {
    // Walk two local-clock years day by day with Date#setDate (which honours local DST),
    // and demand that addDays over DayNumber lands on the same civil date every step.
    const start = new Date(2024, 0, 1)   // local midnight
    let day = civilToDay(2024, 1, 1)
    const cursor = new Date(start)
    for (let i = 0; i < 731; i++) {
      const c = dayToCivil(day)
      if (c.y !== cursor.getFullYear() || c.m !== cursor.getMonth() + 1 || c.d !== cursor.getDate())
        return `step ${i}: DayNumber says ${c.y}-${c.m}-${c.d}, local clock says ${cursor.getFullYear()}-${cursor.getMonth() + 1}-${cursor.getDate()}`
      cursor.setDate(cursor.getDate() + 1)
      day = addDays(day, 1)
    }
    return null
  }],

  ['weekOf/dayAt round-trip', () => {
    const t = today()
    for (let n = -400; n <= 400; n += 7) {
      for (let o = 0; o < 7; o++) {
        const d = addDays(t, n + o - offsetOf(t))
        const back = dayAt(weekOf(d), offsetOf(d))
        if (back !== d) return `${d} -> week ${weekOf(d)} off ${offsetOf(d)} -> ${back}`
      }
    }
    return null
  }],

  ['week 0 contains today', () => {
    const t = today()
    if (weekOf(t) !== 0) return `today is week ${weekOf(t)}`
    const mon = dayAt(asWeek(0), asOffset(0))
    if (!(mon <= t && t <= addDays(mon, 6))) return `today ${t} outside row ${mon}..${addDays(mon, 6)}`
    const { y, m, d } = dayToCivil(t)
    const now = new Date()
    if (y !== now.getFullYear() || m !== now.getMonth() + 1 || d !== now.getDate()) return `today() is ${y}-${m}-${d}`
    return null
  }],
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run selftest
```

Expected: ERR_MODULE_NOT_FOUND for `./state.ts`.

- [ ] **Step 3: Write `src/state.ts`**

```ts
// STAGE 01 — event cache, today() anchor, DayNumber<->WeekIndex math, persistence, write orchestration, demo.
// Only the anchor and the layout conversion are implemented in stage 01.
import type {
  DayNumber, WeekIndex, DayOffset, MonthKey, CalendarEvent, EventDraft, EventSpan,
  EventCache, Prefs, WriteScope,
} from './types.ts'
import { asDay, asWeek, civilToDay, offsetOf } from './dates.ts'

// ---------- Anchor ----------

function localToday(): DayNumber {
  const n = new Date()   // display boundary: the local clock
  return civilToDay(n.getFullYear(), n.getMonth() + 1, n.getDate())
}

/** Captured once at load. A session left open across midnight keeps its anchor until reload. */
let anchor: DayNumber = localToday()
/** Monday of the anchor's week: WeekIndex 0, DayOffset 0. */
let anchorMonday: DayNumber = asDay(anchor - offsetOf(anchor))

export function today(): DayNumber {
  return anchor
}

/** Test-only. Re-pins the anchor so the selftest can place a known date in week 0. */
export function _setAnchorForTest(day: DayNumber): void {
  anchor = day
  anchorMonday = asDay(anchor - offsetOf(anchor))
}

// ---------- Layout conversion (the only place DayNumber <-> WeekIndex happens) ----------

export function weekOf(day: DayNumber): WeekIndex {
  return asWeek(Math.floor((day - anchorMonday) / 7))
}

export function dayAt(week: WeekIndex, offset: DayOffset): DayNumber {
  return asDay(anchorMonday + week * 7 + offset)
}

// ---------- Stubs: stage 02 ----------

const NOT_IMPLEMENTED = 'STAGE 02: not implemented'

export function loadCache(): EventCache { throw new Error(NOT_IMPLEMENTED) }
export function saveCache(_cache: EventCache): void { throw new Error(NOT_IMPLEMENTED) }
export function loadPrefs(): Prefs { throw new Error(NOT_IMPLEMENTED) }
export function savePrefs(_prefs: Prefs): void { throw new Error(NOT_IMPLEMENTED) }
export function eventsForMonth(_key: MonthKey): CalendarEvent[] { throw new Error(NOT_IMPLEMENTED) }
export function spansForWeek(_week: WeekIndex): EventSpan[] { throw new Error(NOT_IMPLEMENTED) }
export function createEvent(_draft: EventDraft): Promise<CalendarEvent> { throw new Error(NOT_IMPLEMENTED) }
export function updateEvent(_id: string, _draft: EventDraft, _scope: WriteScope): Promise<CalendarEvent> { throw new Error(NOT_IMPLEMENTED) }
export function deleteEvent(_id: string, _scope: WriteScope): Promise<void> { throw new Error(NOT_IMPLEMENTED) }
export function onCacheChange(_fn: (months: MonthKey[]) => void): () => void { throw new Error(NOT_IMPLEMENTED) }
export function enableDemo(): void { throw new Error('STAGE 06: not implemented') }
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm run selftest && npx tsc --noEmit
```

Expected: nine `PASS` lines, `9/9`, tsc clean. If "DST-safe stepping" fails, the machine's local zone has a DST transition and `civilToDay` is using local time somewhere — it must use `Date.UTC` only.

- [ ] **Step 5: Wire `/?selftest` in `main.ts`**

Replace `src/main.ts` with:

```ts
// STAGE 01 — bootstrapping and wiring; owns the theme <style>.
import './style.css'
import './motion.css'

const app = document.getElementById('app')
if (!app) throw new Error('STAGE 01: #app missing')

if (new URLSearchParams(location.search).has('selftest')) {
  const { selfTest } = await import('./selftest.ts')
  const results = selfTest()
  const passed = results.filter(r => r.pass).length
  const pre = document.createElement('pre')
  pre.textContent =
    results.map(r => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : ' — ' + r.detail}`).join('\n') +
    `\n\n${passed}/${results.length}`
  pre.dataset['selftest'] = passed === results.length ? 'pass' : 'fail'
  app.replaceChildren(pre)
} else {
  app.textContent = 'Bramwell — stage 01'
}
```

`data-selftest="pass"` is what headless verification greps for.

- [ ] **Step 6: Verify in the browser and headless**

```bash
npm run dev &
sleep 2
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --dump-dom --virtual-time-budget=3000 "http://localhost:5173/?selftest" 2>/dev/null | grep -o 'data-selftest="[a-z]*"'
kill %1
```

Expected: `data-selftest="pass"`. Then open `http://localhost:5173/?selftest` by hand and confirm `9/9`. Also `npm run build` clean — the selftest chunk must appear as a separate file in `dist/assets/` (dynamic import), not in the main chunk.

- [ ] **Step 7: Commit**

```bash
git add src/state.ts src/selftest.ts src/main.ts
git commit -m "stage 01: anchored date core, 9/9 selftest, ?selftest route"
```

---

### Task 5: Stubs for every remaining module

**Files:**
- Create: `src/auth.ts`, `src/gcal.ts`, `src/habits.ts`, `src/journal.ts`, `src/categories.ts`, `src/scroll.ts`, `src/render.ts`, `src/year.ts`, `src/day.ts`, `src/chrome.ts`, `src/sw.ts`

**Interfaces:**
- Produces: the named exports below. Where the spec sections this stage may read name a function, its signature is fixed here; where they do not, the stub exports a single `mount`/`init` that the owning stage widens after adding the real interface to `SPEC.md`.

- [ ] **Step 1: Write the four leaf stubs (DOM-free, no `state.ts` import)**

```ts
// src/auth.ts
// STAGE 02 — GIS token client. The ONLY file that knows about Google auth. Exports exactly these four.
const E = () => new Error('STAGE 02: not implemented')
export function getToken(_forceRefresh = false): Promise<string> { throw E() }
export function signIn(): Promise<void> { throw E() }
export function signOut(): Promise<void> { throw E() }
export function isSignedIn(): boolean { throw E() }
```

```ts
// src/gcal.ts
// STAGE 02 — Calendar API. The ONLY file calling googleapis.com. Owns wire <-> DayNumber.
import type { CalendarEvent, EventDraft, MonthKey, WriteScope } from './types.ts'
const E = () => new Error('STAGE 02: not implemented')
/** Lower to force pagination during a gate; restore to 250. */
export const MAX_RESULTS = 250
export function listMonth(_key: MonthKey, _token: string): Promise<CalendarEvent[]> { throw E() }
export function createEvent(_draft: EventDraft, _colorId: string, _token: string): Promise<CalendarEvent> { throw E() }
export function updateEvent(_id: string, _changes: Partial<EventDraft>, _scope: WriteScope, _token: string): Promise<CalendarEvent> { throw E() }
export function deleteEvent(_id: string, _scope: WriteScope, _token: string): Promise<void> { throw E() }
```

```ts
// src/habits.ts
// STAGE 07 — Supabase client. The ONLY file importing @supabase/supabase-js. DOM-free; never imports state.ts.
import type { DayNumber, Habit, HabitLog } from './types.ts'
const E = () => new Error('STAGE 07: not implemented')
export function signIn(): Promise<void> { throw E() }
export function signOut(): Promise<void> { throw E() }
export function isSignedIn(): boolean { throw E() }
export function listHabits(): Promise<Habit[]> { throw E() }
export function logsForRange(_from: DayNumber, _to: DayNumber): Promise<HabitLog[]> { throw E() }
export function upsertLog(_log: HabitLog): Promise<HabitLog> { throw E() }
export function deleteLog(_habitId: string, _day: DayNumber): Promise<void> { throw E() }
export function saveHabit(_habit: Omit<Habit, 'id'> & { id?: string }): Promise<Habit> { throw E() }
export function archiveHabit(_id: string): Promise<void> { throw E() }
```

```ts
// src/journal.ts
// STAGE 08 — journal link/index resolution. No network of its own. DOM-free; never imports state.ts.
import type { DayNumber } from './types.ts'
const E = () => new Error('STAGE 08: not implemented')
export function linkFor(_day: DayNumber): string { throw E() }
```

```ts
// src/categories.ts
// STAGE 02 — category resolution, Google colour table, moods, themeCss(). DOM-free; never imports state.ts.
import type { MoodId, Prefs, StoredCategory } from './types.ts'
const E = () => new Error('STAGE 02: not implemented')
/** main.ts pushes prefs in; this module never reads storage. */
export function configure(_prefs: Prefs): void { throw E() }
/** Untrusted-blob loader: drops invalid rows, dedupes name and colorId, caps at 11, first writer wins. */
export function sanitize(_raw: unknown): StoredCategory[] { throw E() }
export function categoryFor(_colorId: string | undefined): StoredCategory { throw E() }
export function fallback(): StoredCategory { throw E() }
export function all(): StoredCategory[] { throw E() }
/** HSL brighten: lightness floor 0.62, saturation cap 0.72. Dark twin of any hex. */
export function brighten(_hex: string): string { throw E() }
/** [data-cat] rules, --cat-<name> properties, mood tokens. main.ts owns the <style>. */
export function themeCss(_mood: MoodId): string { throw E() }
```

- [ ] **Step 2: Write the DOM-module stubs**

```ts
// src/scroll.ts
// STAGE 03 — virtualizer, snap physics, the one variable-height row.
export function mount(_root: HTMLElement): void { throw new Error('STAGE 03: not implemented') }
```

```ts
// src/render.ts
// STAGE 03 — week rows, bars, chips, lane packing, month badges, header. Sets data-cat and nothing else per frame.
import type { EventSpan, WeekIndex } from './types.ts'
/** EventSpan with the lane render.ts assigned. Not persisted, not exported beyond render.ts's consumers. */
export type PackedSpan = EventSpan & { lane: number }
export function renderWeek(_week: WeekIndex, _spans: EventSpan[]): HTMLElement { throw new Error('STAGE 03: not implemented') }
```

```ts
// src/year.ts
// STAGE 03 — year view.
export function mount(_root: HTMLElement): void { throw new Error('STAGE 03: not implemented') }
```

```ts
// src/day.ts
// STAGE 04 — inline day expansion content: event list, form, habits, journal. Never imports gcal.ts.
import type { DayNumber } from './types.ts'
export function expand(_day: DayNumber, _into: HTMLElement): void { throw new Error('STAGE 04: not implemented') }
```

```ts
// src/chrome.ts
// STAGE 05 — first-run, settings sheet, FAB, toasts.
export function mount(_root: HTMLElement): void { throw new Error('STAGE 05: not implemented') }
export function toast(_message: string): void { throw new Error('STAGE 05: not implemented') }
```

```ts
// src/sw.ts
// STAGE 05 — service worker. Classic script at deploy; hashed assets cache-first, everything else network-first.
// Intentionally empty until stage 05: an installed SW that throws would wedge every load.
export {}
```

`sw.ts` is the one file that does not throw — the header comment says why.

- [ ] **Step 3: Verify boundaries and type-check**

```bash
npx tsc --noEmit
grep -l "from './state" src/categories.ts src/gcal.ts src/habits.ts src/journal.ts src/dates.ts; echo "leaf->state imports above (must be empty)"
grep -L "^// STAGE" src/*.ts; echo "files without a STAGE header above (must be empty)"
ls src/ | sort
```

Expected: tsc clean; both greps print only their label; the listing is exactly `auth.ts categories.ts chrome.ts dates.ts day.ts gcal.ts habits.ts journal.ts main.ts motion.css render.ts scroll.ts selftest.ts state.ts style.css sw.ts types.ts year.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "stage 01: module stubs for stages 02-08"
```

---

### Task 6: PWA shell files

**Files:**
- Create: `manifest.webmanifest`, `public/icon-192.png`, `public/icon-512.png`, `public/_headers`

**Interfaces:**
- Produces: files at the paths `index.html` already references. Content is placeholder; stage 05 owns the real PWA behaviour and may not be read this stage.

- [ ] **Step 1: Write `manifest.webmanifest`**

```json
{
  "name": "Bramwell",
  "short_name": "Bramwell",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f1115",
  "theme_color": "#0f1115",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 2: Generate placeholder icons (solid seed-surface squares, no dependencies)**

```bash
mkdir -p public
python3 - <<'EOF'
import zlib, struct
def png(path, size, rgb):
    raw = b''.join(b'\x00' + bytes(rgb) * size for _ in range(size))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
png('public/icon-192.png', 192, (0x0f, 0x11, 0x15))
png('public/icon-512.png', 512, (0x0f, 0x11, 0x15))
EOF
file public/icon-192.png public/icon-512.png
```

Expected: both reported as `PNG image data, 192 x 192` / `512 x 512, 8-bit/color RGB`.

- [ ] **Step 3: Write `public/_headers`**

The DEPLOY section is out of scope this stage; this is the minimum a Cloudflare Pages site should carry, and stage 05 replaces it.

```
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
```

- [ ] **Step 4: Verify the build carries them**

```bash
npm run build && ls dist/ dist/assets/ && test -f dist/_headers && test -f dist/icon-512.png && test -f dist/manifest.webmanifest && echo OK
```

Expected: `OK`, and `dist/assets/` contains a separate `selftest-*.js` chunk.

- [ ] **Step 5: Commit**

```bash
git add manifest.webmanifest public/
git commit -m "stage 01: manifest, placeholder icons, _headers"
```

---

### Task 7: Verification record

**Files:**
- Create: `01_scaffold/output/verification.md`
- Modify: `01_scaffold/CONTEXT.md` line 3 (Status)

- [ ] **Step 1: Run the whole gate and capture output**

```bash
npx tsc --noEmit && echo TSC_CLEAN
npm run build 2>&1 | tail -5
npm run selftest
npm run dev &
sleep 2
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --dump-dom --virtual-time-budget=3000 "http://localhost:5173/?selftest" 2>/dev/null | grep -o 'data-selftest="[a-z]*"'
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --dump-dom --virtual-time-budget=3000 --blink-settings=preferredColorScheme=1 "http://localhost:5173/" 2>/dev/null | grep -c 'Bramwell — stage 01'
kill %1
```

- [ ] **Step 2: Write `01_scaffold/output/verification.md`** with these sections, filled from the actual output (no paraphrase — paste the lines):

```markdown
# Stage 01 — verification

## Gate criteria
| Criterion | Result | Evidence |
|---|---|---|
| `npm run dev` serves without errors | | (console output) |
| `tsc --noEmit` clean | | |
| `npm run build` clean | | (dist listing) |
| `/?selftest` 9/9 in the browser | | (headless grep + hand-check) |
| `types.ts` reviewed against SPEC API + HABITS schema | HUMAN | |

## Rulings the spec left open (made here, recorded in DECISIONS.md)
- `selftest.ts` added to the file layout; dynamically imported so it is not in the main chunk.
- `_setAnchorForTest` is a test-only export of `state.ts`; the spec's "exports exactly" rule applies to `auth.ts` only.
- `sw.ts` is an empty module, not a throwing stub (an installed throwing SW wedges every load).
- Seed `--surface`/`--ink` in `index.html` are placeholders; stage 03 replaces them from "Visual direction".
- `public/_headers` is a two-line placeholder; stage 05 owns it.
- Stub signatures for scroll/render/year/day/chrome are minimal (`mount`, `renderWeek`, `expand`, `toast`); the owning stage adds the interface to SPEC.md before widening.

## Not tested
- Nothing touches the network; auth, gcal, habits are throwing stubs.
- SW registration (none yet).
- The selftest ran in this machine's time zone only; the DST case is meaningful only where the local zone observes DST.
- Icons are solid squares; maskable safe-zone not checked.
```

- [ ] **Step 3: Record the rulings in `DECISIONS.md`**

Append under "Rebuild rulings — stage 01 types" a sub-list headed `- Stage 01 execution rulings (2026-08-29):` with the six bullets from the "Rulings the spec left open" section above, verbatim.

- [ ] **Step 4: Flip the contract Status**

In `01_scaffold/CONTEXT.md` change `**Status: OPEN.** First stage of the rebuild. Nothing exists yet.` to `**Status: VERIFIED — awaiting human gate.** Verification in output/verification.md.`

- [ ] **Step 5: Commit and stop**

```bash
git add 01_scaffold/ _references/DECISIONS.md
git commit -m "stage 01: verification record"
```

Stop here. The human runs the gate, reviews `types.ts`, writes `.env.local` with `VITE_GOOGLE_CLIENT_ID=` from `../bramwell-calendar/.env.local`, and closes the stage. Stage 02 does not open until then.
