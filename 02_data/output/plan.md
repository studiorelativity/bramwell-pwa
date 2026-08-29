# Stage 02 — Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `auth.ts`, `gcal.ts`, `categories.ts` and the cache / persistence / write orchestration in `state.ts`, with the wire conversion proven by a `fetch`-stubbed 12-case suite, so a real Google account can be signed into and driven from the console at the gate.

**Architecture:** One direction, no cycles. `main.ts` → `state.ts` → `gcal.ts` → googleapis.com; `main.ts` → `categories.configure()`; `state.ts` → `auth.getToken()`. `gcal.ts` imports only `types.ts` and `dates.ts` and returns `StoredEvent` (the persisted shape) so category resolution stays in `state.ts` alone. `gcal.ts` owns the transport retry (403-rate-limit / 429 / 5xx); `state.ts` owns the 401 re-auth retry in a single `withToken()` wrapper. Tests are selftest cases, which become `async`, run by both `npm run selftest` under node and `/?selftest` in the browser.

**Tech Stack:** Vite 6, TypeScript 5 strict, vanilla TS, Node 26 native type stripping, Google Identity Services (token client), Google Calendar API v3. No runtime dependencies added.

**Spec:** `02_data/CONTEXT.md` (contract); `_references/SPEC.md` sections "Auth", "Calendar API", "Write orchestration" (incl. "State API"), "Categories and customization", "Perpetual scroll mechanics" (lazy month loading only), "File layout"; `_references/CONVENTIONS.md`; `_references/DECISIONS.md` "In force — auth and wire", "In force — categories and colour", "Rebuild rulings — stage 01 types".

## Global Constraints

- TypeScript strict. No `any` without a `// why:` comment. (CONVENTIONS)
- Modules export their spec-defined public interface and nothing else. (CONVENTIONS)
- **Node type-stripping compatibility, every module in the selftest graph** (`dates`, `state`, `auth`, `gcal`, `categories`, `types`): no `enum`, no `namespace`, **no constructor parameter properties**, no decorators. Node's `--experimental-strip-types` erases types only; it cannot emit runtime code. Type-only imports use `import type` (`verbatimModuleSyntax`).
- **Browser globals inside functions only** — `window`, `document`, `localStorage`, and `import.meta.env` — never at module scope, in any module reachable from `selftest.ts`. `import.meta.env` is `undefined` under bare node; a module-scope read throws `TypeError` at import and takes the whole selftest down. (CONVENTIONS; stage-01 ruling 13)
- `gcal.ts` calls bare `fetch(...)` inside each function, never captured at module scope, so a test can swap `globalThis.fetch`. (SPEC "Calendar API")
- Leaf modules (`categories`, `gcal`) are DOM-free and never import `state.ts`. `state.ts` → `categories.ts` is allowed and required. Anything may import `dates.ts`. (SPEC "File layout")
- `Date` objects only at API and display boundaries. `DayNumber` is what is stored; `WeekIndex`/`DayOffset` conversion lives in `state.ts` only. (CONVENTIONS)
- All-day end is **inclusive** internally, **exclusive** on the wire; converted in `gcal.ts` and nowhere else. (SPEC)
- `CalendarEvent.category` is derived from `colorId` at read time and never serialized. `StoredEvent` is the persisted shape. (types.ts)
- Storage keys `bramwell.cache.v1` / `bramwell.prefs.v1`; version mismatch discards; quota failures swallowed — the cache is never truth. (DECISIONS)
- Optimistic creates are built **field by field**, never by spreading `EventDraft`. (SPEC; stage-01 ruling 7)
- The offline check sits **inside** the try block, **after** the optimistic apply, so the rollback path really runs. (SPEC)
- Scope: `https://www.googleapis.com/auth/calendar.events` only. Token in memory only, never persisted. (SPEC "Auth")
- No colour literal outside the token layer; no transition or animation literal outside `motion.css`. `themeCss()` returns a string; `main.ts` owns the `<style>` element. (CONVENTIONS)
- `npx tsc --noEmit` and `npm run selftest` must pass at the end of every task.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/selftest.ts` | async `selfTest()`, `stubFetch`/`stubStorage` helpers, all cases | 1, and every task after |
| `src/main.ts` | await async `selfTest()`; DEV-only harness; owns the theme `<style>` | 1, 10 |
| `scripts/selftest.ts` | node runner, awaits `selfTest()` | 1 |
| `src/categories.ts` | seed, Google colour table, twins, `sanitize`, `brighten`, resolution | 2 |
| `src/categories.ts` | `themeCss()` and the warm-only `MOODS` table | 3 |
| `src/gcal.ts` | `GcalError`, request/retry, wire↔`DayNumber`, `listMonth` | 4 |
| `src/gcal.ts` | `createEvent`, `updateEvent`, `deleteEvent` | 5 |
| `src/auth.ts` | GIS token client, quiet renewal, revoke | 6 |
| `src/state.ts` | cache + prefs persistence, `monthState`, `eventsForMonth`, `spansForWeek` | 7 |
| `src/state.ts` | `withToken`, `ensureMonthsFor`, `onCacheChange` | 8 |
| `src/state.ts` | optimistic `createEvent`/`updateEvent`/`deleteEvent` + rollback | 9 |
| `02_data/output/verification.md` | gate record | 11 |

---

### Task 1: Async selftest harness and stub helpers

Everything after this task is written test-first, so the harness lands first. Nothing about the nine existing cases changes except that `selfTest()` is now awaited.

**Files:**
- Modify: `src/selftest.ts` (the `Case` type, the `selfTest` function, new helpers)
- Modify: `src/main.ts:9-10`
- Modify: `scripts/selftest.ts:3`

**Interfaces:**
- Produces: `export async function selfTest(): Promise<SelfTestResult[]>`; `stubFetch(responses)` returning `{ calls, restore }`; `stubStorage()` returning `{ restore }`. Every later task appends `Case` entries to the `cases` array and relies on these two helpers.

- [ ] **Step 1: Widen the `Case` type and make `selfTest` async**

In `src/selftest.ts`, replace the `Case` type declaration:

```ts
type Case = [name: string, run: () => string | null | Promise<string | null>] // null = pass, string = failure detail
```

and replace the `selfTest` function at the bottom of the file:

```ts
export async function selfTest(): Promise<SelfTestResult[]> {
  const out: SelfTestResult[] = []
  for (const [name, run] of cases) {
    try {
      const detail = await run()
      out.push({ name, pass: detail === null, detail: detail ?? 'ok' })
    } catch (e) {
      out.push({ name, pass: false, detail: `threw: ${(e as Error).message}` })
    }
  }
  return out
}
```

Cases run sequentially, not with `Promise.all`: they share `globalThis.fetch` and `globalThis.localStorage`, and concurrent stubbing would make failures depend on scheduling.

- [ ] **Step 2: Await it at both call sites**

`src/main.ts`, replace line 10:

```ts
  const results = await selfTest()
```

`scripts/selftest.ts`, replace line 3:

```ts
const results = await selfTest()
```

- [ ] **Step 3: Run the existing suite to confirm nothing regressed**

Run: `npm run selftest`
Expected: the same nine `PASS` lines and `9/9`, exit 0.

Run: `npx tsc --noEmit && echo TSC_CLEAN`
Expected: `TSC_CLEAN`.

- [ ] **Step 4: Add the fetch stub helper**

Append to `src/selftest.ts`, above the `cases` array:

```ts
export type StubResponse = { status?: number; body?: unknown }
export type FetchCall = { url: string; method: string; headers: Record<string, string>; body: unknown }

/** Swaps globalThis.fetch. Responses are consumed in order; the last one repeats. */
function stubFetch(responses: StubResponse[]): { calls: FetchCall[]; restore: () => void } {
  const real = globalThis.fetch
  const calls: FetchCall[] = []
  let i = 0
  const fake = (input: unknown, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    })
    const r = responses[Math.min(i++, responses.length - 1)] ?? {}
    const status = r.status ?? 200
    if (status === 204) return Promise.resolve(new Response(null, { status }))
    return Promise.resolve(new Response(JSON.stringify(r.body ?? {}), {
      status,
      headers: { 'content-type': 'application/json' },
    }))
  }
  // why: the stub matches fetch's runtime contract, not its full overloaded type
  globalThis.fetch = fake as unknown as typeof fetch
  return { calls, restore: () => { globalThis.fetch = real } }
}
```

- [ ] **Step 5: Add the localStorage stub helper**

Node runs the selftest without `localStorage`, so `state.ts` cases must install one. Append below `stubFetch`:

```ts
/** In-memory localStorage. Node has none; the browser's must not be touched by a test. */
function stubStorage(): { restore: () => void } {
  const had = 'localStorage' in globalThis
  const real = had ? globalThis.localStorage : undefined
  const map = new Map<string, string>()
  const fake = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  }
  // why: a Map-backed shim implements the Storage surface these tests use, not its index signature
  Object.defineProperty(globalThis, 'localStorage', { value: fake as unknown as Storage, configurable: true, writable: true })
  return {
    restore: () => {
      if (had) Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true })
      else Reflect.deleteProperty(globalThis as object, 'localStorage')
    },
  }
}
```

- [ ] **Step 6: Prove the helpers work with one throwaway async case**

Add as the last entry of `cases`:

```ts
  ['harness: async cases, fetch and storage stubs', async () => {
    const f = stubFetch([{ body: { ok: 1 } }])
    try {
      const res = await fetch('https://example.test/x', { method: 'POST', body: JSON.stringify({ a: 2 }) })
      const json = await res.json() as { ok: number }
      if (json.ok !== 1) return `stub body: ${JSON.stringify(json)}`
      if (f.calls.length !== 1) return `calls: ${f.calls.length}`
      if (f.calls[0]?.method !== 'POST') return `method: ${f.calls[0]?.method}`
      if ((f.calls[0]?.body as { a: number } | null)?.a !== 2) return `captured body: ${JSON.stringify(f.calls[0]?.body)}`
    } finally { f.restore() }
    const s = stubStorage()
    try {
      localStorage.setItem('k', 'v')
      if (localStorage.getItem('k') !== 'v') return 'storage stub did not round-trip'
    } finally { s.restore() }
    return null
  }],
```

- [ ] **Step 7: Run and confirm 10/10**

Run: `npm run selftest`
Expected: ten `PASS` lines ending `10/10`, exit 0.

Run: `npx tsc --noEmit && echo TSC_CLEAN`
Expected: `TSC_CLEAN`.

- [ ] **Step 8: Commit**

```bash
git add src/selftest.ts src/main.ts scripts/selftest.ts
git commit -m "stage 02: async selfTest, fetch and storage stubs"
```

---

### Task 2: `categories.ts` — tables, `sanitize()`, `brighten()`, resolution

**Files:**
- Modify: `src/types.ts` (add `GoogleColor`)
- Modify: `src/categories.ts` (replace the stub body; `themeCss` stays throwing until Task 3)
- Modify: `src/selftest.ts` (three cases)

**Interfaces:**
- Consumes: `stubStorage`/`stubFetch` are not needed — this module is pure.
- Produces: `configure(prefs: Prefs): void`, `sanitize(raw: unknown): StoredCategory[]`, `categoryFor(colorId: string | undefined): StoredCategory`, `fallback(): StoredCategory`, `all(): StoredCategory[]`, `brighten(hex: string): string`, `GOOGLE_COLORS: readonly GoogleColor[]`. Task 7's `state.eventsForMonth` calls `categoryFor`; Task 9's `state.createEvent` calls `all()` to map a category name to a `colorId`.

- [ ] **Step 1: Add the `GoogleColor` type**

In `src/types.ts`, directly above the `// ---------- Prefs` banner:

```ts
/** One of Google's 11 event colours. `hex` is Google's own paint, used as the
 *  light-mode colour of any category with no `displayHex`. */
export type GoogleColor = { id: string; name: string; hex: string }
```

- [ ] **Step 2: Write the three failing tests**

Append to the `cases` array in `src/selftest.ts` (before the harness case is fine; order does not matter):

