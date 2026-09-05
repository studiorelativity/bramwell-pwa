# Stage 06 (run early as iteration B) — Demo mode, README, LICENSE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A no-sign-in demo of the calendar (`?demo` or "Try the demo") that seeds ~17 months of deterministic events into memory, never touches localStorage or googleapis.com, rejects every write with `DemoError` before the optimistic apply, exits into real sign-in from a header pill, and never survives a reload — plus the README and MIT LICENSE the open-source on-ramp needs.

**Architecture:** Demo is a module flag inside `state.ts`. Under it the fetch path returns resolved promises before touching `withToken`, the two persistence writers (`saveCache`, `savePrefs`) update memory only, and the three write verbs throw `DemoError` as their first statement — before `pending.set`/`notify`, which is what makes "before the optimistic apply" a structural fact rather than a remembered one. The seed is a pure function of the anchor day (mulberry32, fixed seed) so the selftest can assert its shape under node. `chrome.ts` gains a fourth connection state, `demo`, that paints the pill in the avatar slot; `main.ts` owns entry (`?demo`), exit (`onDemoExit` → `applyTheme()` → repaint), and the URL cleanup that makes a reload land on first-run.

**Tech Stack:** Vite 6 + vanilla TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), no runtime dependencies. Node 26 selftest (`node --experimental-strip-types`). Headless Chrome 151 over CDP for evidence.

**Spec:** `_references/SPEC.md` "Demo mode", "First-run and connection state", "State API"; `_references/DECISIONS.md` "In force — shell and chrome" (demo bullet) and "Planning layer rulings" (the session split, the seeded Vacation/Blackout amendment); contract `06_demo/CONTEXT.md`; brief `_iteration/beta-demo.md`. Rules: `_references/CONVENTIONS.md`.

## Global Constraints

- **File surface (brief):** `src/state.ts`, `src/chrome.ts` (only the first-run demo button and the avatar-slot pill), `src/main.ts` (only `?demo` entry and `onDemoExit`), `src/selftest.ts` (new cases), `README.md`, `LICENSE`. `src/gcal.ts` only if a guard must live at the network boundary — it does not: every path into `gcal.ts` goes through `withToken`/`fetchMonth` in `state.ts`, which are guarded there.
- **Not mine:** `style.css`/`motion.css` (C), first-run copy and the sheet (C), `categories.ts`/`plan.ts`/`year.ts` (A). No new CSS class; the pill reuses `.set-pill` with a `data-demo` attribute so C can restyle it.
- **Module boundaries:** `state.ts` stays DOM-free (the seed uses no `window`/`document`; `location`/`history` are read in `main.ts` only). Any browser global inside functions only — `selftest.ts` runs the graph under node.
- **DemoError before the optimistic apply; offline errors after it** (DECISIONS). The message is exactly `Demo — connect your Google Calendar to save.` (SPEC).
- **Zero localStorage writes in demo. Zero googleapis.com requests in demo.**
- **Demo never survives a reload.** Nothing persisted; `?demo` is stripped from the URL at entry.
- **Every "this control works" claim is backed by `elementFromPoint()`.**
- **The seed is never amended by me.** `SEED` stays private to `categories.ts`; demo reads the resolved list through `all()` after `configure({})`.
- **Commits:** small, on branch `demo`, in the repo's message style, each ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Rulings made against the contract (recorded here, promoted in verification.md)