```ts
  ['categories: sanitize rejects the malformed', () => {
    if (sanitize(null).length !== 0) return 'null was not rejected'
    if (sanitize({ name: 'x' }).length !== 0) return 'non-array object was not rejected'
    const rows = sanitize([
      { name: 'work', label: 'Work', colorId: '9' },              // keep
      { label: 'No name', colorId: '1' },                          // drop: no name
      { name: 'blank', label: '', colorId: '2' },                  // drop: empty label
      { name: 'bad', label: 'Bad', colorId: '12' },                // drop: colorId out of range
      { name: 'alsobad', label: 'Also', colorId: 9 },              // drop: colorId not a string
      { name: 'work', label: 'Dup name', colorId: '3' },           // drop: duplicate name
      { name: 'dupcolor', label: 'Dup colour', colorId: '9' },     // drop: duplicate colorId
      { name: 'hexbad', label: 'Hex', colorId: '4', displayHex: 'red' },   // keep, field dropped
      { name: 'hexok', label: 'Hex OK', colorId: '5', displayHex: '#ABCDEF' }, // keep, field kept
    ])
    const got = rows.map(r => r.name).join(',')
    if (got !== 'work,hexbad,hexok') return `kept: ${got}`
    if ('displayHex' in rows[1]!) return 'invalid displayHex was kept'
    if (rows[2]?.displayHex !== '#ABCDEF') return `valid displayHex: ${rows[2]?.displayHex}`
    const many = sanitize(Array.from({ length: 20 }, (_, i) => ({ name: `n${i}`, label: `L${i}`, colorId: String((i % 11) + 1) })))
    if (many.length !== 11) return `cap: ${many.length}`
    return null
  }],

  ['categories: brighten floors lightness, caps saturation', () => {
    // Independent HSL measurement — the oracle, not the algorithm under test.
    const measure = (hex: string): { h: number; s: number; l: number } => {
      const n = parseInt(hex.slice(1), 16)
      const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
      if (d === 0) return { h: 0, s: 0, l }
      const s = d / (1 - Math.abs(2 * l - 1))
      const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
      return { h: h * 60, s, l }
    }
    const probes = ['#3056D3', '#17925A', '#D97706', '#64748B', '#000000', '#FFFFFF', '#7986CB', '#D50000']
    for (const p of probes) {
      const out = brighten(p)
      if (!/^#[0-9A-F]{6}$/.test(out)) return `${p} -> ${out} is not a 6-digit hex`
      const m = measure(out)
      if (m.l < 0.62 - 1e-3) return `${p} -> ${out} lightness ${m.l.toFixed(3)} below floor`
      if (m.s > 0.72 + 1e-3) return `${p} -> ${out} saturation ${m.s.toFixed(3)} above cap`
      const src = measure(p)
      if (src.s > 0.01 && Math.abs(((m.h - src.h + 540) % 360) - 180) > 2) return `${p} -> ${out} hue moved ${src.h.toFixed(1)} -> ${m.h.toFixed(1)}`
      if (brighten(out) !== out) return `${p} not idempotent: ${out} -> ${brighten(out)}`
    }
    return null
  }],

  ['categories: resolution, fallback and seed substitution', () => {
    configure({})
    if (all().map(c => c.name).join(',') !== 'work,personal,financial,other') return `seed: ${all().map(c => c.name).join(',')}`
    if (categoryFor('9').name !== 'work') return `colorId 9 -> ${categoryFor('9').name}`
    if (categoryFor('1').name !== 'other') return `unknown colorId -> ${categoryFor('1').name}`
    if (categoryFor(undefined).name !== 'other') return `absent colorId -> ${categoryFor(undefined).name}`
    // A blob that sanitizes to nothing must not leave zero categories.
    configure({ categories: [{ name: '', label: '', colorId: '99' }] as unknown as StoredCategory[] })
    if (all().length !== 4) return `empty blob did not fall back to seed: ${all().length}`
    // A fallbackCategory naming a category that is not present falls back to the first.
    configure({ categories: [{ name: 'solo', label: 'Solo', colorId: '7' }], fallbackCategory: 'ghost' })
    if (fallback().name !== 'solo') return `dangling fallback -> ${fallback().name}`
    if (categoryFor('9').name !== 'solo') return `unknown colorId under one category -> ${categoryFor('9').name}`
    configure({})
    return null
  }],
```

Add the import at the top of `src/selftest.ts`:

```ts
import { all, brighten, categoryFor, configure, fallback, sanitize } from './categories.ts'
import type { StoredCategory } from './types.ts'
```

(`StoredCategory` joins the existing `import type { DayNumber } from './types.ts'` line rather than duplicating it.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run selftest`
Expected: FAIL on all three new cases with `threw: STAGE 02: not implemented`, total `10/13`.

- [ ] **Step 4: Implement the tables and pure functions**

Replace the whole of `src/categories.ts` except the `themeCss` stub:

```ts
// STAGE 02 — category resolution, Google colour table, moods, themeCss(). DOM-free; never imports state.ts.
import type { GoogleColor, MoodId, Prefs, StoredCategory } from './types.ts'

// ---------- Tables ----------

/** Google's 11 event colours. Transcribed from Google's palette; confirmed at the gate
 *  by opening created events in the Google Calendar app. */
export const GOOGLE_COLORS: readonly GoogleColor[] = [
  { id: '1', name: 'Lavender', hex: '#7986CB' },
  { id: '2', name: 'Sage', hex: '#33B679' },
  { id: '3', name: 'Grape', hex: '#8E24AA' },
  { id: '4', name: 'Flamingo', hex: '#E67C73' },
  { id: '5', name: 'Banana', hex: '#F6BF26' },
  { id: '6', name: 'Tangerine', hex: '#F4511E' },
  { id: '7', name: 'Peacock', hex: '#039BE5' },
  { id: '8', name: 'Graphite', hex: '#616161' },
  { id: '9', name: 'Blueberry', hex: '#3F51B5' },
  { id: '10', name: 'Basil', hex: '#0B8043' },
  { id: '11', name: 'Tomato', hex: '#D50000' },
]

const GOOGLE_HEX = new Map(GOOGLE_COLORS.map(c => [c.id, c.hex]))

const OTHER: StoredCategory = { name: 'other', label: 'Other', colorId: '8', displayHex: '#64748B' }

/** Frozen: existing events in the user's calendar already carry these colorIds. */
const SEED: readonly StoredCategory[] = [
  { name: 'work', label: 'Work', colorId: '9', displayHex: '#3056D3' },
  { name: 'personal', label: 'Personal', colorId: '10', displayHex: '#17925A' },
  { name: 'financial', label: 'Financial', colorId: '5', displayHex: '#D97706' },
  OTHER,
]

/** Hand-picked dark twins, keyed on the LIGHT hex rather than on category identity,
 *  so they survive a rename or a colorId change and a hand-picked #3056D3 gets the good twin. */
const TWINS = new Map([
  ['#3056D3', '#7B96FF'],
  ['#17925A', '#4FC48D'],
  ['#D97706', '#F0A13C'],
  ['#64748B', '#94A3B8'],
])

// ---------- Colour maths ----------

function toRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase()
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1))
  const m = l - c / 2
  const seg = Math.floor(h * 6) % 6
  const rgb: [number, number, number] =
    seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x] :
    seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x]
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m]
}

/** HSL brighten: lightness floor 0.62, saturation cap 0.72. Dark twin of any hex. */
export function brighten(hex: string): string {
  const [r, g, b] = toRgb(hex)
  const [h, s, l] = toHsl(r, g, b)
  const [nr, ng, nb] = fromHsl(h, Math.min(s, 0.72), Math.max(l, 0.62))
  return toHex(nr, ng, nb)
}

// ---------- Loading ----------

const HEX_RE = /^#[0-9a-f]{6}$/i
const COLOR_ID_RE = /^(?:[1-9]|1[01])$/

/** Untrusted-blob loader: drops invalid rows, dedupes name and colorId, caps at 11, first writer wins. */
export function sanitize(raw: unknown): StoredCategory[] {
  if (!Array.isArray(raw)) return []
  const out: StoredCategory[] = []
  const names = new Set<string>()
  const colorIds = new Set<string>()
  for (const row of raw) {
    if (out.length === 11) break
    if (typeof row !== 'object' || row === null) continue
    const r = row as Record<string, unknown>
    const { name, label, colorId, displayHex } = r
    if (typeof name !== 'string' || name === '') continue
    if (typeof label !== 'string' || label === '') continue
    if (typeof colorId !== 'string' || !COLOR_ID_RE.test(colorId)) continue
    if (names.has(name) || colorIds.has(colorId)) continue
    names.add(name)
    colorIds.add(colorId)
    // The two branches are required by exactOptionalPropertyTypes: `displayHex: undefined`
    // is not assignable to an optional property.
    out.push(typeof displayHex === 'string' && HEX_RE.test(displayHex)
      ? { name, label, colorId, displayHex }
      : { name, label, colorId })
  }
  return out
}

// ---------- Resolution ----------

let cats: StoredCategory[] = SEED.slice()
let fallbackName = 'other'
let byColorId = new Map<string, StoredCategory>()

function reindex(): void {
  byColorId = new Map(cats.map(c => [c.colorId, c]))
}
reindex()

/** main.ts pushes prefs in; this module never reads storage. */
export function configure(prefs: Prefs): void {
  const clean = sanitize(prefs.categories)
  cats = clean.length > 0 ? clean : SEED.slice()
  const want = prefs.fallbackCategory ?? 'other'
  fallbackName = cats.some(c => c.name === want) ? want : (cats[0]?.name ?? 'other')
  reindex()
}

export function categoryFor(colorId: string | undefined): StoredCategory {
  return (colorId === undefined ? undefined : byColorId.get(colorId)) ?? fallback()
}

export function fallback(): StoredCategory {
  return cats.find(c => c.name === fallbackName) ?? cats[0] ?? OTHER
}

export function all(): StoredCategory[] {
  return cats.slice()
}

/** [data-cat] rules, --cat-<name> properties, mood tokens. main.ts owns the <style>. */
export function themeCss(_mood: MoodId): string { throw new Error('STAGE 02: not implemented') }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run selftest`
Expected: `13/13`.

Run: `npx tsc --noEmit && echo TSC_CLEAN`
Expected: `TSC_CLEAN`.

- [ ] **Step 6: Commit**

```bash
git add src/categories.ts src/types.ts src/selftest.ts
git commit -m "stage 02: category tables, sanitize, brighten, resolution"
```

---

### Task 3: `categories.ts` — `themeCss()`

**Files:**
- Modify: `src/categories.ts` (replace the `themeCss` stub; add `MOODS`, `lightOf`, `darkOf`)
- Modify: `src/selftest.ts` (one case)

**Interfaces:**
- Consumes: `all()`, `brighten()`, `GOOGLE_COLORS` from Task 2.
- Produces: `themeCss(mood: MoodId): string`. Task 10's `main.ts` writes the result into one `<style>` element.

- [ ] **Step 1: Write the failing test**

Append to `cases` in `src/selftest.ts`:

```ts
  ['categories: themeCss emits both schemes and data-cat rules', () => {
    configure({})
    const css = themeCss('warm')
    for (const need of [
      '--cat-work: #3056D3',
      '--cat-other: #64748B',
      '@media (prefers-color-scheme: dark)',
      '--cat-work: #7B96FF',          // curated twin, not brighten()
      '--cat-personal: #4FC48D',
      '[data-cat="work"] { --cat: var(--cat-work); }',
      '--surface:',
    ]) if (!css.includes(need)) return `missing: ${need}`
    // Mood values are stage 03: every id resolves to warm for now, and none of them throws.
    for (const m of ['warm', 'paper', 'cool', 'sage', 'dusk'] as MoodId[]) {
      if (themeCss(m) !== css) return `mood ${m} differs from warm before stage 03 fills MOODS`
    }
    // A non-seed colour with no displayHex takes Google's hex light and a derived twin dark.
    configure({ categories: [{ name: 'solo', label: 'Solo', colorId: '3' }], fallbackCategory: 'solo' })
    const solo = themeCss('warm')
    if (!solo.includes('--cat-solo: #8E24AA')) return 'non-seed light colour is not Google hex'
    if (!solo.includes(`--cat-solo: ${brighten('#8E24AA')}`)) return 'non-seed dark colour is not brighten(light)'
    // A displayHex override wins over the colorId's Google hex in both schemes.
    configure({ categories: [{ name: 'solo', label: 'Solo', colorId: '3', displayHex: '#112233' }], fallbackCategory: 'solo' })
    const over = themeCss('warm')
    if (!over.includes('--cat-solo: #112233')) return 'displayHex did not override light'
    if (!over.includes(`--cat-solo: ${brighten('#112233')}`)) return 'displayHex did not override dark'
    configure({})
    return null
  }],
```

Extend the categories import in `src/selftest.ts` to include `themeCss`, and the `types.ts` type import to include `MoodId`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run selftest`
Expected: FAIL `categories: themeCss emits both schemes and data-cat rules — threw: STAGE 02: not implemented`, total `13/14`.

- [ ] **Step 3: Implement `themeCss`**

In `src/categories.ts`, add above the `themeCss` stub:

```ts
// ---------- Theme ----------

type MoodTokens = { surface: string; surfaceDark: string }

/** Values are stage 03's, from the design canvas that SPEC "Visual direction" defers to.
 *  Only warm exists in-repo (the seed paint in index.html); the other four ids resolve to
 *  it until stage 03 fills this table, and the four band tokens are not emitted at all.
 *  No palette is invented here. */
const MOODS: Partial<Record<MoodId, MoodTokens>> = {
  warm: { surface: '#f7f6f3', surfaceDark: '#0f1115' },
}

function lightOf(c: StoredCategory): string {
  return c.displayHex ?? GOOGLE_HEX.get(c.colorId) ?? OTHER.displayHex ?? '#64748B'
}

function darkOf(c: StoredCategory): string {
  const light = lightOf(c)
  return TWINS.get(light.toUpperCase()) ?? brighten(light)
}
```

and replace the stub with:

```ts
/** [data-cat] rules, --cat-<name> properties, mood tokens. main.ts owns the <style>. */
export function themeCss(mood: MoodId): string {
  const tokens = MOODS[mood] ?? MOODS.warm!
  const light = cats.map(c => `  --cat-${c.name}: ${lightOf(c)};`).join('\n')
  const dark = cats.map(c => `    --cat-${c.name}: ${darkOf(c)};`).join('\n')
  const rules = cats.map(c => `[data-cat="${c.name}"] { --cat: var(--cat-${c.name}); }`).join('\n')
  return [
    `:root {`,
    `  --surface: ${tokens.surface};`,
    light,
    `}`,
    `@media (prefers-color-scheme: dark) {`,
    `  :root {`,
    `    --surface: ${tokens.surfaceDark};`,
    dark,
    `  }`,
    `}`,
    rules,
    ``,
  ].join('\n')
}
```

`MOODS.warm!` is the one non-null assertion in this file and it is load-bearing: the table above always contains `warm`, and a `Partial<Record<...>>` is what lets stage 03 add the other four without touching this function.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run selftest`
Expected: `14/14`.

Run: `npx tsc --noEmit && echo TSC_CLEAN`
Expected: `TSC_CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add src/categories.ts src/selftest.ts
git commit -m "stage 02: themeCss, mood mechanism with warm-only table"
```

---

### Task 4: `gcal.ts` — request/retry, wire→internal, `listMonth`

Cases 1, 5, 6, 7-read, 8, 9 and 12 of the contract's 12-case list land here; Task 5 takes 2, 3, 4, 7-write, 10 and 11.

**Files:**
- Modify: `src/gcal.ts` (module head, `GcalError`, helpers, `listMonth`; the three write stubs stay throwing until Task 5)
- Modify: `src/selftest.ts` (seven cases)

**Interfaces:**
- Consumes: `stubFetch` from Task 1; `asDay`, `civilToDay`, `dayToCivil` from `dates.ts`.
- Produces: `GcalError` (fields `status: number`, `body: unknown`), `MAX_RESULTS`, `listMonth(key: MonthKey, token: string): Promise<StoredEvent[]>`. Task 8's `state.ensureMonthsFor` calls `listMonth` inside `withToken`; Task 8 also does `e instanceof GcalError && e.status === 401`.

- [ ] **Step 1: Write the seven failing tests**

Append to `cases` in `src/selftest.ts`:

```ts
  ['gcal: list query params and bearer token', async () => {
    const f = stubFetch([{ body: { items: [] } }])
    try {
      await listMonth('2026-02', 'tok-123')
      const call = f.calls[0]
      if (call === undefined) return 'no request was made'
      if (call.headers['authorization'] !== 'Bearer tok-123') return `auth header: ${call.headers['authorization']}`
      if (!call.url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events?')) return `url: ${call.url}`
      const q = new URL(call.url).searchParams
      if (q.get('singleEvents') !== 'true') return `singleEvents: ${q.get('singleEvents')}`
      if (q.get('orderBy') !== 'startTime') return `orderBy: ${q.get('orderBy')}`
      if (q.get('maxResults') !== String(MAX_RESULTS)) return `maxResults: ${q.get('maxResults')}`
      if (!q.get('timeMin')?.startsWith('2026-02-01T00:00:00')) return `timeMin: ${q.get('timeMin')}`
      if (!q.get('timeMax')?.startsWith('2026-03-01T00:00:00')) return `timeMax: ${q.get('timeMax')}`
      if (!/[+-]\d{2}:\d{2}$/.test(q.get('timeMin') ?? '')) return `timeMin carries no local offset: ${q.get('timeMin')}`
      // December must roll the window into the next year.
      f.calls.length = 0
      await listMonth('2026-12', 'tok-123')
      const dec = new URL(f.calls[0]?.url ?? '').searchParams
      if (!dec.get('timeMax')?.startsWith('2027-01-01T00:00:00')) return `December timeMax: ${dec.get('timeMax')}`
    } finally { f.restore() }
    return null
  }],

  ['gcal: all-day read converts exclusive end to inclusive', async () => {
    const f = stubFetch([{ body: { items: [
      { id: 'a', summary: 'Trip', start: { date: '2026-02-20' }, end: { date: '2026-02-23' } },
      { id: 'b', summary: 'One day', start: { date: '2026-02-25' }, end: { date: '2026-02-26' } },
    ] } }])
    try {
      const evs = await listMonth('2026-02', 't')
      const a = evs[0], b = evs[1]
      if (a?.allDay !== true) return 'all-day event did not map to allDay: true'
      if (a.start !== civilToDay(2026, 2, 20)) return `start: ${a.start}`
      if (a.end !== civilToDay(2026, 2, 22)) return `3-day event end should be the 22nd inclusive, got day ${a.end}`
      if (b?.start !== civilToDay(2026, 2, 25) || b.end !== civilToDay(2026, 2, 25)) return 'single all-day did not collapse to one day'
      if (a.title !== 'Trip') return `title: ${a.title}`
    } finally { f.restore() }
    return null
  }],

  ['gcal: timed read maps to civil day and minutes', async () => {
    // Built from local Date objects, so the assertion holds in any time zone.
    const iso = (y: number, m: number, d: number, hh: number, mm: number) => new Date(y, m - 1, d, hh, mm).toISOString()
    const f = stubFetch([{ body: { items: [
      { id: 'a', summary: 'Standup', start: { dateTime: iso(2026, 2, 20, 9, 30) }, end: { dateTime: iso(2026, 2, 20, 10, 45) } },
      { id: 'b', summary: 'Late', start: { dateTime: iso(2026, 2, 20, 22, 0) }, end: { dateTime: iso(2026, 2, 21, 0, 30) } },
    ] } }])
    try {
      const evs = await listMonth('2026-02', 't')
      const a = evs[0], b = evs[1]
      if (a?.allDay !== false) return 'timed event did not map to allDay: false'
      if (a.start !== civilToDay(2026, 2, 20) || a.end !== civilToDay(2026, 2, 20)) return `day: ${a.start}..${a.end}`
      if (a.startMin !== 570 || a.endMin !== 645) return `minutes: ${a.startMin}..${a.endMin}`
      if (b?.allDay !== false) return 'midnight-crossing event did not map to allDay: false'
      if (b.start !== civilToDay(2026, 2, 20) || b.end !== civilToDay(2026, 2, 21)) return `crossing day: ${b.start}..${b.end}`
      if (b.startMin !== 1320 || b.endMin !== 30) return `crossing minutes: ${b.startMin}..${b.endMin}`
    } finally { f.restore() }
    return null
  }],

  ['gcal: cancelled events are dropped', async () => {
    const f = stubFetch([{ body: { items: [
      { id: 'a', summary: 'Live', start: { date: '2026-02-20' }, end: { date: '2026-02-21' } },
      { id: 'b', status: 'cancelled', summary: 'Gone', start: { date: '2026-02-21' }, end: { date: '2026-02-22' } },
      { id: 'c', status: 'confirmed', summary: 'Also live', start: { date: '2026-02-22' }, end: { date: '2026-02-23' } },
    ] } }])
    try {
      const ids = (await listMonth('2026-02', 't')).map(e => e.id).join(',')
      if (ids !== 'a,c') return `kept: ${ids}`
    } finally { f.restore() }
    return null
  }],

  ['gcal: colorId, notes and recurringEventId pass through', async () => {
    const f = stubFetch([{ body: { items: [
      { id: 'a', summary: 'Coloured', colorId: '9', description: 'note text', recurringEventId: 'series-1', start: { date: '2026-02-20' }, end: { date: '2026-02-21' } },
      { id: 'b', summary: 'Plain', start: { date: '2026-02-21' }, end: { date: '2026-02-22' } },
    ] } }])
    try {
      const evs = await listMonth('2026-02', 't')
      if (evs[0]?.colorId !== '9') return `colorId: ${evs[0]?.colorId}`
      if (evs[0]?.notes !== 'note text') return `notes: ${evs[0]?.notes}`
      if (evs[0]?.recurringEventId !== 'series-1') return `recurringEventId: ${evs[0]?.recurringEventId}`
      if ('colorId' in evs[1]!) return 'absent colorId was invented'
      if ('category' in evs[1]!) return 'gcal resolved a category; that is state.ts’s job'
    } finally { f.restore() }
    return null
  }],

  ['gcal: pagination follows nextPageToken and is capped', async () => {
    const f = stubFetch([
      { body: { items: [{ id: 'a', start: { date: '2026-02-01' }, end: { date: '2026-02-02' } }], nextPageToken: 'P2' } },
      { body: { items: [{ id: 'b', start: { date: '2026-02-02' }, end: { date: '2026-02-03' } }] } },
    ])
    try {
      const evs = await listMonth('2026-02', 't')
      if (evs.map(e => e.id).join(',') !== 'a,b') return `pages not concatenated: ${evs.map(e => e.id).join(',')}`
      if (f.calls.length !== 2) return `calls: ${f.calls.length}`
      if (new URL(f.calls[1]?.url ?? '').searchParams.get('pageToken') !== 'P2') return 'second request carried no pageToken'
      if (new URL(f.calls[0]?.url ?? '').searchParams.has('pageToken')) return 'first request carried a pageToken'
    } finally { f.restore() }
    // A stub that never stops paging must fail, not hang.
    const loop = stubFetch([{ body: { items: [], nextPageToken: 'SAME' } }])
    try {
      await listMonth('2026-02', 't')
      return 'an endless nextPageToken did not throw'
    } catch (e) {
      if (!(e instanceof GcalError)) return `wrong error: ${(e as Error).message}`
      if (loop.calls.length > 20) return `page cap did not hold: ${loop.calls.length} calls`
    } finally { loop.restore() }
    return null
  }],

  ['gcal: retries rate limits and 5xx once, never a permissions 403', async () => {
    const rateLimit = { error: { errors: [{ reason: 'rateLimitExceeded' }] } }
    const forbidden = { error: { errors: [{ reason: 'insufficientPermissions' }] } }
    const ok = { items: [] }
    for (const [label, first] of [
      ['500', { status: 500, body: {} }],
      ['429', { status: 429, body: {} }],
      ['403 rate limit', { status: 403, body: rateLimit }],
    ] as const) {
      const f = stubFetch([first, { body: ok }])
      try {
        await listMonth('2026-02', 't')
        if (f.calls.length !== 2) return `${label}: expected one retry, saw ${f.calls.length} calls`
      } catch (e) { return `${label}: threw ${(e as Error).message}` } finally { f.restore() }
    }
    const perm = stubFetch([{ status: 403, body: forbidden }, { body: ok }])
    try {
      await listMonth('2026-02', 't')
      return 'a permissions 403 did not surface'
    } catch (e) {
      if (!(e instanceof GcalError) || e.status !== 403) return `wrong error: ${(e as Error).message}`
      if (perm.calls.length !== 1) return `a permissions 403 was retried: ${perm.calls.length} calls`
    } finally { perm.restore() }
    const twice = stubFetch([{ status: 503, body: {} }])
    try {
      await listMonth('2026-02', 't')
      return 'a repeated 5xx did not surface'
    } catch (e) {
      if (!(e instanceof GcalError) || e.status !== 503) return `wrong error: ${(e as Error).message}`
      if (twice.calls.length !== 2) return `expected exactly one retry, saw ${twice.calls.length} calls`
    } finally { twice.restore() }
    return null
  }],
```

Add to the imports at the top of `src/selftest.ts`:

```ts
import { GcalError, listMonth, MAX_RESULTS } from './gcal.ts'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run selftest`
Expected: seven FAILs, each `threw: STAGE 02: not implemented`, total `14/21`.

- [ ] **Step 3: Implement the module head, helpers and `listMonth`**

Replace `src/gcal.ts` with (the three write functions stay as throwing stubs; Task 5 fills them):

```ts
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

/** Changed fields only. A change to dates must carry allDay, start and end together;
 *  state.ts passes the whole draft, so that holds by construction. */
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

const E = () => new Error('STAGE 02: not implemented')
export function createEvent(_draft: EventDraft, _colorId: string, _token: string): Promise<StoredEvent> { throw E() }
export function updateEvent(_id: string, _changes: Partial<EventDraft>, _colorId: string | undefined, _token: string): Promise<StoredEvent> { throw E() }
export function deleteEvent(_id: string, _token: string): Promise<void> { throw E() }
```

`toWire` and `RRULE` are unused until Task 5; `tsc` does not flag unused module-scope functions, so this compiles clean.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run selftest`
Expected: `21/21`. The retry case adds roughly 2.5s to the run.

Run: `npx tsc --noEmit && echo TSC_CLEAN`
Expected: `TSC_CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add src/gcal.ts src/selftest.ts
git commit -m "stage 02: gcal read path, retry policy, pagination"
```

---

### Task 5: `gcal.ts` — `createEvent`, `updateEvent`, `deleteEvent`

Cases 2, 3, 4, 7-write, 10 and 11 of the 12-case list. With Task 4 that is all twelve.

**Files:**
- Modify: `src/gcal.ts` (replace the three throwing stubs)
- Modify: `src/selftest.ts` (five cases)

**Interfaces:**
- Consumes: `toWire`, `fromWire`, `request`, `GcalError` from Task 4.
- Produces: `createEvent(draft: EventDraft, colorId: string, token: string): Promise<StoredEvent>`, `updateEvent(id: string, changes: Partial<EventDraft>, colorId: string | undefined, token: string): Promise<StoredEvent>`, `deleteEvent(id: string, token: string): Promise<void>`. Task 9's `state` writes call all three; `state` picks the id, so `WriteScope` never arrives here.

- [ ] **Step 1: Write the five failing tests**

Append to `cases` in `src/selftest.ts`:

```ts
  ['gcal: create sends an exclusive end, the colorId and one RRULE', async () => {
    const f = stubFetch([{ body: { id: 'new-1', summary: 'Trip', colorId: '9', start: { date: '2026-02-20' }, end: { date: '2026-02-23' } } }])
    try {
      await gcalCreate({
        title: 'Trip', category: 'work', allDay: true,
        start: civilToDay(2026, 2, 20), end: civilToDay(2026, 2, 22), repeat: 'weekly',
      }, '9', 't')
      const call = f.calls[0]
      if (call?.method !== 'POST') return `method: ${call?.method}`
      if (!call.url.endsWith('/calendars/primary/events')) return `url: ${call.url}`
      if (call.headers['content-type'] !== 'application/json') return `content-type: ${call.headers['content-type']}`
      const b = call.body as { summary?: string; colorId?: string; start?: { date?: string }; end?: { date?: string }; recurrence?: string[] }
      if (b.summary !== 'Trip') return `summary: ${b.summary}`
      if (b.colorId !== '9') return `colorId: ${b.colorId}`
      if (b.start?.date !== '2026-02-20') return `start.date: ${b.start?.date}`
      if (b.end?.date !== '2026-02-23') return `a 3-day event must go out as 20 -> 23 exclusive, got ${b.end?.date}`
      if (b.recurrence?.length !== 1 || b.recurrence[0] !== 'RRULE:FREQ=WEEKLY') return `recurrence: ${JSON.stringify(b.recurrence)}`
    } finally { f.restore() }
    const none = stubFetch([{ body: { id: 'n', start: { date: '2026-02-20' }, end: { date: '2026-02-21' } } }])
    try {
      await gcalCreate({ title: 'x', category: 'work', allDay: true, start: civilToDay(2026, 2, 20), end: civilToDay(2026, 2, 20), repeat: 'none' }, '9', 't')
      if ('recurrence' in (none.calls[0]?.body as object)) return 'repeat "none" still sent a recurrence'
    } finally { none.restore() }
    return null
  }],

  ['gcal: create timed sends local dateTime with a timeZone', async () => {
    const f = stubFetch([{ body: { id: 'n', start: { dateTime: new Date(2026, 1, 20, 9, 30).toISOString() }, end: { dateTime: new Date(2026, 1, 20, 10, 45).toISOString() } } }])
    try {
      await gcalCreate({
        title: 'Standup', category: 'work', allDay: false,
        start: civilToDay(2026, 2, 20), end: civilToDay(2026, 2, 20),
        startMin: 570, endMin: 645, repeat: 'none',
      }, '9', 't')
      const b = f.calls[0]?.body as { start?: { dateTime?: string; timeZone?: string }; end?: { dateTime?: string } }
      if (!b.start?.dateTime?.startsWith('2026-02-20T09:30:00')) return `start.dateTime: ${b.start?.dateTime}`
      if (!/[+-]\d{2}:\d{2}$/.test(b.start.dateTime)) return `start.dateTime carries no local offset: ${b.start.dateTime}`
      if (!b.end?.dateTime?.startsWith('2026-02-20T10:45:00')) return `end.dateTime: ${b.end?.dateTime}`
      if (b.start.timeZone === undefined || b.start.timeZone === '') return 'no timeZone sent'
      if ('date' in b.start) return 'a timed event sent a date field'
    } finally { f.restore() }
    return null
  }],

  ['gcal: all-day round-trip identity', async () => {
    // Draft -> wire -> back must land on exactly the DayNumbers it started with.
    const start = civilToDay(2026, 2, 20), end = civilToDay(2026, 2, 22)
    const f = stubFetch([{ body: { id: 'rt', summary: 'Trip', colorId: '9', start: { date: '2026-02-20' }, end: { date: '2026-02-23' } } }])
    try {
      const back = await gcalCreate({ title: 'Trip', category: 'work', allDay: true, start, end, repeat: 'none' }, '9', 't')
      if (back.allDay !== true) return 'round-trip lost allDay'
      if (back.start !== start) return `start ${back.start} !== ${start}`
      if (back.end !== end) return `end ${back.end} !== ${end} — the exclusive/inclusive conversion is not symmetric`
      if (back.id !== 'rt') return `id: ${back.id}`
      if (back.colorId !== '9') return `colorId: ${back.colorId}`
    } finally { f.restore() }
    return null
  }],

  ['gcal: update PATCHes changed fields onto the id it is given', async () => {
    const f = stubFetch([{ body: { id: 'inst-9', summary: 'Renamed', start: { date: '2026-02-20' }, end: { date: '2026-02-21' } } }])
    try {
      await gcalUpdate('inst-9', { title: 'Renamed' }, undefined, 't')
      const call = f.calls[0]
      if (call?.method !== 'PATCH') return `method: ${call?.method}`
      if (!call.url.endsWith('/calendars/primary/events/inst-9')) return `url: ${call.url}`
      const b = call.body as Record<string, unknown>
      if (b['summary'] !== 'Renamed') return `summary: ${String(b['summary'])}`
      if ('start' in b || 'end' in b) return 'a title-only change sent dates'
      if ('colorId' in b) return 'an undefined colorId was sent'
    } finally { f.restore() }
    // The caller chooses the id; a series edit is the same call against the series id.
    const s = stubFetch([{ body: { id: 'series-1', summary: 'S', start: { date: '2026-02-20' }, end: { date: '2026-02-21' } } }])
    try {
      await gcalUpdate('series-1', { title: 'S' }, '5', 't')
      if (!(s.calls[0]?.url ?? '').endsWith('/events/series-1')) return `series url: ${s.calls[0]?.url}`
      if ((s.calls[0]?.body as Record<string, unknown>)['colorId'] !== '5') return 'colorId was not sent'
    } finally { s.restore() }
    return null
  }],

  ['gcal: delete targets the id it is given and tolerates 204', async () => {
    const f = stubFetch([{ status: 204 }])
    try {
      await gcalDelete('inst-9', 't')
      if (f.calls[0]?.method !== 'DELETE') return `method: ${f.calls[0]?.method}`
      if (!(f.calls[0]?.url ?? '').endsWith('/calendars/primary/events/inst-9')) return `url: ${f.calls[0]?.url}`
    } catch (e) { return `204 was not tolerated: ${(e as Error).message}` } finally { f.restore() }
    const s = stubFetch([{ status: 204 }])
    try {
      await gcalDelete('series-1', 't')
      if (!(s.calls[0]?.url ?? '').endsWith('/events/series-1')) return `series url: ${s.calls[0]?.url}`
    } finally { s.restore() }
    const gone = stubFetch([{ status: 404, body: { error: { errors: [{ reason: 'notFound' }] } } }])
    try {
      await gcalDelete('missing', 't')
      return 'a 404 delete did not throw'
    } catch (e) {
      if (!(e instanceof GcalError) || e.status !== 404) return `wrong error: ${(e as Error).message}`
      if (gone.calls.length !== 1) return `a 404 was retried: ${gone.calls.length} calls`
    } finally { gone.restore() }
    return null
  }],
```

Extend the `gcal.ts` import in `src/selftest.ts` to:

```ts
import {
  createEvent as gcalCreate, deleteEvent as gcalDelete, updateEvent as gcalUpdate,
  GcalError, listMonth, MAX_RESULTS,
} from './gcal.ts'
```

The three writes are aliased because `state.ts` exports the same three names, which Task 9 imports into this file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run selftest`
Expected: five FAILs with `threw: STAGE 02: not implemented`, total `21/26`.

- [ ] **Step 3: Implement the three writes**

In `src/gcal.ts`, replace the `const E = () => ...` line and the three stubs with:

```ts
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
```

Remove `EventDraft` from the type-only import if `tsc` reports it unused — it is still used by both signatures, so it stays.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run selftest`
Expected: `26/26`.

Run: `npx tsc --noEmit && echo TSC_CLEAN`
Expected: `TSC_CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add src/gcal.ts src/selftest.ts
git commit -m "stage 02: gcal write path, exclusive end conversion, id-chosen scope"
```

---

### Task 6: `auth.ts` — GIS token client

**Files:**
- Modify: `src/auth.ts` (replace the stubs)
- Modify: `src/selftest.ts` (a `stubGis` helper and three cases)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `getToken(forceRefresh?: boolean): Promise<string>`, `signIn(): Promise<void>`, `signOut(): Promise<void>`, `isSignedIn(): boolean`. **Exactly those four**, per SPEC "Auth" — `AuthError` stays module-private and tests identify it by `.name`, and there is no test-only reset export, so tests reset state by calling `signOut()`. Task 8's `withToken` keys only off `GcalError.status`, so nothing outside needs the class.

**Ruling to record:** `auth.ts` reads `globalThis.google`, which *is* `window.google` in a browser. DECISIONS says "polls `window.google`"; reading it through `globalThis` is the same binding and lets a node test install a fake without clobbering the page's real `window` during `/?selftest`.

- [ ] **Step 1: Add the GIS stub helper**

Append below `stubStorage` in `src/selftest.ts`:

```ts
type StubToken = { access_token?: string; expires_in?: number; error?: string }

/** Fake Google Identity Services. Installs globalThis.google, which is what auth.ts reads. */
function stubGis(replies: StubToken[]): { prompts: string[]; revoked: string[]; restore: () => void } {
  const prompts: string[] = []
  const revoked: string[] = []
  let i = 0
  const fake = {
    accounts: {
      oauth2: {
        initTokenClient: (cfg: { callback: (r: StubToken) => void }) => ({
          requestAccessToken: (req?: { prompt?: string }) => {
            prompts.push(req?.prompt ?? '<none>')
            cfg.callback(replies[Math.min(i++, replies.length - 1)] ?? { error: 'no reply configured' })
          },
        }),
        revoke: (t: string, done?: () => void) => { revoked.push(t); done?.() },
      },
    },
  }
  const had = 'google' in globalThis
  const real = had ? (globalThis as { google?: unknown }).google : undefined
  Object.defineProperty(globalThis, 'google', { value: fake, configurable: true, writable: true })
  return {
    prompts, revoked,
    restore: () => {
      if (had) Object.defineProperty(globalThis, 'google', { value: real, configurable: true, writable: true })
      else Reflect.deleteProperty(globalThis as object, 'google')
    },
  }
}
```

- [ ] **Step 2: Write the three failing tests**

Append to `cases`:

```ts
  ['auth: token is cached, renewals dedupe, force and expiry re-request', async () => {
    const g = stubGis([{ access_token: 'tok-1', expires_in: 3600 }, { access_token: 'tok-2', expires_in: 3600 }, { access_token: 'tok-3', expires_in: 3600 }])
    try {
      if (isSignedIn()) return 'signed in before any token was requested'
      const a = await getToken()
      if (a !== 'tok-1') return `first token: ${a}`
      if (!isSignedIn()) return 'isSignedIn false after a successful token'
      if (g.prompts.length !== 1) return `one request expected, saw ${g.prompts.length}`
      if (g.prompts[0] !== '') return `quiet renewal must send prompt '', sent '${g.prompts[0]}'`
      if (await getToken() !== 'tok-1') return 'a valid token was not served from cache'
      if (g.prompts.length !== 1) return `cached call still hit GIS: ${g.prompts.length} requests`
      if (await getToken(true) !== 'tok-2') return 'forceRefresh did not re-request'
      if (g.prompts.length !== 2) return `forceRefresh requests: ${g.prompts.length}`
      await signOut()
    } finally { g.restore() }
    // A token whose expires_in has already been consumed by the skew is re-requested.
    const short = stubGis([{ access_token: 'x-1', expires_in: 0 }, { access_token: 'x-2', expires_in: 3600 }])
    try {
      if (await getToken() !== 'x-1') return 'short-lived token was not returned'
      if (isSignedIn()) return 'a token inside the 60s skew still reads as signed in'
      if (await getToken() !== 'x-2') return 'an expired token was served from cache'
      await signOut()
    } finally { short.restore() }
    // Concurrent callers share one in-flight renewal rather than racing three popups.
    const dedupe = stubGis([{ access_token: 'd-1', expires_in: 3600 }])
    try {
      const [p, q, r] = await Promise.all([getToken(), getToken(), getToken()])
      if (p !== 'd-1' || q !== 'd-1' || r !== 'd-1') return `concurrent tokens: ${p}/${q}/${r}`
      if (dedupe.prompts.length !== 1) return `concurrent callers made ${dedupe.prompts.length} requests`
      await signOut()
    } finally { dedupe.restore() }
    return null
  }],

  ['auth: a failed renewal clears state and never escalates to a popup', async () => {
    const g = stubGis([{ error: 'access_denied' }, { access_token: 'later', expires_in: 3600 }])
    try {
      try {
        await getToken()
        return 'a failed renewal resolved'
      } catch (e) {
        if ((e as Error).name !== 'AuthError') return `wrong error: ${(e as Error).name}`
      }
      if (isSignedIn()) return 'isSignedIn true after a failed renewal'
      if (g.prompts.some(p => p !== '')) return `a failure escalated to a prompt: ${g.prompts.join(',')}`
      // The failure is not sticky: a later request (the user's click) can still succeed.
      if (await getToken() !== 'later') return 'a failed renewal poisoned the module'
      await signOut()
    } finally { g.restore() }
    return null
  }],

  ['auth: signOut revokes rather than only clearing', async () => {
    const g = stubGis([{ access_token: 'tok-r', expires_in: 3600 }])
    try {
      await getToken()
      await signOut()
      if (g.revoked.join(',') !== 'tok-r') return `revoked: ${g.revoked.join(',')}`
      if (isSignedIn()) return 'still signed in after signOut'
      await signOut()   // idempotent with no token held
      if (g.revoked.length !== 1) return `a second signOut revoked again: ${g.revoked.length}`
    } finally { g.restore() }
    return null
  }],
```

Add to the imports in `src/selftest.ts`:

```ts
import { getToken, isSignedIn, signOut } from './auth.ts'
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run selftest`
Expected: three FAILs with `threw: STAGE 02: not implemented`, total `26/29`.

- [ ] **Step 4: Implement `auth.ts`**

Replace `src/auth.ts` entirely:

```ts
// STAGE 02 — GIS token client. The ONLY file that knows about Google auth. Exports exactly these four.

type TokenResponse = { access_token?: string; expires_in?: number; error?: string; error_description?: string }
type TokenClient = { requestAccessToken: (o?: { prompt?: string }) => void }
type Gis = {
  accounts: {
    oauth2: {
      initTokenClient: (c: {
        client_id: string; scope: string
        callback: (r: TokenResponse) => void
        error_callback?: (e: { type?: string }) => void
      }) => TokenClient
      revoke: (token: string, done?: () => void) => void
    }
  }
}

const SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const POLL_MS = 50
const LOAD_TIMEOUT_MS = 10_000
/** A token never dies mid-request. */
const SKEW_MS = 60_000

/** Module-private: SPEC "Auth" says auth.ts exports exactly four names. Identified by `.name`. */
class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

let token: string | null = null
let expiresAt = 0
let pending: Promise<string> | null = null
let client: TokenClient | null = null
let settle: ((r: TokenResponse) => void) | null = null

/** globalThis.google IS window.google in a browser. Read inside the function, never at
 *  module scope, so this module survives `npm run selftest` under bare node. */
function gis(): Gis | undefined {
  return (globalThis as { google?: Gis }).google
}

async function whenReady(): Promise<Gis> {
  const deadline = Date.now() + LOAD_TIMEOUT_MS
  for (;;) {
    const g = gis()
    if (g !== undefined && g.accounts !== undefined && g.accounts.oauth2 !== undefined) return g
    if (Date.now() >= deadline) throw new AuthError('Google Identity Services did not load')
    await new Promise(r => setTimeout(r, POLL_MS))
  }
}

async function ensureClient(): Promise<TokenClient> {
  if (client !== null) return client
  const g = await whenReady()
  // import.meta.env is undefined under bare node; the optional chain is load-bearing.
  const clientId = (import.meta.env as { VITE_GOOGLE_CLIENT_ID?: string } | undefined)?.VITE_GOOGLE_CLIENT_ID
  if (clientId === undefined || clientId === '') throw new AuthError('VITE_GOOGLE_CLIENT_ID is not set')
  client = g.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: r => settle?.(r),
    error_callback: e => settle?.({ error: e.type ?? 'popup_failed' }),
  })
  return client
}

function request(prompt: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    ensureClient().then(c => {
      settle = r => {
        settle = null
        if (r.access_token === undefined) {
          token = null
          expiresAt = 0
          reject(new AuthError(r.error_description ?? r.error ?? 'token request failed'))
          return
        }
        token = r.access_token
        expiresAt = Date.now() + (r.expires_in ?? 3600) * 1000 - SKEW_MS
        resolve(token)
      }
      c.requestAccessToken({ prompt })
    }, reject)
  })
}

/** Cached while valid. A failed quiet renewal leaves isSignedIn() false and surfaces the
 *  reconnect pill; it never auto-escalates to a popup, which browsers block outside a gesture. */
export function getToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && token !== null && Date.now() < expiresAt) return Promise.resolve(token)
  if (pending !== null) return pending
  const p = request('').finally(() => { if (pending === p) pending = null })
  pending = p
  return p
}

/** Called from a click, so GIS may raise the account picker or the consent screen.
 *  The gesture is the only difference from a quiet renewal. */
export function signIn(): Promise<void> {
  return getToken(true).then(() => undefined)
}

/** Revokes, never only clears: a local clear would quiet-renew straight back in. */
export function signOut(): Promise<void> {
  const held = token
  token = null
  expiresAt = 0
  if (held === null) return Promise.resolve()
  return whenReady().then(g => new Promise<void>(resolve => { g.accounts.oauth2.revoke(held, () => resolve()) }))
}

export function isSignedIn(): boolean {
  return token !== null && Date.now() < expiresAt
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run selftest`
Expected: `29/29`.

Run: `npx tsc --noEmit && echo TSC_CLEAN`
Expected: `TSC_CLEAN`.

- [ ] **Step 6: Commit**

```bash
git add src/auth.ts src/selftest.ts
git commit -m "stage 02: GIS token client, quiet renewal, revoke on sign-out"
```

---

### Task 7: `state.ts` — persistence and reads

**Files:**
- Modify: `src/state.ts` (storage, `prefs`/`savePrefs`, `monthState`, `eventsForMonth`, `spansForWeek`, three test-only exports)
- Modify: `src/selftest.ts` (three cases)

**Interfaces:**
- Consumes: `categoryFor`, `all` from `categories.ts`; `stubStorage` from Task 1.
- Produces: `prefs(): Prefs`, `savePrefs(p: Prefs): void`, `monthState(key: MonthKey): MonthLoadState`, `eventsForMonth(key: MonthKey): CalendarEvent[]`, `spansForWeek(week: WeekIndex): EventSpan[]`, and the internal `resolve`, `monthsSpanned`, `ensureLoaded`, `saveCache`, `cache`, `pending` used by Tasks 8 and 9.

**Ruling to record:** `state.ts` gains `_resetForTest()`, `_flushForTest()` and (Task 8) `_settleForTest()`, extending stage-01 ruling 2. `auth.ts`'s "exports exactly" rule is a SPEC clause about `auth.ts` alone; `state.ts` already carries `_setAnchorForTest`.

**Ruling to record:** `state.ts` rolls back and **rethrows**; it does not toast. SPEC "Write orchestration" says "roll back, toast, rethrow", but `chrome.toast` is DOM-bearing and `state.ts` is in the node selftest graph, so importing it would break `npm run selftest`. The caller raises the toast. Stage 04 wires the form to it.

- [ ] **Step 1: Write the three failing tests**

Append to `cases` in `src/selftest.ts`:

```ts
  ['state: cache and prefs persist; a version mismatch discards', () => {
    const s = stubStorage()
    try {
      _resetForTest()
      savePrefs({ mood: 'cool', fallbackCategory: 'other' })
      _flushForTest()
      if (localStorage.getItem('bramwell.prefs.v1') === null) return 'prefs were not written'
      _resetForTest()
      if (prefs().mood !== 'cool') return `prefs did not survive a reload: ${JSON.stringify(prefs())}`
      // A cache blob of the wrong version is discarded, not trusted.
      localStorage.setItem('bramwell.cache.v1', JSON.stringify({ v: 99, months: { '2026-02': { state: 'ready', events: [{ id: 'x' }], fetchedAt: 1 } } }))
      _resetForTest()
      if (monthState('2026-02') !== 'absent') return `stale version survived: ${monthState('2026-02')}`
      // So is unparseable rubbish.
      localStorage.setItem('bramwell.cache.v1', '{not json')
      _resetForTest()
      if (monthState('2026-02') !== 'absent') return 'unparseable cache did not discard'
      if (eventsForMonth('2026-02').length !== 0) return 'unparseable cache yielded events'
    } finally { s.restore(); _resetForTest() }
    return null
  }],

  ['state: eventsForMonth resolves category from colorId at read time', () => {
    const s = stubStorage()
    try {
      localStorage.setItem('bramwell.cache.v1', JSON.stringify({
        v: 1,
        months: { '2026-02': { state: 'ready', fetchedAt: 1, events: [
          { id: 'a', title: 'W', allDay: true, colorId: '9', start: civilToDay(2026, 2, 10), end: civilToDay(2026, 2, 10) },
          { id: 'b', title: 'Unknown', allDay: true, colorId: '1', start: civilToDay(2026, 2, 11), end: civilToDay(2026, 2, 11) },
          { id: 'c', title: 'None', allDay: true, start: civilToDay(2026, 2, 12), end: civilToDay(2026, 2, 12) },
        ] } },
      }))
      _resetForTest()
      configure({})
      if (monthState('2026-02') !== 'ready') return `state: ${monthState('2026-02')}`
      const evs = eventsForMonth('2026-02')
      if (evs[0]?.category !== 'work') return `colorId 9 -> ${evs[0]?.category}`
      if (evs[1]?.category !== 'other') return `unknown colorId -> ${evs[1]?.category}`
      if (evs[2]?.category !== 'other') return `absent colorId -> ${evs[2]?.category}`
      // Re-resolution, not a stored value: change the prefs and read again without refetching.
      configure({ categories: [{ name: 'ops', label: 'Ops', colorId: '9' }, { name: 'misc', label: 'Misc', colorId: '8' }], fallbackCategory: 'misc' })
      const again = eventsForMonth('2026-02')
      if (again[0]?.category !== 'ops') return `after reconfigure: ${again[0]?.category}`
      if (again[1]?.category !== 'misc') return `deleted category did not fall back: ${again[1]?.category}`
      configure({})
    } finally { s.restore(); _resetForTest() }
    return null
  }],

  ['state: spansForWeek clips, flags continuation, dedupes across a month boundary', () => {
    const s = stubStorage()
    try {
      // 2026-01-26 (Mon) .. 2026-02-01 (Sun) is one row straddling the month boundary.
      const anchor = civilToDay(2026, 1, 28)
      const crossing = { id: 'cross', title: 'Long', allDay: true, colorId: '9', start: civilToDay(2026, 1, 30), end: civilToDay(2026, 2, 3) }
      const timed = { id: 'timed', title: 'Late', allDay: false, colorId: '9', startMin: 1320, endMin: 30, start: civilToDay(2026, 1, 27), end: civilToDay(2026, 1, 28) }
      const before = { id: 'before', title: 'Earlier', allDay: true, colorId: '9', start: civilToDay(2026, 1, 20), end: civilToDay(2026, 1, 27) }
      localStorage.setItem('bramwell.cache.v1', JSON.stringify({
        v: 1,
        months: {
          // An event crossing the boundary is stored in BOTH months, as types.ts requires.
          '2026-01': { state: 'ready', fetchedAt: 1, events: [crossing, timed, before] },
          '2026-02': { state: 'ready', fetchedAt: 1, events: [crossing] },
        },
      }))
      _resetForTest()
      configure({})
      _setAnchorForTest(anchor)
      const spans = spansForWeek(asWeek(0))
      if (spans.filter(sp => sp.event.id === 'cross').length !== 1) return `crossing event drew ${spans.filter(sp => sp.event.id === 'cross').length} times`
      const c = spans.find(sp => sp.event.id === 'cross')
      if (c?.from !== 4) return `from: ${c?.from} (Fri the 30th is offset 4)`
      if (c?.to !== 6) return `to: ${c?.to} (clipped to Sunday)`
      if (c?.continuesBefore !== false) return 'continuesBefore should be false — it starts in this row'
      if (c?.continuesAfter !== true) return 'continuesAfter should be true — it runs past Sunday'
      const b = spans.find(sp => sp.event.id === 'before')
      if (b?.from !== 0 || b.to !== 1) return `clipped span: ${b?.from}..${b?.to}`
      if (b?.continuesBefore !== true) return 'continuesBefore should be true — it started last row'
      // A timed event crossing midnight renders on its start day only.
      const t = spans.find(sp => sp.event.id === 'timed')
      if (t?.from !== 1 || t.to !== 1) return `timed span: ${t?.from}..${t?.to} — a timed event renders on its start day`
      if (t?.continuesAfter !== false) return 'a midnight-crossing timed event claimed a continuation'
    } finally { s.restore(); _resetForTest() }
    return null
  }],
```

Extend the `state.ts` import in `src/selftest.ts` to add `_resetForTest`, `_flushForTest`, `prefs`, `savePrefs`, `monthState`, `eventsForMonth`, `spansForWeek`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run selftest`
Expected: three FAILs, total `29/32`. The first two throw `STAGE 02: not implemented`; the third throws on the missing `_resetForTest` import.

- [ ] **Step 3: Implement persistence and reads**

In `src/state.ts`, replace the whole "Stubs: stage 02" section and extend the imports:

```ts
import type {
  DayNumber, WeekIndex, DayOffset, MonthKey, MonthLoadState, MonthEntry, CalendarEvent,
  EventDraft, EventSpan, EventCache, StoredEvent, PendingWrite, Prefs, WriteScope,
} from './types.ts'
import { asDay, asOffset, asWeek, addDays, civilToDay, monthKey, offsetOf } from './dates.ts'
import { all as allCategories, categoryFor } from './categories.ts'
```

then, replacing the stub block:

```ts
// ---------- Storage ----------

const CACHE_KEY = 'bramwell.cache.v1'
const PREFS_KEY = 'bramwell.prefs.v1'
/** A ready month older than this is refetched when it comes back into range. */
const STALE_MS = 5 * 60_000
const SAVE_DEBOUNCE_MS = 250

let cache: EventCache = { v: 1, months: {} }
let prefsValue: Prefs = {}
let loaded = false
/** Optimistic overlay, keyed by event id (tempId for creates). Never serialized. */
const pending = new Map<string, PendingWrite>()

/** Inside a function, never at module scope: node has none, and a locked-down browser throws. */
function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null
  } catch {
    return null
  }
}