1. **`enableDemo`, not `enterDemo`.** `06_demo/CONTEXT.md` Outputs says `enterDemo`; SPEC "State API" and the brief say `enableDemo`, and the stub already exists under that name. The spec wins.
2. **Demo is a fourth connection state in `chrome.ts`.** Seeded months are `ready`, so `warmCache()` is true and the existing logic would read demo as `stale` — Reconnect pill after 2.5s, FAB disabled. Demo must show the demo pill immediately and keep the FAB live (a rejected save is the demo's whole lesson). `Conn` gains `'demo'`, checked first, before `auth.isSignedIn()`.
3. **The avatar slot in demo holds the pill AND a dot-less avatar.** SPEC says "customization works in memory", and the avatar is the only door to Settings; the dot is omitted because its CSS says it "exists only in the connected state". The pill carries `data-demo` so C can colour it (today it inherits Reconnect's red — reads as "not connected", which is true).
4. **`?demo` is stripped from the URL at entry** (`history.replaceState`), so the gate's "reload lands on first-run" is true from `/?demo` itself, not only from `/`.
5. **The quiet token renewal at boot is skipped in demo.** It is not a googleapis call, but a signed-in browser landing on `?demo` would otherwise flip to `connected` mid-demo and fetch the real calendar over the seed.
6. **`savePrefs` in demo writes memory only** — `lastDockedDay` is written on every dock, and the sheet writes categories/mood; both must work and neither may reach storage. `exitDemo()` reloads prefs and cache from storage, discarding demo state.
7. **The demo sheet's account row still says "Not connected · Sign out".** SPEC says "Connect anywhere exits demo"; the sheet is C's surface and the brief forbids me touching it. Recorded for C as a follow-up; the pill and first-run Connect are the exits this iteration ships.
8. **`n` in demo works** — it is the FAB's twin and gates on the same fact (`isConnected() || isDemo()`).

---

### Task 1: `DemoError`, the flag, inert I/O, writes refused before the apply

**Files:**
- Modify: `src/state.ts` (header comment, storage writers, `fetchMonth`, the three write verbs, replace the stub at the bottom)
- Test: `src/selftest.ts` (two new cases at the end of `cases`)

**Interfaces:**
- Produces: `export class DemoError extends Error` (message fixed); `export function enableDemo(): void`; `export function exitDemo(): void`; `export function isDemo(): boolean`. Task 2 fills `enableDemo` with the seed; Task 1 ships it as flag + empty cache + prefs `{}`.

- [ ] **Step 1: Write the two failing selftest cases** (append before the closing `]` of `cases`):

```ts
  ['demo: writes throw DemoError BEFORE the optimistic apply; offline errors fire AFTER it', async () => {
    const savedAnchor = today()
    const s = stubStorage(), g = stubGis([{ access_token: 'tk', expires_in: 3600 }])
    const f = stubFetch([{ status: 500 }])
    const nav = (globalThis as { navigator?: unknown }).navigator
    try {
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      const draft: EventDraft = { title: 'Nope', category: 'work', allDay: true, start: civilToDay(2026, 2, 20), end: civilToDay(2026, 2, 20), repeat: 'none' }
      // Demo: no notification at all, no overlay at any moment.
      enableDemo()
      const seen: string[][] = []
      const off = onCacheChange(k => { seen.push(k) })
      try { await createEvent(draft); return 'a demo create resolved' } catch (e) {
        if (!(e instanceof DemoError)) return `wrong error: ${(e as Error).message}`
        if (e.message !== 'Demo — connect your Google Calendar to save.') return `message: ${e.message}`
      }
      if (seen.length !== 0) return `demo create notified ${seen.length} time(s); the apply ran`
      if (eventsForMonth('2026-02').some(e => e.title === 'Nope')) return 'demo create left an overlay'
      if (f.calls.length !== 0) return 'demo create reached the wire'
      off(); exitDemo()
      // Offline: the apply runs (one notify with the overlay visible), then the rollback (a second notify).
      Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true, writable: true })
      const seenOff: number[] = []
      const off2 = onCacheChange(() => { seenOff.push(eventsForMonth('2026-02').filter(e => e.title === 'Nope').length) })
      try { await createEvent(draft); return 'an offline create resolved' } catch (e) {
        if (e instanceof DemoError) return 'offline threw DemoError'
        if (!/Offline/.test((e as Error).message)) return `wrong offline error: ${(e as Error).message}`
      }
      off2()
      if (seenOff.length !== 2) return `offline notified ${seenOff.length} time(s), expected apply + rollback`
      if (seenOff[0] !== 1 || seenOff[1] !== 0) return `offline overlay sequence: ${seenOff.join(',')}`
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true })
      exitDemo(); await signOut(); f.restore(); g.restore(); s.restore(); _resetForTest(); _setAnchorForTest(savedAnchor)
    }
    return null
  }],

  ['demo: a whole demo session writes localStorage zero times', async () => {
    const savedAnchor = today()
    const s = stubStorage(), g = stubGis([{ access_token: 'tk', expires_in: 3600 }])
    const f = stubFetch([{ body: { items: [] } }])
    const real = globalThis.localStorage
    let writes = 0
    const counting = { ...real, getItem: (k: string) => real.getItem(k), setItem: (k: string, v: string) => { writes++; real.setItem(k, v) }, removeItem: (k: string) => { writes++; real.removeItem(k) }, clear: () => { writes++; real.clear() } }
    // why: the counting shim implements the Storage surface state.ts uses, not its index signature
    Object.defineProperty(globalThis, 'localStorage', { value: counting as unknown as Storage, configurable: true, writable: true })
    try {
      _resetForTest(); configure({}); _setAnchorForTest(civilToDay(2026, 2, 11))
      enableDemo()
      ensureMonthsFor([asWeek(-60), asWeek(0), asWeek(60)])
      await _settleForTest()
      savePrefs({ ...prefs(), mood: 'dusk', lastDockedDay: civilToDay(2026, 3, 2) })
      if (prefs().mood !== 'dusk') return 'demo prefs did not update in memory'
      for (const run of [
        () => createEvent({ title: 'x', category: 'work', allDay: true, start: civilToDay(2026, 2, 20), end: civilToDay(2026, 2, 20), repeat: 'none' }),
        () => updateEvent(eventsForMonth('2026-02')[0]?.id ?? 'none', { title: 'y', category: 'work', allDay: true, start: civilToDay(2026, 2, 20), end: civilToDay(2026, 2, 20), repeat: 'none' }, 'instance'),
        () => deleteEvent(eventsForMonth('2026-02')[0]?.id ?? 'none', 'instance'),
      ]) { try { await run() } catch (e) { if (!(e instanceof DemoError)) return `wrong error: ${(e as Error).message}` } }
      _flushForTest()
      if (writes !== 0) return `${writes} localStorage write(s) during demo`
      if (f.calls.length !== 0) return `${f.calls.length} wire call(s) during demo`
      if (monthState('2020-01') !== 'absent') return 'an unseeded month was not left absent'
      exitDemo()
      if (prefs().mood !== undefined) return 'exitDemo kept the demo prefs'
    } finally { Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true }); exitDemo(); await signOut(); f.restore(); g.restore(); s.restore(); _resetForTest(); _setAnchorForTest(savedAnchor) }
    return null
  }],
```

Add `DemoError, enableDemo, exitDemo, isDemo` to the `state.ts` import in `selftest.ts`.

- [ ] **Step 2: Run** `npm run selftest` — expected: both new cases FAIL (`enableDemo` throws "STAGE 06: not implemented" / `DemoError` undefined; tsc via `npm run build` also fails on the missing exports).

- [ ] **Step 3: Implement in `state.ts`.**

Replace the stub with:

```ts
// ---------- Demo (stage 06) ----------

/** SPEC "Demo mode": thrown by every write verb BEFORE the optimistic apply. */
export class DemoError extends Error {
  constructor() { super('Demo — connect your Google Calendar to save.'); this.name = 'DemoError' }
}

let demo = false

export function isDemo(): boolean { return demo }

/** Replaces the in-memory cache and prefs with the seed; storage is neither read nor written again until exitDemo(). */
export function enableDemo(): void {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
  demo = true
  loaded = true
  pending.clear()
  inflight.clear()
  authGate = false
  prefsValue = {}
  cache = { v: 1, months: {} }   // Task 2 fills this from demoSeed(anchor)
}

/** Drops every demo byte and re-reads storage. A no-op when not in demo. */
export function exitDemo(): void {
  if (!demo) return
  demo = false
  pending.clear()
  inflight.clear()
  loaded = false
  ensureLoaded()
}
```

Then the guards:
- `saveCache()`: first line `if (demo) return`.
- `savePrefs()`: after `prefsValue = { ...p }`, `if (demo) return`.
- `fetchMonth()`: first line `if (demo) return Promise.resolve()` (unseeded months stay `absent`; a forced post-write refetch cannot happen because writes throw first).
- `withToken()`: first line `if (demo) throw new DemoError()` — belt and braces at the identity boundary so no future path can reach `gcal.ts`.
- `createEvent`/`updateEvent`/`deleteEvent`: `if (demo) throw new DemoError()` as the first statement after `ensureLoaded()`, before `findEvent`/`pending.set`/`notify`.
- `_resetForTest()`: add `demo = false`.
- Header comment: replace "Only enableDemo() is still unimplemented (stage 06)" with a demo sentence.

- [ ] **Step 4: Run** `npm run selftest` → 59/59 (57 + 2). `npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit** — `demo: DemoError before the optimistic apply, inert I/O under the flag`.

---

### Task 2: The seed

**Files:**
- Modify: `src/state.ts` (a `demoSeed(anchor)` pure function, called by `enableDemo`)
- Test: `src/selftest.ts` (one new case)

**Interfaces:**
- Produces: `export function _demoSeedForTest(anchor: DayNumber): Record<MonthKey, MonthEntry>` (test-only, extends stage-01 ruling 2 like `_setAnchorForTest`).

Seed contract (SPEC "Demo mode" + the brief): months `anchor-8 .. anchor+8` (17); mulberry32 with seed `0x5EED`; every event id prefixed `demo:`; an event crossing a month boundary stored in every month it spans (the cache invariant `spansForWeek` depends on); `fetchedAt: 0` is wrong (`needsFetch` is moot under the flag, but `warmCache()` reads `ready`) — use `Date.now()`.

Render paths, each anchored to `today()`:
1. **21-day span across three rows:** Monday of week +2 through Sunday of week +4, `work`, "Product offsite".
2. **Weekly recurring timed chip with `recurringEventId`:** every Tuesday 09:15–10:00 across all 17 months, `work`, "Team sync", ids `demo:sync:<day>`, `recurringEventId: 'demo:sync'`. And a second series, Thursday 18:30 "Run club", `personal`.
3. **Monthly financial all-day:** the 1st of each month "Rent", `financial`; **quarterly:** the 15th of Jan/Apr/Jul/Oct "Quarterly taxes", `financial`.
4. **Weekend spans:** Sat–Sun of week +1 "Cabin weekend" (`personal`), and Fri–Mon of week −3 "Long weekend away" (`personal`).
5. **Overflow day:** `today()+3` carries five all-day events ("Dentist", "Car service", "Parcel", "Call Mum", "Library due") across `other`/`personal` so the year cell drops to 3 bars and the panel lists all five; the month cell shows `+N`.
6. **Random filler:** per month, 6–10 events from a title table, category weighted work/personal/other, 70% timed (chips, 30–90 min from 08:00–19:00), 30% all-day 1–3 days, drawn from mulberry32 so the layout is identical on every run for a given anchor.
7. **Every seed category:** work, personal, financial, other by name — the seed resolves names → colorId through `allCategories()` at seed time so a renamed seed never silently drops a category. Task 4 adds Vacation/Blackout runs after the rebase.

- [ ] **Step 1: Failing case:**

```ts
  ['demo: the seed is deterministic, spans 17 months, and exercises every render path', () => {
    const anchor = civilToDay(2026, 9, 5)
    const a = _demoSeedForTest(anchor), b = _demoSeedForTest(anchor)
    if (JSON.stringify(a) !== JSON.stringify(b)) return 'two seeds for one anchor differ'
    const keys = Object.keys(a).sort()
    if (keys.length !== 17 || keys[0] !== '2026-01' || keys[16] !== '2027-05') return `months: ${keys.length} (${keys[0]}..${keys[16]})`
    const all = new Map<string, StoredEvent>()
    for (const [k, m] of Object.entries(a)) {
      if (m.state !== 'ready') return `${k} is ${m.state}`
      for (const e of m.events) {
        all.set(e.id, e)
        // The cache invariant: an event lives in EVERY month it spans, and only those.
        for (let d = e.start; d <= e.end; d = addDays(d, 1)) if (a[monthKey(d)]?.events.some(x => x.id === e.id) !== true) return `${e.id} missing from ${monthKey(d)}`
        if (monthKey(e.start) !== k && monthKey(e.end) !== k && !(e.start < civilToDay(Number(k.slice(0, 4)), Number(k.slice(5)), 1))) return `${e.id} in ${k} but spans neither end there`
      }
    }
    const evs = [...all.values()]
    const long = evs.find(e => e.allDay && e.end - e.start === 20)
    if (long === undefined || offsetOf(long.start) !== 0) return 'no 21-day Mon..Sun span'
    if (weekOf(long.start) !== 2 + weekOf(anchor) - weekOf(anchor)) { /* anchored: see below */ }
    const chips = evs.filter(e => !e.allDay && e.recurringEventId !== undefined)
    if (chips.length < 60) return `recurring timed chips: ${chips.length}`
    if (!chips.every(e => offsetOf(e.start) === 1 || offsetOf(e.start) === 3)) return 'a recurring chip is off its weekday'
    const colorIds = new Set(evs.map(e => e.colorId))
    for (const c of ['9', '10', '5', '8']) if (!colorIds.has(c)) return `seed category colorId ${c} unused`
    const overflow = addDays(anchor, 3)
    const onOverflow = evs.filter(e => e.allDay && e.start <= overflow && e.end >= overflow)
    if (onOverflow.length < 4) return `overflow day carries ${onOverflow.length} all-day events`
    const rent = evs.filter(e => e.title === 'Rent')
    if (rent.length !== 17) return `Rent: ${rent.length}`
    if (!evs.some(e => e.allDay && offsetOf(e.start) === 5 && offsetOf(e.end) === 6)) return 'no Sat..Sun weekend span'
    if (!evs.every(e => e.id.startsWith('demo:'))) return 'an id lacks the demo: prefix'
    return null
  }],
```

(Drop the dead `weekOf` line when writing it for real — assert `long.start === dayAt(asWeek(weekOf(anchor) + 2), asOffset(0))` after `_setAnchorForTest(anchor)` instead.)

- [ ] **Step 2: Run** → FAIL (`_demoSeedForTest` missing).
- [ ] **Step 3: Implement** `mulberry32`, `demoSeed`, wire into `enableDemo` (`cache = { v: 1, months: demoSeed(anchor) }`), export `_demoSeedForTest = demoSeed`.
- [ ] **Step 4: Run** `npm run selftest` → 60/60.
- [ ] **Step 5: Commit** — `demo: a deterministic 17-month seed anchored to today, every render path`.

---

### Task 3: Entry and exit — `?demo`, the first-run button, the pill

**Files:**
- Modify: `src/chrome.ts` (`ChromeHost.onDemoExit`, `Conn` gains `'demo'`, `buildFirstRun` takes `onDemo`, `paintSlot` demo branch, `syncConnection` order, FAB gating)
- Modify: `src/main.ts` (`?demo` entry after `applyTheme()`; `onDemoExit` in the `chrome.mount` host; `n` gating; skip quiet renewal in demo; `state.isDemo` on the DEV seam)

**Interfaces:**
- `ChromeHost.onDemoExit(): void` — main.ts re-runs `applyTheme()`, re-arms `lastRange`, invalidates both views.
- `chrome.ts` calls `state.enableDemo()` from the button, then `host.onDemoEntered()`? No — keep one direction: the button calls `host.enterDemo()`; main.ts does `state.enableDemo(); applyTheme(); ...; chromeCtl.syncConnection()`. So `ChromeHost` gains `enterDemo(): void` and `onDemoExit(): void`.

- [ ] **Step 1: `chrome.ts`**
  - `type Conn = 'first-run' | 'stale' | 'connected' | 'demo'`.
  - `buildFirstRun(onConnect, onDemo)`: the demo button enabled, `id = 'fr-demo'`, click → `onDemo`; delete the "later release" note and its `demoNote` const.
  - `syncConnection`: `const next: Conn = state.isDemo() ? 'demo' : auth.isSignedIn() ? 'connected' : ...`. FAB: `fab.disabled = conn !== 'connected' && conn !== 'demo'`.
  - `paintSlot`: 
    ```ts
    if (conn === 'demo') {
      const pill = el('button', 'set-pill', 'Demo · Connect')
      pill.id = 'demo-pill'; pill.type = 'button'; pill.dataset['demo'] = ''
      pill.addEventListener('click', leaveDemo)
      const av = el('button', 'set-avatar'); av.id = 'avatar'; av.type = 'button'
      av.setAttribute('aria-label', 'Settings')   // no dot: the dot exists only in the connected state
      av.addEventListener('click', () => toggleSheet())
      slot.append(pill, av); return
    }
    ```
  - `leaveDemo()`: `state.exitDemo(); host.onDemoExit(); connect()`. And `connect()` itself starts with `if (state.isDemo()) { state.exitDemo(); host.onDemoExit() }` so first-run Connect and Reconnect both exit ("Connect anywhere").
  - `isConnected()` unchanged.

- [ ] **Step 2: `main.ts`**
  - After `chrome.mount(...)`: nothing. Entry lives right after `applyTheme()` at the top of the non-selftest branch? No — `state.enableDemo()` must run before the scroller's first `ensureMonthsFor`, i.e. before `scroll.mount`. Put it immediately after the `else {` that opens the app branch:
    ```ts
    const params = new URLSearchParams(location.search)
    if (params.has('demo')) {
      state.enableDemo()
      applyTheme()
      // Demo never survives a reload (SPEC): the flag lives in memory, so the URL must not carry it either.
      params.delete('demo')
      const rest = params.toString()
      history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash)
    }
    ```
  - Host: `enterDemo: () => { state.enableDemo(); applyTheme(); lastRange = { first: NaN, last: NaN }; ctl.invalidate(); yearCtl?.invalidate(); chromeCtl.syncConnection() }` and `onDemoExit: () => { applyTheme(); lastRange = { first: NaN, last: NaN }; ctl.invalidate(); yearCtl?.invalidate() }`. (`chromeCtl` is assigned by `chrome.mount`'s return, so reference it lazily inside the arrow — it is in scope by call time.)
  - `n`: `if (!chromeCtl.isConnected() && !state.isDemo()) return`.
  - Quiet renewal: wrap in `if (!state.isDemo())`.
  - DEV seam: add `state`.

- [ ] **Step 3: `npx tsc --noEmit`, `npm run selftest`** → green. Start `npm run dev`, derive the port, headless-check `/?demo` renders `.bar` elements and `#demo-pill`; `/` renders `#firstrun` with `#fr-demo` enabled. (The full probe script is Task 6.)
- [ ] **Step 4: Commit** — `demo: ?demo and the first-run button enter it; the Demo · Connect pill leaves it into sign-in`.

---

### Task 4: Rebase on A; the planning categories in the seed

**Files:**
- Modify: `src/state.ts` (`enableDemo` prefs, seed runs), `src/selftest.ts` (extend the seed case)

- [ ] **Step 1:** `git -C /Users/admin/_git/repos/bramwell-B fetch origin planning-layer`; `git log --oneline HEAD..origin/planning-layer`; `git cat-file -e origin/planning-layer:src/plan.ts`. If both hold: `git rebase origin/planning-layer`, resolve, `npm run selftest && npm run build`. If not: skip to Task 5 and record.
- [ ] **Step 2 (only after a successful rebase):** in `enableDemo`, `prefsValue = { categories: allCategories().map(c => c.name === 'vacation' ? { ...c, budgetDays: 30 } : c) }` — read after `configure({})`? `state.ts` cannot call `configure` (main.ts is the single writer). Instead: `enableDemo()` sets `prefsValue = { categories: demoCategories() }` where `demoCategories()` builds from `allCategories()` **as currently configured** — at `?demo` entry that is the seed (prefs were `{}` on a cold profile) or the user's own set (warm profile), which is fine: the demo customises whatever is configured, and `main.ts` calls `applyTheme()` right after so `configure()` receives it. Seed: three Vacation runs in the current civil year (5 + 4 + 3 days = 12 → "12 / 30"), one Blackout block of 5 days, only if those names exist in the configured set.
- [ ] **Step 3:** extend the seed case: `vacation` days used in the anchor's year = 12; one blackout run; `prefs().categories` in demo carries `budgetDays: 30` on `vacation`.
- [ ] **Step 4:** selftest + build green. Commit — `demo: seed Vacation runs and a Blackout block so the strip reads 12 / 30`.

---

### Task 5: README and LICENSE

**Files:**
- Rewrite: `README.md` (product paragraph, run, deploy-your-own, beta on-ramp facts, build record); Create: `LICENSE` (MIT, Studio Relativity, 2026).

- [ ] **Step 1:** write both. Deploy section copies the origin rules from SPEC "MANUAL SETUP" (exact-match origins, port is part of the match, Testing consent, test users ≤100, unverified-app interstitial, consent expiry) and "DEPLOY" (domain root, HTTPS, Node from `.node-version`, env vars in the dashboard, the `sw.js` cache-control check). The build record is the stage table with each stage's status.
- [ ] **Step 2:** Commit — `readme and licence: what it is, run it, deploy your own, the build record; MIT`.

---

### Task 6: Verification

**Files:**
- Create: `scripts/shot-demo.mjs` (CDP driver, no localStorage seed script — demo is the cold-profile path), `package.json` script `shot:demo`.
- Create: `06_demo/output/verification.md`; flip `06_demo/CONTEXT.md` Status to BUILT.

Probes, on a fresh profile, `Network.enable` with `requestWillBeSent` collected for the whole run:
1. `/?demo`: `.bar`/`.chip` counts > 0, `#firstrun` absent or hidden, `#demo-pill` HIT, `#avatar` HIT, `#fab` enabled and HIT, `location.search === ''`.
2. Zero requests whose host ends in `googleapis.com` across the whole run.
3. Open a day (pointer sequence), `.dp-add` HIT, click, type a title, click `.dp-save`; a `.toast` appears with the exact demo message; `.dp-err` shows it; the day's `.dp-ev` count is unchanged; no `tmp:` overlay ever rendered (poll `.bar`/`.chip` titles for the typed one across frames).
4. Year view via `#btn-mode`: `.yrcell` count 365/366, overflow day shows 3 `.yrbar`s and its panel lists 5. If A landed: `.plan-strip`/chip for Vacation reads `12 / 30`; a paint drag on two free days yields the demo toast and the figure is unchanged.
5. Settings in memory: `#avatar` click → sheet; pick Mood "Dusk"; `--surface` changes; `localStorage.length === 0`.
6. `localStorage.length === 0` and `JSON.stringify(localStorage) === '{}'` after all of the above.
7. `#demo-pill` click: `window.bramwell.state.isDemo() === false`, pill gone; sign-in was attempted (GIS popup cannot open headless; the toast or first-run appearing is the observable) — `#firstrun` visible within 1s (cold cache).
8. Reload `/` and `/?demo`-then-reload: `#firstrun` visible, `#fr-demo` HIT and enabled, `#fr-demo` click enters demo (bars appear, pill appears).

Both colour schemes via `Emulation.setEmulatedMedia` for probe 1 (a screenshot each for the record).

- [ ] Run, record every field value, write `verification.md` with: gate criteria verbatim → result; rulings 1–8 above; hit-test table; what was not tested (real sign-in from the pill, iOS); upstream amendments needed (CONTEXT.md `enterDemo` → `enableDemo`; C follow-up for the sheet's account row; whether A landed).
- [ ] Commit — `verify: demo gate evidence, headless, both schemes; 06 BUILT`. Push `demo`.