function readCache(): EventCache {
  const s = storage()
  if (s === null) return { v: 1, months: {} }
  try {
    const raw = s.getItem(CACHE_KEY)
    if (raw === null) return { v: 1, months: {} }
    const parsed = JSON.parse(raw) as { v?: number; months?: Record<MonthKey, MonthEntry> }
    if (parsed.v !== 1 || typeof parsed.months !== 'object' || parsed.months === null) return { v: 1, months: {} }
    return { v: 1, months: parsed.months }
  } catch {
    return { v: 1, months: {} }   // unparseable or unreadable: the cache is never truth
  }
}

function readPrefs(): Prefs {
  const s = storage()
  if (s === null) return {}
  try {
    const raw = s.getItem(PREFS_KEY)
    if (raw === null) return {}
    const p = JSON.parse(raw) as Prefs
    return typeof p === 'object' && p !== null ? p : {}
  } catch {
    return {}
  }
}

function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  cache = readCache()
  prefsValue = readPrefs()
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function writeCacheNow(): void {
  const s = storage()
  if (s === null) return
  const months: Record<MonthKey, MonthEntry> = {}
  for (const [k, m] of Object.entries(cache.months)) if (m.state === 'ready') months[k] = m
  try {
    s.setItem(CACHE_KEY, JSON.stringify({ v: 1, months }))
  } catch {
    // Quota. Swallowed by decision: the cache is never truth.
  }
}

/** Debounced: an optimistic write must not re-serialize the whole blob synchronously. */
function saveCache(): void {
  if (saveTimer !== null) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    writeCacheNow()
  }, SAVE_DEBOUNCE_MS)
}

// ---------- Prefs ----------

export function prefs(): Prefs {
  ensureLoaded()
  return { ...prefsValue }
}

export function savePrefs(p: Prefs): void {
  ensureLoaded()
  prefsValue = { ...p }
  const s = storage()
  if (s === null) return
  try {
    s.setItem(PREFS_KEY, JSON.stringify(prefsValue))
  } catch {
    // Quota.
  }
}

// ---------- Reads ----------

export function monthState(key: MonthKey): MonthLoadState {
  ensureLoaded()
  return cache.months[key]?.state ?? 'absent'
}

/** category is derived here and nowhere else, on every read, against current prefs. */
function resolve(se: StoredEvent): CalendarEvent {
  const category = categoryFor(se.colorId).name
  return se.allDay ? { ...se, allDay: true, category } : { ...se, allDay: false, category }
}

function monthsSpanned(start: DayNumber, end: DayNumber): MonthKey[] {
  const keys: MonthKey[] = []
  for (let d = start; ; d = addDays(d, 1)) {
    const k = monthKey(d)
    if (keys[keys.length - 1] !== k) keys.push(k)
    if (d >= end) break
  }
  return keys
}

export function eventsForMonth(key: MonthKey): CalendarEvent[] {
  ensureLoaded()
  const out: CalendarEvent[] = []
  for (const se of cache.months[key]?.events ?? []) {
    const p = pending.get(se.id)
    if (p?.kind === 'delete') continue
    out.push(p?.kind === 'update' ? p.event : resolve(se))
  }
  for (const p of pending.values()) {
    if (p.kind === 'create' && monthsSpanned(p.event.start, p.event.end).includes(key)) out.push(p.event)
  }
  return out
}

export function spansForWeek(week: WeekIndex): EventSpan[] {
  ensureLoaded()
  const mon = dayAt(week, asOffset(0))
  const sun = addDays(mon, 6)
  const seen = new Set<string>()
  const out: EventSpan[] = []
  // One or two month keys; an event crossing the boundary is stored in both, so dedupe by id.
  for (const key of new Set([monthKey(mon), monthKey(sun)])) {
    for (const ev of eventsForMonth(key)) {
      if (seen.has(ev.id)) continue
      seen.add(ev.id)
      // A timed event renders on its start day even when its end crosses midnight.
      const evEnd = ev.allDay ? ev.end : ev.start
      if (evEnd < mon || ev.start > sun) continue
      out.push({
        event: ev,
        week,
        from: asOffset(Math.max(0, ev.start - mon)),
        to: asOffset(Math.min(6, evEnd - mon)),
        continuesBefore: ev.start < mon,
        continuesAfter: evEnd > sun,
      })
    }
  }
  return out
}

// ---------- Test-only (extends stage-01 ruling 2) ----------

export function _resetForTest(): void {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
  cache = { v: 1, months: {} }
  prefsValue = {}
  pending.clear()
  loaded = false
}

export function _flushForTest(): void {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
  writeCacheNow()
}

// ---------- Stubs: tasks 8 and 9 ----------

const NOT_IMPLEMENTED = 'STAGE 02: not implemented'
export function ensureMonthsFor(_weeks: WeekIndex[]): void { throw new Error(NOT_IMPLEMENTED) }
export function createEvent(_draft: EventDraft): Promise<CalendarEvent> { throw new Error(NOT_IMPLEMENTED) }
export function updateEvent(_id: string, _draft: EventDraft, _scope: WriteScope): Promise<CalendarEvent> { throw new Error(NOT_IMPLEMENTED) }
export function deleteEvent(_id: string, _scope: WriteScope): Promise<void> { throw new Error(NOT_IMPLEMENTED) }
export function onCacheChange(_fn: (months: MonthKey[]) => void): () => void { throw new Error(NOT_IMPLEMENTED) }
export function enableDemo(): void { throw new Error('STAGE 06: not implemented') }
```

`allCategories` is unused until Task 9; if `tsc` flags the unused import, add it in Task 9 instead.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run selftest`
Expected: `32/32`.

Run: `npx tsc --noEmit && echo TSC_CLEAN`
Expected: `TSC_CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/selftest.ts
git commit -m "stage 02: cache and prefs persistence, month reads, week spans"
```

---

### Task 8: `state.ts` — `withToken`, `ensureMonthsFor`, `onCacheChange`

**Files:**
- Modify: `src/state.ts` (replace the `ensureMonthsFor` and `onCacheChange` stubs; add `withToken`, `fetchMonth`, `_settleForTest`)
- Modify: `src/selftest.ts` (four cases)

**Interfaces:**
- Consumes: `listMonth`, `GcalError` (Task 4); `getToken` (Task 6); `ensureLoaded`, `cache`, `saveCache`, `monthsSpanned` (Task 7).
- Produces: `ensureMonthsFor(weeks: WeekIndex[]): void`, `onCacheChange(fn): () => void`, and the internal `withToken`, `fetchMonth`, `refetch`, `markAllStale`, `notify` that Task 9 uses.

- [ ] **Step 1: Write the four failing tests**

Append to `cases` in `src/selftest.ts`:

```ts
  ['state: ensureMonthsFor fetches absent months, skips fresh ones, coalesces', async () => {
    const s = stubStorage(), g = stubGis([{ access_token: 'tk', expires_in: 3600 }])
    const f = stubFetch([{ body: { items: [{ id: 'e1', summary: 'E', start: { date: '2026-02-11' }, end: { date: '2026-02-12' } }] } }])
    try {
      _resetForTest(); configure({})
      _setAnchorForTest(civilToDay(2026, 2, 11))   // week 0 = Mon 9th .. Sun 15th, all in 2026-02
      if (monthState('2026-02') !== 'absent') return `before: ${monthState('2026-02')}`
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (monthState('2026-02') !== 'ready') return `after: ${monthState('2026-02')}`
      if (f.calls.length !== 1) return `calls: ${f.calls.length}`
      if (eventsForMonth('2026-02')[0]?.id !== 'e1') return 'fetched events were not stored'
      // A month fetched seconds ago is not refetched.
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (f.calls.length !== 1) return `a fresh month was refetched: ${f.calls.length} calls`
      // Concurrent callers for the same key coalesce into one request.
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      f.calls.length = 0
      ensureMonthsFor([asWeek(0)])
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (f.calls.length !== 1) return `concurrent callers made ${f.calls.length} requests`
      // A week straddling a boundary pulls both months.
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 1, 28))
      f.calls.length = 0
      ensureMonthsFor([asWeek(0)])   // Mon 2026-01-26 .. Sun 2026-02-01
      await _settleForTest()
      if (f.calls.length !== 2) return `a straddling week fetched ${f.calls.length} months`
      await signOut()
    } finally { f.restore(); g.restore(); s.restore(); _resetForTest() }
    return null
  }],

  ['state: a failed refresh sets error and keeps the prior events', async () => {
    const s = stubStorage(), g = stubGis([{ access_token: 'tk', expires_in: 3600 }])
    try {
      localStorage.setItem('bramwell.cache.v1', JSON.stringify({
        v: 1,
        months: { '2026-02': { state: 'ready', fetchedAt: 1, events: [{ id: 'old', title: 'Old', allDay: true, start: civilToDay(2026, 2, 11), end: civilToDay(2026, 2, 11) }] } },
      }))
      _resetForTest(); configure({})
      _setAnchorForTest(civilToDay(2026, 2, 11))
      const f = stubFetch([{ status: 404, body: { error: { errors: [{ reason: 'notFound' }] } } }])
      try {
        ensureMonthsFor([asWeek(0)])
        await _settleForTest()
        if (monthState('2026-02') !== 'error') return `state after failure: ${monthState('2026-02')}`
        if (eventsForMonth('2026-02')[0]?.id !== 'old') return 'a failed refresh blanked a month that was on screen'
      } finally { f.restore() }
      await signOut()
    } finally { g.restore(); s.restore(); _resetForTest() }
    return null
  }],

  ['state: withToken retries a 401 exactly once with a fresh token', async () => {
    const s = stubStorage()
    const g = stubGis([{ access_token: 'stale', expires_in: 3600 }, { access_token: 'fresh', expires_in: 3600 }])
    const f = stubFetch([{ status: 401, body: {} }, { body: { items: [] } }])
    try {
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (f.calls.length !== 2) return `expected one retry, saw ${f.calls.length} calls`
      if (f.calls[0]?.headers['authorization'] !== 'Bearer stale') return `first token: ${f.calls[0]?.headers['authorization']}`
      if (f.calls[1]?.headers['authorization'] !== 'Bearer fresh') return `retry token: ${f.calls[1]?.headers['authorization']}`
      if (monthState('2026-02') !== 'ready') return `state: ${monthState('2026-02')}`
      await signOut()
    } finally { f.restore(); g.restore(); s.restore(); _resetForTest() }
    // A second 401 surfaces rather than looping.
    const s2 = stubStorage()
    const g2 = stubGis([{ access_token: 'a', expires_in: 3600 }, { access_token: 'b', expires_in: 3600 }])
    const f2 = stubFetch([{ status: 401, body: {} }])
    try {
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (f2.calls.length !== 2) return `a repeated 401 made ${f2.calls.length} calls`
      if (monthState('2026-02') !== 'error') return `a repeated 401 left state ${monthState('2026-02')}`
      await signOut()
    } finally { f2.restore(); g2.restore(); s2.restore(); _resetForTest() }
    return null
  }],

  ['state: onCacheChange notifies with changed keys and unsubscribes', async () => {
    const s = stubStorage(), g = stubGis([{ access_token: 'tk', expires_in: 3600 }])
    const f = stubFetch([{ body: { items: [] } }])
    try {
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      const seen: string[] = []
      const off = onCacheChange(keys => { seen.push(keys.join('+')) })
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (seen.length === 0) return 'no notification was delivered'
      if (!seen.every(k => k === '2026-02')) return `keys: ${seen.join(' / ')}`
      off()
      const before = seen.length
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (seen.length !== before) return 'an unsubscribed listener was still called'
      await signOut()
    } finally { f.restore(); g.restore(); s.restore(); _resetForTest() }
    return null
  }],
```

Extend the `state.ts` import to add `ensureMonthsFor`, `onCacheChange`, `_settleForTest`, and add `signOut` if it is not already imported from `auth.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run selftest`
Expected: four FAILs, total `32/36`.

- [ ] **Step 3: Implement**

Add to the imports at the top of `src/state.ts`:

```ts
import { getToken } from './auth.ts'
import { GcalError, listMonth } from './gcal.ts'
```

Replace the `ensureMonthsFor` and `onCacheChange` stubs with:

```ts
// ---------- Notification ----------

const listeners = new Set<(months: MonthKey[]) => void>()

export function onCacheChange(fn: (months: MonthKey[]) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function notify(months: MonthKey[]): void {
  for (const fn of [...listeners]) fn(months)
}

// ---------- Network ----------

/** The one place the 401 rule lives. gcal.ts owns the transport retry; this owns identity. */
async function withToken<T>(fn: (t: string) => Promise<T>): Promise<T> {
  const t = await getToken()
  try {
    return await fn(t)
  } catch (e) {
    if (!(e instanceof GcalError) || e.status !== 401) throw e
    return await fn(await getToken(true))
  }
}

const inflight = new Map<MonthKey, Promise<void>>()

function needsFetch(key: MonthKey): boolean {
  const m = cache.months[key]
  if (m === undefined) return true
  if (m.state === 'loading') return false
  if (m.state === 'ready') return Date.now() - m.fetchedAt > STALE_MS
  return true   // absent | error
}

function fetchMonth(key: MonthKey): Promise<void> {
  const running = inflight.get(key)
  if (running !== undefined) return running
  if (!needsFetch(key)) return Promise.resolve()
  const prior = cache.months[key]
  cache.months[key] = { state: 'loading', events: prior?.events ?? [], fetchedAt: prior?.fetchedAt ?? 0 }
  notify([key])
  const p = withToken(t => listMonth(key, t)).then(
    events => {
      cache.months[key] = { state: 'ready', events, fetchedAt: Date.now() }
      saveCache()
    },
    () => {
      // Keep whatever was on screen: a refresh failure must not blank a month.
      const kept = cache.months[key]
      cache.months[key] = { state: 'error', events: kept?.events ?? [], fetchedAt: kept?.fetchedAt ?? 0 }
    },
  ).finally(() => {
    inflight.delete(key)
    notify([key])
  })
  inflight.set(key, p)
  return p
}

async function refetch(keys: MonthKey[]): Promise<void> {
  for (const k of keys) {
    const m = cache.months[k]
    if (m !== undefined) m.fetchedAt = 0
  }
  await Promise.all(keys.map(k => fetchMonth(k)))
}

/** A series write invalidates every month held, not just the ones it touched. */
function markAllStale(): void {
  for (const m of Object.values(cache.months)) m.fetchedAt = 0
}

/** Stage 03 owns *when* to call this; stage 02 owns the rule. */
export function ensureMonthsFor(weeks: WeekIndex[]): void {
  ensureLoaded()
  const keys = new Set<MonthKey>()
  for (const w of weeks) {
    const mon = dayAt(w, asOffset(0))
    keys.add(monthKey(mon))
    keys.add(monthKey(addDays(mon, 6)))
  }
  for (const key of keys) void fetchMonth(key)
}
```

and add beside the other test-only exports:

```ts
export async function _settleForTest(): Promise<void> {
  while (inflight.size > 0) await Promise.all([...inflight.values()])
}
```

`_resetForTest` must also clear it — add `inflight.clear()` to its body.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run selftest`
Expected: `36/36`.

Run: `npx tsc --noEmit && echo TSC_CLEAN`
Expected: `TSC_CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/selftest.ts
git commit -m "stage 02: lazy month loading, 401 retry, cache change notification"
```

---

### Task 9: `state.ts` — optimistic writes and rollback

**Files:**
- Modify: `src/state.ts` (replace the three write stubs)
- Modify: `src/selftest.ts` (three cases)

**Interfaces:**
- Consumes: everything from Tasks 7 and 8; `createEvent`/`updateEvent`/`deleteEvent` from `gcal.ts` (Task 5), imported under aliases so they do not collide with `state`'s own exports.
- Produces: `createEvent(draft: EventDraft): Promise<CalendarEvent>`, `updateEvent(id: string, draft: EventDraft, scope: WriteScope): Promise<CalendarEvent>`, `deleteEvent(id: string, scope: WriteScope): Promise<void>`. Stage 04's form is the consumer.

- [ ] **Step 1: Write the three failing tests**

Append to `cases` in `src/selftest.ts`:

```ts
  ['state: create applies optimistically, then reconciles from the server', async () => {
    const s = stubStorage(), g = stubGis([{ access_token: 'tk', expires_in: 3600 }])
    const f = stubFetch([
      { body: { id: 'real-1', summary: 'Trip', colorId: '9', start: { date: '2026-02-20' }, end: { date: '2026-02-23' } } },
      { body: { items: [{ id: 'real-1', summary: 'Trip', colorId: '9', start: { date: '2026-02-20' }, end: { date: '2026-02-23' } }] } },
    ])
    try {
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      const saved = await createEvent({
        title: 'Trip', category: 'work', allDay: true,
        start: civilToDay(2026, 2, 20), end: civilToDay(2026, 2, 22), repeat: 'none',
      })
      if (saved.id !== 'real-1') return `reconciled id: ${saved.id}`
      if (saved.category !== 'work') return `category: ${saved.category}`
      const evs = eventsForMonth('2026-02')
      if (evs.filter(e => e.id === 'real-1').length !== 1) return `after reconcile: ${evs.map(e => e.id).join(',')}`
      if (evs.some(e => e.id.startsWith('tmp:'))) return 'the optimistic entry was not dropped'
      if (f.calls[0]?.method !== 'POST') return `first call: ${f.calls[0]?.method}`
      // The colorId came from the category name, resolved by state.ts, not by gcal.ts.
      if ((f.calls[0]?.body as { colorId?: string }).colorId !== '9') return 'colorId was not resolved from the category'
      if (f.calls[1]?.method !== 'GET') return 'the touched month was not refetched'
      await signOut()
    } finally { f.restore(); g.restore(); s.restore(); _resetForTest() }
    return null
  }],

  ['state: a failed create rolls the overlay back and rethrows', async () => {
    const s = stubStorage(), g = stubGis([{ access_token: 'tk', expires_in: 3600 }])
    const f = stubFetch([{ status: 403, body: { error: { errors: [{ reason: 'insufficientPermissions' }] } } }])
    try {
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      const before = eventsForMonth('2026-02').length
      try {
        await createEvent({ title: 'Doomed', category: 'work', allDay: true, start: civilToDay(2026, 2, 20), end: civilToDay(2026, 2, 20), repeat: 'none' })
        return 'a failed create resolved'
      } catch (e) {
        if (!(e instanceof GcalError) || e.status !== 403) return `wrong error: ${(e as Error).message}`
      }
      const after = eventsForMonth('2026-02')
      if (after.length !== before) return `rollback left ${after.length - before} extra event(s)`
      if (after.some(e => e.title === 'Doomed')) return 'the optimistic create survived the failure'
      await signOut()
    } finally { f.restore(); g.restore(); s.restore(); _resetForTest() }
    return null
  }],

  ['state: scope picks the id, and a series write stales every resident month', async () => {
    const s = stubStorage(), g = stubGis([{ access_token: 'tk', expires_in: 3600 }])
    try {
      const inst = { id: 'inst-1', recurringEventId: 'series-1', title: 'Weekly', allDay: true, colorId: '9', start: civilToDay(2026, 2, 11), end: civilToDay(2026, 2, 11) }
      const seed = () => {
        localStorage.setItem('bramwell.cache.v1', JSON.stringify({
          v: 1,
          months: {
            '2026-02': { state: 'ready', fetchedAt: Date.now(), events: [inst] },
            '2026-03': { state: 'ready', fetchedAt: Date.now(), events: [] },
          },
        }))
        _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      }
      // Instance scope PATCHes the occurrence id and refetches only the touched month.
      seed()
      const one = stubFetch([
        { body: { id: 'inst-1', summary: 'Renamed', colorId: '9', start: { date: '2026-02-11' }, end: { date: '2026-02-12' } } },
        { body: { items: [] } },
      ])
      try {
        await updateEvent('inst-1', { title: 'Renamed', category: 'work', allDay: true, start: civilToDay(2026, 2, 11), end: civilToDay(2026, 2, 11), repeat: 'none' }, 'instance')
        if (!(one.calls[0]?.url ?? '').endsWith('/events/inst-1')) return `instance url: ${one.calls[0]?.url}`
        const refetched = one.calls.filter(c => c.method === 'GET').length
        if (refetched !== 1) return `instance scope refetched ${refetched} months`
      } finally { one.restore() }
      // Series scope PATCHes the series id and refetches every resident month.
      seed()
      const many = stubFetch([
        { body: { id: 'series-1', summary: 'Renamed', colorId: '9', start: { date: '2026-02-11' }, end: { date: '2026-02-12' } } },
        { body: { items: [] } },
      ])
      try {
        await updateEvent('inst-1', { title: 'Renamed', category: 'work', allDay: true, start: civilToDay(2026, 2, 11), end: civilToDay(2026, 2, 11), repeat: 'none' }, 'series')
        if (!(many.calls[0]?.url ?? '').endsWith('/events/series-1')) return `series url: ${many.calls[0]?.url}`
        const refetched = many.calls.filter(c => c.method === 'GET').length
        if (refetched !== 2) return `series scope refetched ${refetched} months, expected every resident month (2)`
      } finally { many.restore() }
      // Delete follows the same id choice and removes the event optimistically.
      seed()
      const del = stubFetch([{ status: 204 }, { body: { items: [] } }])
      try {
        await deleteEvent('inst-1', 'series')
        if (!(del.calls[0]?.url ?? '').endsWith('/events/series-1')) return `delete url: ${del.calls[0]?.url}`
        if (eventsForMonth('2026-02').some(e => e.id === 'inst-1')) return 'the deleted event survived'
      } finally { del.restore() }
      await signOut()
    } finally { g.restore(); s.restore(); _resetForTest() }
    return null
  }],
```

Extend the `state.ts` import to add `createEvent`, `updateEvent`, `deleteEvent`. No collision: Task 5 already aliased the `gcal.ts` three to `gcalCreate`/`gcalUpdate`/`gcalDelete`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run selftest`
Expected: three FAILs, total `36/39`.

- [ ] **Step 3: Implement the three writes**

**Extend** the `gcal.ts` import Task 8 added in `src/state.ts` — do not add a second import of the same module:

```ts
import {
  createEvent as gcalCreate, deleteEvent as gcalDelete, updateEvent as gcalUpdate,
  GcalError, listMonth,
} from './gcal.ts'
```

Replace the three write stubs with:

```ts
// ---------- Writes ----------

function colorIdFor(name: string): string {
  return (allCategories().find(c => c.name === name) ?? categoryFor(undefined)).colorId
}

function findEvent(id: string): CalendarEvent | null {
  const p = pending.get(id)
  if (p !== undefined && p.kind !== 'create') return p.kind === 'update' ? p.event : p.prior
  for (const key of Object.keys(cache.months)) {
    for (const ev of eventsForMonth(key)) if (ev.id === id) return ev
  }
  return null
}

/** Field by field, never by spreading the draft: a spread can smuggle startMin into an all-day event. */
function build(id: string, draft: EventDraft, colorId: string, recurringEventId: string | undefined): CalendarEvent {
  const ev: CalendarEvent = draft.allDay
    ? { id, title: draft.title, category: draft.category, colorId, start: draft.start, end: draft.end, allDay: true }
    : {
        id, title: draft.title, category: draft.category, colorId,
        start: draft.start, end: draft.end, allDay: false,
        startMin: draft.startMin ?? 0, endMin: draft.endMin ?? 0,
      }
  if (draft.notes !== undefined) ev.notes = draft.notes
  if (recurringEventId !== undefined) ev.recurringEventId = recurringEventId
  return ev
}

function assertOnline(): void {
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator
  if (nav?.onLine === false) throw new Error('Offline — this change was not saved.')
}

export async function createEvent(draft: EventDraft): Promise<CalendarEvent> {
  ensureLoaded()
  const colorId = colorIdFor(draft.category)
  const tempId = `tmp:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const event = build(tempId, draft, colorId, undefined)
  const touched = monthsSpanned(event.start, event.end)
  pending.set(tempId, { kind: 'create', tempId, event })
  notify(touched)
  try {
    assertOnline()   // inside the try, after the apply, so the rollback path really runs
    const saved = await withToken(t => gcalCreate(draft, colorId, t))
    pending.delete(tempId)
    await refetch([...new Set([...touched, ...monthsSpanned(saved.start, saved.end)])])
    return resolve(saved)
  } catch (e) {
    pending.delete(tempId)
    notify(touched)
    throw e   // the caller raises the toast; state.ts stays DOM-free
  }
}

export async function updateEvent(id: string, draft: EventDraft, scope: WriteScope): Promise<CalendarEvent> {
  ensureLoaded()
  const prior = findEvent(id)
  if (prior === null) throw new Error(`unknown event ${id}`)
  const colorId = colorIdFor(draft.category)
  const event = build(id, draft, colorId, prior.recurringEventId)
  const touched = [...new Set([...monthsSpanned(prior.start, prior.end), ...monthsSpanned(event.start, event.end)])]
  pending.set(id, { kind: 'update', event, prior })
  notify(touched)
  try {
    assertOnline()
    const wireId = scope === 'series' ? (prior.recurringEventId ?? prior.id) : prior.id
    const saved = await withToken(t => gcalUpdate(wireId, draft, colorId, t))
    pending.delete(id)
    if (scope === 'series') {
      markAllStale()
      await refetch(Object.keys(cache.months))
    } else {
      await refetch([...new Set([...touched, ...monthsSpanned(saved.start, saved.end)])])
    }
    return resolve(saved)
  } catch (e) {
    pending.delete(id)
    notify(touched)
    throw e
  }
}

export async function deleteEvent(id: string, scope: WriteScope): Promise<void> {
  ensureLoaded()
  const prior = findEvent(id)
  if (prior === null) throw new Error(`unknown event ${id}`)
  const touched = monthsSpanned(prior.start, prior.end)
  pending.set(id, { kind: 'delete', id, prior })
  notify(touched)
  try {
    assertOnline()
    const wireId = scope === 'series' ? (prior.recurringEventId ?? prior.id) : prior.id
    await withToken(t => gcalDelete(wireId, t))
    pending.delete(id)
    if (scope === 'series') {
      markAllStale()
      await refetch(Object.keys(cache.months))
    } else {
      await refetch(touched)
    }
  } catch (e) {
    pending.delete(id)
    notify(touched)
    throw e
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run selftest`
Expected: `39/39`.

Run: `npx tsc --noEmit && echo TSC_CLEAN`
Expected: `TSC_CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts src/selftest.ts
git commit -m "stage 02: optimistic writes, rollback, series staling"
```

---

### Task 10: `main.ts` — wiring and the DEV-only gate harness

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `state.prefs`, `categories.configure`, `categories.themeCss`, `auth.signIn`, `auth.isSignedIn`.
- Produces: a `<style id="bramwell-theme">` owned by `main.ts`; under `import.meta.env.DEV` only, a Connect button and `window.bramwell`. Stage 05 replaces the button with the real first-run screen and drops the handle.

- [ ] **Step 1: Replace `src/main.ts`**

```ts
// STAGE 02 — bootstrapping and wiring; owns the theme <style>.
import './style.css'
import './motion.css'
import * as auth from './auth.ts'
import * as categories from './categories.ts'
import * as gcal from './gcal.ts'
import * as state from './state.ts'

const app = document.getElementById('app')
if (!app) throw new Error('STAGE 02: #app missing')

// The single <style> for runtime colour. categories.ts returns a string and never touches the DOM.
const themeStyle = document.createElement('style')
themeStyle.id = 'bramwell-theme'
document.head.append(themeStyle)

/** main.ts is the single writer of category state: at bootstrap and on every prefs change. */
function applyTheme(): void {
  const p = state.prefs()
  categories.configure(p)
  themeStyle.textContent = categories.themeCss(p.mood ?? 'warm')
}

applyTheme()

if (new URLSearchParams(location.search).has('selftest')) {
  const { selfTest } = await import('./selftest.ts')
  const results = await selfTest()
  const passed = results.filter(r => r.pass).length
  const pre = document.createElement('pre')
  pre.textContent =
    results.map(r => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : ' — ' + r.detail}`).join('\n') +
    `\n\n${passed}/${results.length}`
  pre.dataset['selftest'] = passed === results.length ? 'pass' : 'fail'
  app.replaceChildren(pre)
} else if (import.meta.env.DEV) {
  // STAGE 02 HARNESS — deleted in stage 05, which builds the real first-run screen.
  // GIS needs real user activation, which a devtools call does not have, so the gate
  // needs a button that a human actually clicks.
  const status = document.createElement('p')
  status.id = 'harness-status'
  const connect = document.createElement('button')
  connect.id = 'harness-connect'
  connect.textContent = 'Connect Google Calendar'
  const paint = () => { status.textContent = auth.isSignedIn() ? 'Connected' : 'Not connected' }
  connect.addEventListener('click', () => {
    status.textContent = 'Connecting…'
    void auth.signIn().then(paint, (e: Error) => { status.textContent = `Sign-in failed: ${e.message}` })
  })
  const out = document.createElement('button')
  out.id = 'harness-signout'
  out.textContent = 'Sign out'
  out.addEventListener('click', () => { void auth.signOut().then(paint) })
  app.replaceChildren(connect, out, status)
  paint()
  // why: augmenting window for a dev-only console handle, without widening the global type
  ;(window as unknown as { bramwell: unknown }).bramwell = { auth, gcal, categories, state, applyTheme }
  // A quiet renewal on load is what the gate's "reload, no popup" criterion exercises.
  void auth.getToken().then(paint, paint)
} else {
  app.textContent = 'Bramwell'
}
```

- [ ] **Step 2: Confirm the build and the selftest page still work**

Run: `npx tsc --noEmit && npm run build && echo BUILD_OK`
Expected: `BUILD_OK`, and no `harness` string in the production bundle — confirm with:

```bash
grep -rc 'harness-connect' dist/assets/*.js || echo "harness absent from the production bundle (expected)"
```
Expected: `harness absent from the production bundle (expected)` — `import.meta.env.DEV` is statically false in a build, so Vite drops the branch.

- [ ] **Step 3: Run the selftest in a real browser**

```bash
npm run dev &
sleep 3
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --headless=new --disable-gpu \
  --dump-dom --virtual-time-budget=15000 "http://localhost:5173/?selftest" > /tmp/selftest.html
grep -o 'data-selftest="[a-z]*"' /tmp/selftest.html
```
Expected: `data-selftest="pass"`, and the dump contains `39/39`. Chrome may not exit under a virtual-time budget; kill it if so.

- [ ] **Step 4: Hit-test the Connect button**

CONVENTIONS: a "this control works" claim is backed by `elementFromPoint()` at the control's centre, not by `element.click()`. Drive the dev page in a same-origin iframe:

```bash
cat > /tmp/hit.html <<'HTML'
<iframe id="f" src="http://localhost:5173/" style="width:1200px;height:800px;border:0"></iframe>
<pre id="out">pending</pre>
<script>
setTimeout(() => {
  const d = document.getElementById('f').contentDocument
  const b = d.getElementById('harness-connect')
  const r = b.getBoundingClientRect()
  const hit = d.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  document.getElementById('out').textContent = hit === b ? 'HIT connect' : 'MISS ' + (hit && hit.id)
}, 2500)
</script>
HTML
cp /tmp/hit.html public/hit.html
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --headless=new --disable-gpu \
  --dump-dom --virtual-time-budget=8000 "http://localhost:5173/hit.html" | grep -o 'HIT connect\|MISS [a-z-]*'
rm public/hit.html
```
Expected: `HIT connect`. Repeat with `--blink-settings=preferredColorScheme=1` and `=2`; both must report `HIT connect`.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "stage 02: theme style wiring and DEV-only gate harness"
```

---

### Task 11: Gate run and `verification.md`

The gate is the human's, on a real account, and it is what closes the four wire items in `OPEN.md`. This task prepares the recipe and records the result.

**Files:**
- Create: `02_data/output/verification.md`
- Modify: `02_data/CONTEXT.md` (Status line)

- [ ] **Step 1: Start the dev server and hand over the console recipe**

```bash
npm run dev
```

Open `http://localhost:5173/`, click **Connect Google Calendar**, complete consent. Then in the devtools console:

```js
// 1. Quiet renewal: reload the page. The status line should reach "Connected"
//    with no popup. bramwell.auth.isSignedIn() === true.

// 2. A real month, with real events.
const { state, gcal, auth, categories } = bramwell
state.ensureMonthsFor([0].map(n => n))            // week 0 = the week containing today
await new Promise(r => setTimeout(r, 1500))
state.eventsForMonth(new Date().toISOString().slice(0, 7))

// 3. One event per seed category — open each in the Google Calendar app.
for (const c of categories.all()) {
  await state.createEvent({
    title: `Bramwell gate — ${c.label}`, category: c.name, allDay: true,
    start: state.today(), end: state.today(), repeat: 'none',
  })
}

// 4. A 3-day all-day event. Confirm the END DATE in the Google app: it must read
//    as the third day, not the fourth. This is OPEN.md's exclusive-end item.
await state.createEvent({
  title: 'Bramwell gate — 3 day', category: 'work', allDay: true,
  start: state.today(), end: state.today() + 2, repeat: 'none',
})

// 5. A weekly series; edit ONE occurrence, then delete the SERIES.
await state.createEvent({
  title: 'Bramwell gate — weekly', category: 'personal', allDay: true,
  start: state.today(), end: state.today(), repeat: 'weekly',
})
// reload so the series' instances are cached, find one, then:
// await state.updateEvent(<instanceId>, { ...draft, title: 'edited occurrence' }, 'instance')
// await state.deleteEvent(<instanceId>, 'series')
```

- [ ] **Step 2: Prove pagination against the real account**

Edit `src/gcal.ts`, set `export const MAX_RESULTS = 2`, let HMR reload, then re-run step 2 above on a month with more than two events and confirm in the Network tab that more than one `events?` request is made and that every event still arrives. **Restore `MAX_RESULTS = 250`** and confirm one request again.

- [ ] **Step 3: Write `02_data/output/verification.md`**

Follow `01_scaffold/output/verification.md`. It must contain:

- A **gate criteria** table: sign-in and quiet renewal on reload; a real month fetch; pagination proven at `MAX_RESULTS = 2` and restored; the four `OPEN.md` wire items each with what was seen in the Google Calendar app; `npm run selftest` at 39/39; `tsc --noEmit`; `npm run build`; the `elementFromPoint` hit-test in both colour schemes. Each row carries the actual command and its actual output — no claim without evidence.
- **Rulings the spec left open**, for promotion into `DECISIONS.md` at gate close:
  1. `gcal.ts` returns `StoredEvent`; category resolution is `state.ts`'s alone.
  2. `WriteScope` does not reach the wire; `state.ts` picks the id.
  3. `gcal.updateEvent` keeps an explicit `colorId` argument, since `EventDraft.category` is a name and `gcal.ts` may not import `categories.ts`.
  4. 429 joins the retry set; a 403 is retried only on a rate-limit reason.
  5. `listMonth` caps the `nextPageToken` loop at 20 pages.
  6. `selfTest()` is async and covers `gcal.ts` under a stubbed `fetch`; one surface, not two.
  7. Cache staleness is 5 minutes; `saveCache` is debounced 250ms; no eviction (quota swallowed, per the existing decision).
  8. A failed refresh keeps prior events and sets `error`.
  9. `auth.ts` reads `globalThis.google`, the same binding as `window.google`, so a node test can install a fake without clobbering `window`.
  10. `state.ts` rolls back and rethrows but does **not** toast; the caller raises it, because `chrome.ts` is DOM-bearing and `state.ts` runs under node in the selftest.
  11. `state.ts` gains `_resetForTest`, `_flushForTest`, `_settleForTest`, extending stage-01 ruling 2.
  12. A timed event's span is its start day only, even when it crosses midnight.
  13. Mood values are deferred to stage 03; `MOODS` ships with `warm` alone and the four band tokens are not emitted.
  14. Google's 11 colour hexes as transcribed — **confirmed or corrected** by what the gate saw in the Google Calendar app.
- **Not tested**, honestly: anything the gate did not actually exercise. Candidates: the 10s GIS load timeout; `signOut()`'s revoke against the real endpoint; quota-exhaustion behaviour; DST-boundary timed writes; a month with more than 250 events at the real `MAX_RESULTS`; offline write rollback on a real device (the `navigator.onLine` path is stubbed nowhere and untested).

- [ ] **Step 4: Flip the Status line**

In `02_data/CONTEXT.md`, change `**Status: OPEN.**` to `**Status: AWAITING GATE.**` with the date. The human closes the gate; the next stage does not open until they do.

- [ ] **Step 5: Commit**

```bash
git add 02_data/output/verification.md 02_data/CONTEXT.md
git commit -m "stage 02: verification record, awaiting gate"
```
