# Stage 05 — Chrome, PWA, deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `chrome.ts` (first-run, connection state, settings sheet with Colors and Mood, FAB, toasts), `sw.ts` and the PWA shell, delete the stage-02 DEV harness UI, contain the signed-out refetch loop, and deploy to `https://bramwell.no.fail`.

**Architecture:** `chrome.ts` owns every piece of shell UI and imports `auth.ts` and `state.ts` directly; everything it cannot know — the scroll controller, the current view, the render window — arrives through a `ChromeHost` callback record that `main.ts` supplies. `state.ts` gains one module-private latch that stops a signed-out session from issuing more than one token request. `sw.ts` is compiled separately by esbuild into a classic IIFE at `dist/sw.js`, with a precache list generated from what `vite build` really emitted.

**Tech Stack:** Vite 6 + vanilla TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`). No runtime dependencies. esbuild (already a transitive Vite dependency) for the service worker. Cloudflare Pages.

**Spec:** `_references/SPEC.md` — "First-run and connection state", "Settings", "Categories and customization", "PWA", "Layout details", "Motion", "File layout", "State API", "MANUAL SETUP", "DEPLOY". Contract: `05_shell/CONTEXT.md`. Rules: `_references/CONVENTIONS.md`, `_references/DECISIONS.md` ("shell and chrome", "categories and colour").

## Global Constraints

- **Module boundaries are hard.** `auth.ts` is the only file that knows Google auth; `gcal.ts` the only file calling googleapis.com. `chrome.ts` may import `auth.ts`, `state.ts`, `categories.ts`, `dates.ts` — never `gcal.ts`, `scroll.ts`, `render.ts`, `day.ts`, `year.ts`.
- **Leaf modules stay DOM-free.** `categories.ts` never touches the DOM and never imports `state.ts`.
- **A file the `SPEC.md` "File layout" lacks is added there first, then created.** This plan creates `scripts/build-sw.mjs`; `scripts/` is already covered by the layout's `/scripts/ — node-only tooling, never bundled`.
- **No `transition`, `animation` or `@keyframes` declaration outside `src/motion.css`** — not the values, the declarations. Grep-provable.
- **No `any` without a `// why:` comment.**
- **Every "this control works" claim is backed by `document.elementFromPoint()`** at the control's centre resolving to that control. `element.click()` proves nothing.
- **Grep the whole `src/` tree for a bare class token before adding a CSS class** (CONVENTIONS: `.catpick` made the event form unclickable). New shell classes use the `set-` prefix; ids are `firstrun`, `fab`, `sheet`.
- **Any selector that sets `display` re-asserts `[hidden]`.**
- **A background refresh must never destroy transient UI** — the open form, and now the settings sheet.
- **Node floor:** whatever `.node-version` pins (`22`). Build: `npm run build`; output `dist`.
- Verification runs headless Chrome against `npm run dev` in a same-origin iframe, both colour schemes, driven by CDP `Emulation.setEmulatedMedia`. `--blink-settings=preferredColorScheme=2` is banned (crashes Chrome 151).
- Headless Chrome hangs on service-worker registration: SW is verified statically plus on a real install.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/types.ts` | `Prefs` gains `snapStepDays?`, `defaultView?` | 1 |
| `src/state.ts` | the auth gate: one latch, `clearAuthGate()` | 1 |
| `src/selftest.ts` | auth-gate case; `mintName` case | 1, 5 |
| `src/sw.ts` | the service worker (cache-first hashed, network-first rest) | 2 |
| `scripts/build-sw.mjs` | esbuild → `dist/sw.js`, precache list from real output | 2 |
| `index.html`, `public/manifest.webmanifest`, `public/_headers` | PWA metadata and headers | 2 |
| `src/chrome.ts` | first-run, connection state, settings sheet, Colors, Mood, FAB, toasts | 3, 4, 5, 6 |
| `src/categories.ts` | `mintName()` — the pure slug-and-uniquify rule | 5 |
| `src/style.css` | shell classes; `#devbar` deleted | 3, 4, 5, 6 |
| `src/motion.css` | sheet/first-run enter-exit reuse only — no new declarations unless stated | 4 |
| `src/main.ts` | wiring, `ChromeHost`, FAB sequencing, SW registration, harness deletion | 6 |
| `scripts/shot.mjs` | shell probes, all hit-tested | 7 |
| `05_shell/output/verification.md` | the gate record | 8 |

---

### Task 1: The auth gate and the two new prefs fields

Contains the signed-out refetch loop this stage was handed. `getToken()` already coalesces concurrent callers, so a cold window's dozen month loads share one token request — the damage is the *loop*: every range move re-runs `ensureMonthsFor` over months left in `error`, `needsFetch` says yes again, and each retry is a popup the phone blocks without a gesture.

**Files:**
- Modify: `src/types.ts` (the `Prefs` type, ~line 128)
- Modify: `src/state.ts` (`withToken` ~line 249, `fetchMonth` ~line 306, `_resetForTest` ~line 216)
- Modify: `src/selftest.ts` (imports at ~line 9; a new case at the end of `cases`)

**Interfaces:**
- Consumes: nothing.
- Produces: `state.clearAuthGate(): void`. `Prefs.snapStepDays?: 15 | 30 | 45`, `Prefs.defaultView?: 'cal' | 'year'`. Task 6 calls `clearAuthGate()`; Tasks 4 and 6 read and write the two prefs fields.

- [ ] **Step 1: Add the two prefs fields**

In `src/types.ts`, inside `export type Prefs = {`, after the `mood` field and before `lastDockedDay`:

```ts
  /** Absent -> 30. */
  snapStepDays?: 15 | 30 | 45
  /** Absent -> "cal". Read at launch, unlike lastDockedDay: the view a session
   *  opens in is a setting, where the scroll position is not (SPEC "Settings"). */
  defaultView?: 'cal' | 'year'
```

- [ ] **Step 2: Write the failing test**

In `src/selftest.ts`, add `clearAuthGate` to the `./state.ts` import list, and append this case to the end of the `cases` array (after the `'day: form validation rules'` case, keeping the trailing `]`):

```ts
  ['state: a signed-out session issues ONE token request, and a gesture re-arms it', async () => {
    const savedAnchor = today()
    // Every reply fails: this is a signed-out session, and GIS's popup is blocked.
    const s = stubStorage(), g = stubGis([{ error: 'popup_failed' }])
    const f = stubFetch([{ body: { items: [] } }])
    try {
      _resetForTest(); configure({})
      _setAnchorForTest(civilToDay(2026, 2, 11))
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (monthState('2026-02') !== 'error') return `state after a failed token: ${monthState('2026-02')}`
      if (f.calls.length !== 0) return `${f.calls.length} requests reached the wire with no token`
      const cold = g.prompts.length
      if (cold !== 1) return `a cold window made ${cold} token requests, not 1`
      // THE LOOP: each range move re-runs the same months, which are now `error`,
      // and needsFetch says yes every time. The gate must stop it dead.
      for (let i = 0; i < 5; i++) { ensureMonthsFor([asWeek(0)]); await _settleForTest() }
      if (g.prompts.length !== cold) return `the gate leaked: ${g.prompts.length} token requests after 5 range moves`
      // A write is NOT gated: a Save press is itself the gesture a popup needs,
      // and the user has to learn it failed.
      const draft: EventDraft = {
        title: 'T', category: 'work', allDay: true,
        start: civilToDay(2026, 2, 11), end: civilToDay(2026, 2, 11), repeat: 'none',
      }
      const wrote = await createEvent(draft).then(() => true, () => false)
      if (wrote) return 'a create succeeded with no token'
      if (g.prompts.length !== cold + 1) return 'a write was blocked by the auth gate'
      // A gesture re-arms: the error month is refetch-eligible the moment the gate is down.
      const armed = g.prompts.length
      clearAuthGate()
      ensureMonthsFor([asWeek(0)])
      await _settleForTest()
      if (g.prompts.length !== armed + 1) return `clearAuthGate did not re-arm: ${g.prompts.length} vs ${armed + 1}`
    } finally { await signOut(); f.restore(); g.restore(); s.restore(); _resetForTest(); _setAnchorForTest(savedAnchor) }
    return null
  }],
```

- [ ] **Step 3: Run it and verify it fails**

Run: `npm run selftest 2>&1 | tail -20`
Expected: FAIL. `tsc` is not run by `selftest`, so the failure surfaces at runtime as `threw: clearAuthGate is not a function` — or, if the import is stripped, as `a cold window made 6 token requests, not 1`. Either is the correct pre-state. Confirm the total line reads `54/55`.

- [ ] **Step 4: Implement the gate**

In `src/state.ts`, immediately above `async function withToken<T>`:

```ts
/** Set when a token request fails; stops every BACKGROUND month load from asking
 *  again for the rest of the session. Signed out, `getToken()` already coalesces
 *  concurrent callers, so a cold window costs one request — but each range move
 *  re-runs `ensureMonthsFor` over months left in `error`, and on a phone every
 *  retry is a popup the browser blocks without a gesture (SPEC "First-run and
 *  connection state"; observed on iOS Safari as dozens per second). Writes are
 *  deliberately NOT gated: a Save press is itself the gesture, and the user has
 *  to learn the write failed. Cleared only by main.ts, on a successful sign-in
 *  or renewal. */
let authGate = false

export function clearAuthGate(): void {
  authGate = false
}
```

Change the opening of `withToken` so a token failure — not a Calendar failure — arms it:

```ts
async function withToken<T>(fn: (t: string) => Promise<T>): Promise<T> {
  let t: string
  try {
    t = await getToken()
  } catch (e) {
    // Identity failed, not the API. Arm the gate and let the caller surface it.
    authGate = true
    throw e
  }
  try {
    return await fn(t)
  } catch (e) {
```

(the rest of `withToken` is unchanged; only the first `const t = await getToken()` line is replaced.)

In `fetchMonth`, add the gate after the in-flight join and before the staleness check, so a caller may still await a request that is already running:

```ts
  if (authGate && !force) return Promise.resolve()
  if (!force && !needsFetch(key)) return Promise.resolve()
```

In `_resetForTest`, add `authGate = false` — cases share module state and a leaked gate would silently pass later cases:

```ts
export function _resetForTest(): void {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
  cache = { v: 1, months: {} }
  prefsValue = {}
  pending.clear()
  loaded = false
  inflight.clear()
  authGate = false
}
```

- [ ] **Step 5: Run the tests and the type-checker**

Run: `npx tsc --noEmit && npm run selftest 2>&1 | tail -6`
Expected: `tsc` silent (exit 0); selftest ends `55/55`.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/state.ts src/selftest.ts
git commit -m "stage 05: cap a signed-out session at one token request; add snapStepDays/defaultView prefs"
```

---

### Task 2: Service worker, build step, and PWA metadata

**Files:**
- Modify: `src/sw.ts` (replace the 3-line stub entirely)
- Create: `scripts/build-sw.mjs`
- Modify: `package.json` (the `build` script)
- Modify: `index.html` (head metas)
- Modify: `public/manifest.webmanifest`
- Modify: `public/_headers`

**Interfaces:**
- Consumes: nothing.
- Produces: `dist/sw.js` at the site root, a classic IIFE. Task 6 registers it from `main.ts` under `import.meta.env.PROD`.

**A recorded departure from `DECISIONS.md`:** "shell and chrome" says *`vite.config.ts` exists to emit `sw.js` at the site root*. Vite's output is ESM, and a module service worker would break `CONVENTIONS.md`'s static check (*"classic script, no ESM"*) and cut off older iOS. The new reason: **a classic worker cannot come out of Vite's ESM pipeline, so a separate esbuild step emits it.** `vite.config.ts` is left alone. Promote this to `DECISIONS.md` at the gate close.

- [ ] **Step 1: Write the service worker**

Replace the whole of `src/sw.ts`:

```ts
// STAGE 05 — the service worker. Emitted at the site root as a CLASSIC script by
// scripts/build-sw.mjs (esbuild, IIFE); Vite's ESM output cannot produce one, which
// is why this file is not part of the Vite graph. Two strategies (SPEC "PWA"):
// hashed /assets/* are immutable, so cache-first; everything else is network-first
// with the cache as the offline fallback. That pairing is what lets a new deploy
// reach an installed client on the next online open with NO cache-name bump —
// index.html is never served from cache while the network is up, so it always
// names the new hashed assets (CONVENTIONS: "bump nothing by hand for deploys").
declare const self: ServiceWorkerGlobalScope

/** Substituted at build time by scripts/build-sw.mjs with the paths dist REALLY
 *  emits (SPEC "PWA": precache only paths the build really emits). Never a
 *  hand-maintained list — a stale entry makes addAll reject and install fail. */
declare const PRECACHE: readonly string[]

/** One cache, never versioned by hand. See the header comment. */
const CACHE = 'bramwell'

self.addEventListener('install', e => {
  // skipWaiting here, clients.claim on activate: together they are what "reaches
  // an installed client on the next online open" means. Without them the new
  // worker idles until every tab of the old one closes, which on a PWA is rarely.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE as string[]))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

/** A redirected response must never be cached: replayed from the cache it is an
 *  opaque redirect the navigation cannot follow, and the app dead-ends offline
 *  with no way to recover but clearing site data (SPEC "PWA"). `basic` also
 *  excludes opaque cross-origin responses, which cannot be inspected. */
function cacheable(r: Response): boolean {
  return r.ok && !r.redirected && r.type === 'basic'
}

function put(req: Request, res: Response): void {
  // Fire and forget, and clone BEFORE returning: the body is consumed once.
  void caches.open(CACHE).then(c => c.put(req, res))
}

async function cacheFirst(req: Request): Promise<Response> {
  const hit = await caches.match(req)
  if (hit !== undefined) return hit
  const res = await fetch(req)
  if (cacheable(res)) put(req, res.clone())
  return res
}

async function networkFirst(req: Request): Promise<Response> {
  try {
    const res = await fetch(req)
    if (cacheable(res)) put(req, res.clone())
    return res
  } catch (e) {
    const hit = await caches.match(req)
    if (hit !== undefined) return hit
    // Offline navigation falls back to '/', NOT '/index.html' — the host 307s
    // that path, and a 307 is exactly what cacheable() refuses to store.
    if (req.mode === 'navigate') {
      const root = await caches.match('/')
      if (root !== undefined) return root
    }
    throw e
  }
}

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // Same-origin only, so googleapis.com and Supabase can never enter this cache
  // (SPEC "PWA"). Leaving them unhandled costs nothing: the browser fetches them
  // exactly as it would with no worker installed.
  if (url.origin !== self.location.origin) return
  e.respondWith(url.pathname.startsWith('/assets/') ? cacheFirst(req) : networkFirst(req))
})

export {}
```

- [ ] **Step 2: Write the build step**

Create `scripts/build-sw.mjs`:

```js
// Emits dist/sw.js: a CLASSIC (IIFE) service worker whose precache list is built
// from what `vite build` really wrote, never hand-maintained (SPEC "PWA"). esbuild
// is already a Vite dependency, so this adds no package. Runs AFTER vite build —
// see the `build` script in package.json.
import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { build } from 'esbuild'

const DIST = 'dist'

/** Every file vite actually emitted, as root-absolute URL paths. */
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue      // never precache dist/.vite/*
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push('/' + relative(DIST, p).split(sep).join('/'))
  }
  return out
}

const emitted = walk(DIST)
const precache = [
  // '/' is the offline navigation fallback and the only name index.html is
  // precached under: the host 307s '/index.html', and a redirect is never cached.
  '/',
  ...emitted.filter(p => p !== '/index.html' && p !== '/sw.js' && p !== '/_headers'),
]

await build({
  entryPoints: ['src/sw.ts'],
  outfile: join(DIST, 'sw.js'),
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  define: { PRECACHE: JSON.stringify(precache) },
})

console.log(`sw.js: ${precache.length} precached paths`)
for (const p of precache) console.log(`  ${p}`)
```

- [ ] **Step 3: Wire it into the build**

In `package.json`, replace the `build` script:

```json
    "build": "tsc --noEmit && vite build && node scripts/build-sw.mjs",
```

- [ ] **Step 4: Add the PWA metas**

In `index.html`, inside `<head>`, immediately after the `theme-color` meta:

```html
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Bramwell" />
    <link rel="apple-touch-icon" href="/icon-192.png" />
```

- [ ] **Step 5: Fix the manifest**

Replace `public/manifest.webmanifest`. `scope` was missing, and the old colours were `#0f1115` — the *cool* mood's dark surface, not the graphite theme `index.html` already paints:

```json
{
  "id": "/",
  "name": "Bramwell",
  "short_name": "Bramwell",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#141210",
  "theme_color": "#141210",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 6: Keep `/sw.js` uncacheable**

Replace `public/_headers`:

```
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

# The worker itself must never be served stale, or a deploy can never land
# (SPEC "PWA"). Vite's own assets are content-hashed, so they are immutable.
/sw.js
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

- [ ] **Step 7: Build and verify statically**

Run:

```bash
npm run build && \
  echo "--- root ---" && ls dist && \
  echo "--- classic? ---" && head -c 120 dist/sw.js && echo && \
  echo "--- no esm ---" && grep -cE '^(import|export)[ {]' dist/sw.js
```

Expected: `dist/sw.js` exists at the root; the first bytes are `(()=>{` (an IIFE), not `import`; the ESM grep prints `0`. Confirm the precache list printed by the script names only paths that appear in `ls -R dist`, and that `/index.html` is **not** among them while `/` is.

- [ ] **Step 8: Commit**

```bash
git add src/sw.ts scripts/build-sw.mjs package.json index.html public/manifest.webmanifest public/_headers
git commit -m "stage 05: service worker, esbuild build step, PWA manifest and headers"
```

---

### Task 3: `chrome.ts` — mount, first-run screen, connection state

**Files:**
- Modify: `src/chrome.ts` (implement `mount`; `toast` is untouched)
- Modify: `src/style.css` (shell classes)

**Interfaces:**
- Consumes: `auth.isSignedIn/signIn/signOut`, `state.prefs/savePrefs`.
- Produces:

```ts
export type ChromeHost = {
  avatarSlot: HTMLElement
  warmCache(): boolean
  setSnapStep(step: 15 | 30 | 45): void
  addHere(): void
  onConnected(): void
  onPrefsChanged(): void
}
export type ChromeController = {
  syncConnection(): void
  isSheetOpen(): boolean
  openSheet(): void
}
export function mount(root: HTMLElement, host: ChromeHost): ChromeController
export function toast(message: string): void      // unchanged
```

Task 4 adds the sheet behind `isSheetOpen()`; Task 6 supplies the host from `main.ts`.

- [ ] **Step 1: Grep for class-token collisions before writing any CSS**

CONVENTIONS requires this — a class with no rule of its own is invisible to a `grep '\.name' style.css`:

```bash
grep -rnE "firstrun|\bfab\b|\bsheet\b|\bpill\b|\bavatar\b|set-" src/ scripts/
```

Expected: only `hdr-avatar` (the reserved header span in `main.ts` and its rule in `style.css`) and the word `sheet` inside comments. If any bare token collides, rename before continuing and note it.

- [ ] **Step 2: Replace the `mount` stub and add the connection machine**

In `src/chrome.ts`, replace the first four lines (the STAGE 05 comment and the throwing `mount`) with the block below. Leave the `host`/`toast` section beneath it exactly as it is, then append the new code after it.

At the top of the file:

```ts
// STAGE 05 — first-run, connection state, settings sheet (Colors + Mood), FAB, toasts.
// Imports auth.ts and state.ts directly, per this stage's contract; everything it
// cannot know — the scroll controller, the current view, the render window — arrives
// through ChromeHost. Never imports scroll/render/day/year/gcal.
import * as auth from './auth.ts'
import * as state from './state.ts'
import type { MoodId, StoredCategory } from './types.ts'
// NOTE: categories.ts is imported in Task 5, which is the first task that uses
// it. Importing `mintName` here would not type-check — it does not exist yet.

/** SPEC "First-run and connection state": the reconnect pill waits 2.5s so a quiet
 *  renewal does not cry wolf. NOT a motion token — it decides WHEN a UI state is
 *  entered, not how anything animates, so motion.css is the wrong home and
 *  CONVENTIONS' scroll.ts carve-out does not reach it either. Flagged in
 *  verification.md as a third case the convention does not yet name. */
const RECONNECT_GRACE_MS = 2500

/** Low-emphasis support line on first-run. CONFIRM AT THE GATE. */
const SUPPORT_EMAIL = 'studiorelativity@gmail.com'

/** first-run = signed out AND cold. stale = signed out over a warm cache: the
 *  calendar renders read-only and the pill offers the way back. connected = avatar. */
type Conn = 'first-run' | 'stale' | 'connected'

export type ChromeHost = {
  /** The `.hdr-avatar` span main.ts reserves. Chrome fills it and nothing else does. */
  avatarSlot: HTMLElement
  /** DECISIONS: computed from monthState over the render window. Decides
   *  first-run vs read-only — the first-run screen never covers a warm cache. */
  warmCache(): boolean
  setSnapStep(step: 15 | 30 | 45): void
  /** FAB / `n`. main.ts resolves the target day and drives the expansion. */
  addHere(): void
  /** A sign-in just succeeded. main.ts re-arms the render window: clearing the
   *  auth gate is not enough on its own, because `onRangeChange` short-circuits
   *  while the range is unchanged, so nothing would ask for the months again. */
  onConnected(): void
  /** Prefs were written: main.ts re-runs applyTheme and repaints. */
  onPrefsChanged(): void
}

export type ChromeController = {
  /** Recompute first-run / stale / connected. Called at boot, after sign-in and
   *  sign-out, and on every cache change — which is how a withToken failure deep
   *  inside state.ts reaches the pill without inventing an auth event bus. */
  syncConnection(): void
  /** The transient-UI rule (CONVENTIONS): main.ts holds its repaint while true. */
  isSheetOpen(): boolean
  /** The harness's way in. The avatar is the USER's way in, but it exists only
   *  while signed in, which headless Chrome cannot be — so the sheet's probes
   *  would otherwise be unreachable (scripts/shot.mjs). */
  openSheet(): void
}
```

- [ ] **Step 3: Build the first-run screen and the mount body**

Append to `src/chrome.ts`:

```ts
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag)
  if (cls !== undefined) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

function buildFirstRun(onConnect: () => void): HTMLElement {
  const root = el('div')
  root.id = 'firstrun'
  const card = el('div', 'set-fr-card')

  const mark = el('div', 'set-fr-mark', 'B')
  mark.setAttribute('aria-hidden', 'true')
  const name = el('h1', 'set-fr-name', 'Bramwell')
  const desc = el('p', 'set-fr-desc', 'A perpetual calendar over your Google Calendar.')

  const lines = el('ul', 'set-fr-lines')
  for (const t of [
    'Scroll forever — no month boundaries and no paging.',
    'Tap a day to open it in place. No drawer, no overlay.',
    'Your own categories, colours and moods.',
  ]) lines.append(el('li', undefined, t))

  const connect = el('button', 'set-fr-connect', 'Connect Google Calendar')
  connect.id = 'fr-connect'
  connect.type = 'button'
  connect.addEventListener('click', onConnect)

  // Stage 06 owns demo mode; state.enableDemo() throws today. Shipped visibly
  // disabled rather than omitted, so the gate judges the real composition.
  const demo = el('button', 'set-fr-demo', 'Try the demo')
  demo.type = 'button'
  demo.disabled = true
  const demoNote = el('p', 'set-fr-note', 'Demo mode arrives in a later release.')

  const privacy = el('p', 'set-fr-note',
    'Events live only in your Google Calendar. Bramwell keeps no copy of its own.')

  const support = el('a', 'set-fr-support', 'Something wrong? Get in touch.')
  support.href = `mailto:${SUPPORT_EMAIL}`

  card.append(mark, name, desc, lines, connect, demo, demoNote, privacy, support)
  root.append(card)
  return root
}

export function mount(root: HTMLElement, host: ChromeHost): ChromeController {
  let conn: Conn = 'first-run'
  let graceTimer: ReturnType<typeof setTimeout> | null = null
  /** True once the grace has elapsed for the CURRENT stale spell. Reset whenever
   *  the connection state changes, so a reconnect-then-drop waits again. */
  let graced = false

  let firstRun: HTMLElement | null = null

  function connect(): void {
    void auth.signIn().then(
      () => { state.clearAuthGate(); host.onConnected(); api.syncConnection() },
      (e: Error) => { toast(e.message); api.syncConnection() },
    )
  }

  function paintSlot(): void {
    const slot = host.avatarSlot
    slot.replaceChildren()
    if (conn === 'first-run') return
    if (conn === 'stale') {
      if (!graced) return                       // the 2.5s grace: do not cry wolf
      const pill = el('button', 'set-pill', 'Reconnect')
      pill.id = 'reconnect'
      pill.type = 'button'
      pill.addEventListener('click', connect)
      slot.append(pill)
      return
    }
    const av = el('button', 'set-avatar')
    av.id = 'avatar'
    av.type = 'button'
    av.setAttribute('aria-label', 'Settings')
    // No profile scope — calendar.events carries no name — so the mark is generic
    // and the DOT is the only thing bound to auth state (SPEC).
    av.append(el('span', 'set-avatar-dot'))
    av.addEventListener('click', () => toggleSheet())
    slot.append(av)
  }

  const api: ChromeController = {
    syncConnection(): void {
      const next: Conn = auth.isSignedIn() ? 'connected' : host.warmCache() ? 'stale' : 'first-run'
      if (next !== conn) {
        conn = next
        graced = false
        if (graceTimer !== null) { clearTimeout(graceTimer); graceTimer = null }
        if (conn === 'stale') {
          graceTimer = setTimeout(() => { graceTimer = null; graced = true; paintSlot() }, RECONNECT_GRACE_MS)
        }
      }
      // The first-run screen never covers a warm cache (SPEC).
      if (conn === 'first-run') {
        if (firstRun === null) { firstRun = buildFirstRun(connect); root.append(firstRun) }
        firstRun.hidden = false
      } else if (firstRun !== null) {
        firstRun.hidden = true
      }
      // Read-only while stale: the FAB is the one write entry point chrome owns.
      fab.disabled = conn !== 'connected'
      paintSlot()
    },
    isSheetOpen(): boolean { return sheet !== null && !sheet.hidden },
    openSheet(): void { if (!api.isSheetOpen()) toggleSheet() },
  }

  const fab = el('button', 'set-fab', '+')
  fab.id = 'fab'
  fab.type = 'button'
  fab.setAttribute('aria-label', 'Add event')
  fab.addEventListener('click', () => host.addHere())
  document.body.append(fab)

  api.syncConnection()
  return api
}
```

`toggleSheet` and `sheet` are declared in Task 4; until then, add a temporary stub directly above `mount` so this task compiles on its own:

```ts
let sheet: HTMLElement | null = null
function toggleSheet(): void { /* Task 4 */ }
```

- [ ] **Step 4: Style the first-run screen, the avatar, the pill and the FAB**

Append to `src/style.css`, before the `/* ---------- year view ---------- */` block. No `transition`/`animation` declarations here — they belong to `motion.css`:

```css
/* ---------- shell chrome (stage 05) ---------- */
/* `place-items: safe center` + overflow-y so Connect stays reachable on the
   shortest phone: plain `center` clips the top of an over-tall card (SPEC). */
#firstrun {
  position: fixed; inset: 0; z-index: 20;
  background: var(--surface); color: var(--ink);
  display: grid; place-items: safe center; overflow-y: auto;
  padding:
    calc(24px + env(safe-area-inset-top)) calc(24px + env(safe-area-inset-right))
    calc(24px + env(safe-area-inset-bottom)) calc(24px + env(safe-area-inset-left));
}
.set-fr-card { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; max-width: 340px; }
.set-fr-mark {
  width: 44px; height: 44px; border-radius: 12px;
  background: var(--band-b); box-shadow: var(--el-rest);
  display: grid; place-items: center; font-size: 22px; font-weight: 700;
}
.set-fr-name { margin: 4px 0 0; font-size: 22px; font-weight: 620; }
.set-fr-desc { margin: 0; color: var(--ink-dim); }
.set-fr-lines { margin: 6px 0 10px; padding-left: 18px; color: var(--ink-dim); display: flex; flex-direction: column; gap: 4px; }
.set-fr-connect {
  font: inherit; font-weight: 620; color: var(--surface); background: var(--ink);
  border: 0; border-radius: 10px; padding: 11px 18px; width: 100%;
}
.set-fr-demo {
  font: inherit; color: var(--ink); background: var(--band-b-end);
  border: 0; border-radius: 10px; padding: 11px 18px; width: 100%;
}
.set-fr-demo:disabled { opacity: .45; }
.set-fr-note { margin: 0; font-size: 12px; color: var(--ink-dim); }
.set-fr-support { margin-top: 8px; font-size: 12px; color: var(--ink-dim); }

.set-avatar {
  position: relative; width: 28px; height: 28px; border-radius: 50%;
  background: var(--band-b); border: 0; padding: 0; box-shadow: var(--el-rest);
}
.set-avatar-dot {
  position: absolute; right: -1px; bottom: -1px; width: 9px; height: 9px;
  border-radius: 50%; background: var(--today);
  box-shadow: 0 0 0 2px var(--surface);
}
.set-pill {
  font: inherit; font-size: 12px; font-weight: 620;
  color: var(--surface); background: var(--cat-err);
  border: 0; border-radius: 999px; padding: 5px 10px;
}

/* Reserved by #app's padding-bottom (below) so it can never sit on the last
   row's Sunday events (SPEC "Layout details"; gate row). */
.set-fab {
  position: fixed; z-index: 12;
  right: calc(16px + env(safe-area-inset-right));
  bottom: calc(16px + env(safe-area-inset-bottom));
  width: 48px; height: 48px; border-radius: 50%;
  font: inherit; font-size: 24px; line-height: 1;
  color: var(--surface); background: var(--ink);
  border: 0; box-shadow: var(--el-hover);
}
.set-fab:disabled { opacity: .35; }
```

Then extend the existing `#app` rule (currently `#app { height: 100%; display: flex; flex-direction: column; }`) to reserve the FAB's strip:

```css
#app {
  box-sizing: border-box;                /* the padding below must not add height */
  height: 100%; display: flex; flex-direction: column;
  /* The FAB is fixed, so it cannot push content: the scroller (flex: 1) is shrunk
     by exactly its footprint instead, and scroll.ts re-derives rowHeight from the
     smaller clientHeight with no engine change. Costs a strip on desktop too —
     the deterministic alternative to floating it and hoping. */
  padding-bottom: var(--fab-inset);
}
```

and add the token beside the other layout tokens in `:root`:

```css
  --fab-inset: calc(64px + env(safe-area-inset-bottom));
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no output. (`mount` is not yet called from `main.ts`; that is Task 6.)

- [ ] **Step 6: Commit**

```bash
git add src/chrome.ts src/style.css
git commit -m "stage 05: chrome mount, first-run screen, connection state, FAB shell"
```

---

### Task 4: The settings sheet — account, snap, default view, mood, sound

**Files:**
- Modify: `src/chrome.ts` (replace the Task 3 `toggleSheet` stub)
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `ChromeHost.setSnapStep`, `ChromeHost.onPrefsChanged`; `state.prefs()`, `state.savePrefs()`; `auth.signOut()`.
- Produces: `isSheetOpen()` returns true while open. Task 5 appends the Colors section into `buildSheet`'s `body` element. Task 6 wires `isSheetOpen()` into the repaint guard.

- [ ] **Step 1: Replace the stub with the real sheet**

In `src/chrome.ts`, delete the two temporary stub lines from Task 3 and put this immediately above `export function mount`:

```ts
let sheet: HTMLElement | null = null
let scrim: HTMLElement | null = null
/** Set by mount so the sheet's rows can reach the host without threading it
 *  through every builder. One chrome instance per document. */
let hostRef: ChromeHost | null = null

/** Enter/exit via motion.css's shared utility. The forced reflow between `.enter`
 *  and [data-in] is what makes the transition run — the browser has to commit the
 *  hidden style first (SPEC "Motion"). */
function showEnter(n: HTMLElement): void {
  n.classList.add('enter')
  n.removeAttribute('data-out')
  void n.offsetWidth
  n.dataset['in'] = ''
}

function row(label: string): HTMLElement {
  const r = el('div', 'set-row')
  r.append(el('span', 'set-lbl', label))
  return r
}

/** A segmented control. Values are compared as strings; the caller re-widens. */
function segment(values: readonly string[], current: string, pick: (v: string) => void): HTMLElement {
  const wrap = el('div', 'set-seg')
  for (const v of values) {
    const b = el('button', 'set-segb', v)
    b.type = 'button'
    b.dataset['val'] = v
    b.setAttribute('aria-pressed', String(v === current))
    b.addEventListener('click', () => {
      for (const other of wrap.querySelectorAll('button')) other.setAttribute('aria-pressed', 'false')
      b.setAttribute('aria-pressed', 'true')
      pick(v)
    })
    wrap.append(b)
  }
  return wrap
}

const MOOD_IDS: readonly MoodId[] = ['warm', 'paper', 'cool', 'sage', 'dusk']
const MOOD_LABELS: Record<MoodId, string> =
  { warm: 'Warm', paper: 'Paper', cool: 'Cool', sage: 'Sage', dusk: 'Dusk' }

function buildSheet(): HTMLElement {
  const h = hostRef
  if (h === null) throw new Error('chrome: sheet built before mount')
  const s = el('div', 'set-sheet')
  s.id = 'sheet'
  s.setAttribute('role', 'dialog')
  s.setAttribute('aria-label', 'Settings')

  const body = el('div', 'set-body')
  body.id = 'sheet-body'

  // --- account ---
  const acct = row(auth.isSignedIn() ? 'Google Calendar · Connected' : 'Google Calendar · Not connected')
  const out = el('button', 'set-btn', 'Sign out')
  out.id = 'signout'
  out.type = 'button'
  out.addEventListener('click', () => {
    void auth.signOut().finally(() => { closeSheet(); syncRef?.() })
  })
  acct.append(out)
  body.append(acct)

  // --- snap ---
  const p0 = state.prefs()
  const snap = row('Snap')
  snap.append(segment(['15', '30', '45'], String(p0.snapStepDays ?? 30), v => {
    const step = Number(v) as 15 | 30 | 45
    state.savePrefs({ ...state.prefs(), snapStepDays: step })
    h.setSnapStep(step)
  }))
  body.append(snap)

  // --- default view ---
  // Written only; never switches the CURRENT view. It is the view a session
  // OPENS in (SPEC "Settings"), which main.ts reads at boot.
  const view = row('Default view')
  view.append(segment(['Cal', 'Year'], p0.defaultView === 'year' ? 'Year' : 'Cal', v => {
    state.savePrefs({ ...state.prefs(), defaultView: v === 'Year' ? 'year' : 'cal' })
  }))
  body.append(view)

  // --- Colors: filled by Task 5 ---
  body.append(buildColors())

  // --- mood ---
  const mood = row('Mood')
  const cur = p0.mood ?? 'warm'
  const moods = el('div', 'set-seg')
  for (const id of MOOD_IDS) {
    const b = el('button', 'set-segb', MOOD_LABELS[id])
    b.type = 'button'
    b.dataset['mood'] = id
    b.setAttribute('aria-pressed', String(id === cur))
    b.addEventListener('click', () => {
      for (const other of moods.querySelectorAll('button')) other.setAttribute('aria-pressed', 'false')
      b.setAttribute('aria-pressed', 'true')
      state.savePrefs({ ...state.prefs(), mood: id })
      h.onPrefsChanged()
    })
    moods.append(b)
  }
  mood.append(moods)
  body.append(mood)

  // --- sound: a labelled stub (SPEC "Settings") ---
  const sound = row('Sound')
  const soundBtn = el('button', 'set-btn', 'Off')
  soundBtn.type = 'button'
  soundBtn.disabled = true
  sound.append(soundBtn, el('span', 'set-note', 'Not yet'))
  body.append(sound)

  s.append(body)
  return s
}

/** Set by mount; the sheet's sign-out row needs to re-sync the connection. */
let syncRef: (() => void) | null = null

function closeSheet(): void {
  if (sheet === null) return
  sheet.hidden = true
  if (scrim !== null) scrim.hidden = true
}

function toggleSheet(): void {
  if (sheet !== null && !sheet.hidden) { closeSheet(); return }
  if (scrim === null) {
    scrim = el('div', 'set-scrim')
    scrim.addEventListener('click', () => closeSheet())
    document.body.append(scrim)
  }
  // Rebuilt on every open so it always shows current prefs, and so a category
  // deleted elsewhere cannot leave a stale row behind.
  sheet?.remove()
  sheet = buildSheet()
  document.body.append(sheet)
  scrim.hidden = false
  sheet.hidden = false
  showEnter(sheet)
}
```

In `mount`, immediately after `let graced = false`, add:

```ts
  hostRef = host
  syncRef = () => { api.syncConnection() }
```

and add Escape handling at the end of `mount`, before `api.syncConnection()`:

```ts
  // Escape closes the sheet. day.ts's own Escape handler in main.ts unwinds the
  // form and the expansion; this listener is added AFTER it, so a sheet opened
  // over an expanded day still closes the sheet first.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !api.isSheetOpen()) return
    e.preventDefault()
    e.stopPropagation()
    closeSheet()
  }, { capture: true })
```

- [ ] **Step 2: Style the sheet**

Append to the stage-05 block in `src/style.css`:

```css
.set-scrim { position: fixed; inset: 0; z-index: 14; background: rgba(0, 0, 0, .35); }
.set-sheet {
  position: fixed; z-index: 15;
  top: calc(var(--hdr-h) + 6px);
  right: calc(8px + env(safe-area-inset-right));
  width: min(380px, calc(100vw - 16px));
  max-height: calc(100vh - var(--hdr-h) - 24px);
  overflow-y: auto;
  background: var(--band-b); color: var(--ink);
  border-radius: 14px; box-shadow: var(--el-open);
}
/* Bottom sheet on a phone: a top-right popover is unreachable one-handed. */
@media (max-width: 560px) {
  .set-sheet {
    top: auto; right: 0; left: 0; width: auto;
    bottom: 0; max-height: 82vh;
    border-radius: 14px 14px 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
}
.set-body { display: flex; flex-direction: column; gap: 2px; padding: 10px; }
.set-row { display: flex; align-items: center; gap: 8px; padding: 8px 6px; min-height: 34px; }
.set-lbl { flex: 1; min-width: 0; }
.set-note { font-size: 12px; color: var(--ink-dim); }
.set-btn {
  font: inherit; font-size: 12px; color: var(--ink); background: var(--band-b-end);
  border: 0; border-radius: 8px; padding: 5px 9px;
}
.set-btn:disabled { opacity: .45; }
.set-seg { display: flex; gap: 2px; background: var(--band-b-end); border-radius: 8px; padding: 2px; }
.set-segb {
  font: inherit; font-size: 12px; color: var(--ink-dim);
  background: none; border: 0; border-radius: 6px; padding: 4px 9px;
}
.set-segb[aria-pressed="true"] { color: var(--ink); font-weight: 620; background: var(--surface); }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0 once Task 5's `buildColors()` exists. **If running this task alone**, add a temporary `function buildColors(): HTMLElement { return el('div') }` above `buildSheet` and delete it in Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/chrome.ts src/style.css
git commit -m "stage 05: settings sheet — account, snap, default view, mood, sound stub"
```

---

### Task 5: The Colors section

Every rule in SPEC "Categories and customization" that the settings UI owns: one row per category, label edited in place, a colorId dropdown of Google's eleven names with taken ids disabled, an optional display hex with both swatches shown when they disagree, two-step Remove on every row but the fallback's, and an add button dead at 11 **with the reason visible**.

**Files:**
- Modify: `src/categories.ts` (add `mintName`)
- Modify: `src/selftest.ts` (a `mintName` case)
- Modify: `src/chrome.ts` (`buildColors`)
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `GOOGLE_COLORS`, `state.prefs/savePrefs`, `ChromeHost.onPrefsChanged`.
- Produces: `categories.mintName(label: string, taken: readonly string[]): string`. `buildColors(): HTMLElement`.

- [ ] **Step 1: Write the failing test for `mintName`**

In `src/selftest.ts`, add `mintName` to the `./categories.ts` import list and append this case:

```ts
  ['categories: mintName slugs a label and uniquifies against the current set', () => {
    // A name must satisfy sanitize()'s own NAME_RE, or a minted category would be
    // silently dropped on the next load.
    const ok = /^[a-z0-9-]{1,32}$/
    const cases: [string, string[], string][] = [
      ['Travel', [], 'travel'],
      ['Deep  Work!', [], 'deep-work'],
      ['Travel', ['travel'], 'travel-2'],
      ['Travel', ['travel', 'travel-2'], 'travel-3'],
      ['   ', [], 'category'],
      ['!!!', ['category'], 'category-2'],
      ['ÉLAN', [], 'lan'],
    ]
    for (const [label, taken, want] of cases) {
      const got = mintName(label, taken)
      if (got !== want) return `mintName(${JSON.stringify(label)}, ${JSON.stringify(taken)}) = ${got}, want ${want}`
      if (!ok.test(got)) return `${got} does not satisfy NAME_RE`
    }
    // Length is capped so a very long label cannot mint an unstorable name.
    const long = mintName('x'.repeat(80), [])
    if (long.length > 32) return `a long label minted a ${long.length}-char name`
    return null
  }],
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npm run selftest 2>&1 | tail -8`
Expected: FAIL — `threw: mintName is not a function`. Total reads `55/56`.

- [ ] **Step 3: Implement `mintName`**

In `src/categories.ts`, immediately after the `sanitize` function:

```ts
/** Mint a stable key from a label, uniquified against the names currently in use.
 *  SPEC: names are minted from the label and NEVER re-derived — a rename edits
 *  `label` only. Uniquified against the CURRENT set only, so deleting `travel`
 *  and adding "Travel" lets old events adopt the new one (DECISIONS, accepted).
 *  Pure and exported so the selftest pins the rule rather than a copy of it. */
export function mintName(label: string, taken: readonly string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
  const stem = base === '' ? 'category' : base
  if (!taken.includes(stem)) return stem
  for (let i = 2; ; i++) {
    // Trim the stem, not the suffix: the result must still satisfy NAME_RE's 32.
    const suffix = `-${i}`
    const n = stem.slice(0, 32 - suffix.length) + suffix
    if (!taken.includes(n)) return n
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsc --noEmit && npm run selftest 2>&1 | tail -4`
Expected: `tsc` exit 0; selftest ends `56/56`.

- [ ] **Step 5: Build the Colors section**

In `src/chrome.ts`, delete the Task-4 placeholder `buildColors` if you added one, and insert this above `buildSheet`:

```ts
/** The RESOLVED list, not the raw prefs blob. categories.ts is already configured
 *  from prefs by main.ts (and re-configured by onPrefsChanged after every write
 *  below), so this is fresh — and it is the seed when prefs carries none, which
 *  is how the seed reaches the UI without chrome.ts knowing the seed's values.
 *  Reading the resolved list also means the UI shows what sanitize() really
 *  kept, rather than what was optimistically written. */
function currentCats(): StoredCategory[] {
  return catsAll()
}

function writeCats(next: StoredCategory[], fallbackName: string): void {
  state.savePrefs({ ...state.prefs(), categories: next, fallbackCategory: fallbackName })
  hostRef?.onPrefsChanged()
}

function googleHex(colorId: string): string {
  return GOOGLE_COLORS.find(g => g.id === colorId)?.hex ?? '#616161'
}

function buildColors(): HTMLElement {
  const wrap = el('div', 'set-colors')
  wrap.id = 'colors'
  wrap.append(el('h2', 'set-h2', 'Colors'))

  const cats = currentCats()
  const p = state.prefs()
  const fallbackName = cats.some(c => c.name === (p.fallbackCategory ?? 'other'))
    ? (p.fallbackCategory ?? 'other')
    : (cats[0]?.name ?? 'other')

  /** Structural edits rebuild; label edits do not (DECISIONS). */
  const rebuild = (): void => {
    const fresh = buildColors()
    wrap.replaceWith(fresh)
  }

  for (const c of cats) {
    const r = el('div', 'set-cat')
    r.dataset['cat'] = c.name

    // --- label: edited in place, commits on change/blur, never rebuilds ---
    const lab = el('input', 'set-cat-lab')
    lab.type = 'text'
    lab.value = c.label
    lab.setAttribute('aria-label', `Label for ${c.label}`)
    lab.addEventListener('change', () => {
      // Empty becomes "Untitled" on blur (DECISIONS) — a blank row is unreadable
      // and sanitize() would drop it on the next load.
      const label = lab.value.trim() === '' ? 'Untitled' : lab.value.trim()
      lab.value = label
      writeCats(currentCats().map(x => x.name === c.name ? { ...x, label } : x), fallbackName)
    })

    // --- colorId: Google's names, taken ids disabled elsewhere ---
    const sel = el('select', 'set-cat-cid')
    sel.setAttribute('aria-label', `Google colour for ${c.label}`)
    const takenElsewhere = new Set(cats.filter(x => x.name !== c.name).map(x => x.colorId))
    for (const g of GOOGLE_COLORS) {
      const o = el('option', undefined, g.name)
      o.value = g.id
      // THE INVARIANT: no two categories share a colorId, because the colorId is
      // the only channel by which a read resolves back to a category (SPEC).
      // iOS ignores <option> colouring, which is why these are NAMES not swatches.
      o.disabled = takenElsewhere.has(g.id)
      if (g.id === c.colorId) o.selected = true
      sel.append(o)
    }
    // Structural: the other rows' disabled sets all change.
    sel.addEventListener('change', () => {
      writeCats(currentCats().map(x => x.name === c.name ? { ...x, colorId: sel.value } : x), fallbackName)
      rebuild()
    })

    // --- swatches: BOTH when the display hex and the Google colour disagree.
    // Divergence is a feature, never a surprise (SPEC). ---
    const sw = el('span', 'set-cat-sw')
    const gsw = el('span', 'set-cat-swg')
    gsw.style.setProperty('--sw', googleHex(c.colorId))
    gsw.title = `Google: ${GOOGLE_COLORS.find(g => g.id === c.colorId)?.name ?? c.colorId}`
    sw.append(gsw)
    if (c.displayHex !== undefined && c.displayHex.toLowerCase() !== googleHex(c.colorId).toLowerCase()) {
      const dsw = el('span', 'set-cat-swd')
      dsw.style.setProperty('--sw', c.displayHex)
      dsw.title = `On screen: ${c.displayHex}`
      sw.append(dsw)
    }

    // --- display hex + clear ---
    const hex = el('input', 'set-cat-hex')
    hex.type = 'color'
    hex.value = c.displayHex ?? googleHex(c.colorId)
    hex.setAttribute('aria-label', `Display colour for ${c.label}`)
    hex.addEventListener('change', () => {
      writeCats(currentCats().map(x => x.name === c.name ? { ...x, displayHex: hex.value } : x), fallbackName)
      rebuild()
    })
    const clr = el('button', 'set-btn', '×')
    clr.type = 'button'
    clr.setAttribute('aria-label', `Clear display colour for ${c.label}`)
    clr.disabled = c.displayHex === undefined
    clr.addEventListener('click', () => {
      writeCats(currentCats().map(x => {
        if (x.name !== c.name) return x
        // exactOptionalPropertyTypes: rebuild without the key, never `undefined`.
        const { displayHex: _drop, ...rest } = x
        return rest
      }), fallbackName)
      rebuild()
    })

    r.append(lab, sel, sw, hex, clr)

    // --- delete: two-step, never confirm(), never on the fallback ---
    if (c.name !== fallbackName) {
      const del = el('button', 'set-cat-del', 'Remove')
      del.type = 'button'
      del.addEventListener('click', () => {
        if (del.dataset['confirm'] === undefined) {
          del.dataset['confirm'] = ''
          del.textContent = 'Remove?'
          return
        }
        // Deleting NEVER touches Google: the events keep their colorId and
        // resolve to the fallback on the next read (SPEC).
        writeCats(currentCats().filter(x => x.name !== c.name), fallbackName)
        rebuild()
      })
      r.append(del)
    } else {
      r.append(el('span', 'set-note', 'Fallback'))
    }

    wrap.append(r)
  }

  // --- add: dead at 11, WITH the reason (SPEC) ---
  const addRow = el('div', 'set-cat-add')
  const add = el('button', 'set-btn', 'Add category')
  add.id = 'cat-add'
  add.type = 'button'
  const full = cats.length >= 11
  add.disabled = full
  if (full) {
    addRow.append(add, el('span', 'set-note',
      'Google has 11 event colours, and the colour is the only way a read finds its category.'))
  } else {
    addRow.append(add)
  }
  add.addEventListener('click', () => {
    const taken = new Set(cats.map(x => x.colorId))
    const free = GOOGLE_COLORS.find(g => !taken.has(g.id))
    if (free === undefined) return                    // belt and braces; add is already dead
    const label = 'Untitled'
    writeCats([...currentCats(), {
      name: mintName(label, cats.map(x => x.name)), label, colorId: free.id,
    }], fallbackName)
    rebuild()
  })
  wrap.append(addRow)

  return wrap
}
```

Add the `categories.ts` import for the resolved list at the top of `chrome.ts` — replace the existing categories import line with:

```ts
import { GOOGLE_COLORS, all as catsAll, mintName } from './categories.ts'
```

- [ ] **Step 6: Style the Colors rows**

Append to the stage-05 block in `src/style.css`:

```css
.set-h2 { margin: 12px 6px 4px; font-size: 12px; font-weight: 620; color: var(--ink-dim); text-transform: uppercase; letter-spacing: .06em; }
.set-colors { display: flex; flex-direction: column; gap: 2px; }
.set-cat { display: flex; align-items: center; gap: 6px; padding: 5px 6px; min-height: 34px; }
.set-cat-lab {
  font: inherit; font-size: 13px; color: var(--ink); background: var(--band-b-end);
  border: 0; border-radius: 8px; padding: 5px 8px; flex: 1 1 80px; min-width: 0;
}
.set-cat-cid {
  font: inherit; font-size: 12px; color: var(--ink); background: var(--band-b-end);
  border: 0; border-radius: 8px; padding: 5px 6px; flex: 0 1 104px; min-width: 0;
}
/* Both swatches when the display hex and the Google colour disagree (SPEC). */
.set-cat-sw { display: flex; gap: 2px; flex: none; }
.set-cat-swg, .set-cat-swd { width: 12px; height: 18px; background: var(--sw); flex: none; }
.set-cat-swg { border-radius: 4px 0 0 4px; }
.set-cat-sw > .set-cat-swg:only-child { border-radius: 4px; }
.set-cat-swd { border-radius: 0 4px 4px 0; }
.set-cat-hex { width: 26px; height: 24px; padding: 0; border: 0; background: none; flex: none; }
.set-cat-del {
  font: inherit; font-size: 12px; color: var(--cat-err); background: var(--band-b-end);
  border: 0; border-radius: 8px; padding: 5px 8px; flex: none;
}
.set-cat-del[data-confirm] { background: color-mix(in srgb, var(--cat-err) 18%, transparent); }
.set-cat-add { display: flex; align-items: center; gap: 8px; padding: 6px; }
```

- [ ] **Step 7: Type-check and test**

Run: `npx tsc --noEmit && npm run selftest 2>&1 | tail -4`
Expected: `tsc` exit 0; `56/56`.

- [ ] **Step 8: Commit**

```bash
git add src/categories.ts src/chrome.ts src/selftest.ts src/style.css
git commit -m "stage 05: Colors section — colorId invariant, both swatches, two-step remove, add dead at 11"
```

---

### Task 6: Wire it up in `main.ts`, FAB sequencing, and delete the DEV harness

**Files:**
- Modify: `src/main.ts` (the whole `else` branch; the `import.meta.env.DEV` block at the end)
- Modify: `src/style.css` (delete the `#devbar` rule)

**Interfaces:**
- Consumes: `chrome.mount`, `chrome.ChromeHost`, `chrome.ChromeController`; `state.clearAuthGate`, `state.monthState`; `dates.monthKey`, `dates.addDays`.
- Produces: nothing downstream. Task 7 drives the result through `window.bramwell`.

**A correction to the stage-04 carry-forward.** It says delete `#devbar` **and** `window.bramwell`. `scripts/shot.mjs:429-430` reads `window.bramwell.day` and `window.bramwell.ctl`. So: `#devbar` and the `#harness-*` buttons go — the real first-run screen is what they stood in for — and `window.bramwell` **stays**, DEV-only, narrowed to the seam the harness needs. Promote to `DECISIONS.md` at the gate close.

- [ ] **Step 1: Add the imports and drop the unused one**

At the top of `src/main.ts`: delete `import * as gcal from './gcal.ts'` (it existed only for the console handle), and widen the dates import:

```ts
import { addDays, asDay, asOffset, asWeek, dayToCivil, monthKey } from './dates.ts'
```

- [ ] **Step 2: Track the docked week and compute cache warmth**

`onDock` already writes `lastDockedDay` to prefs. Add a local, because the FAB needs the week and prefs is not read at launch. Immediately after `let lastRange = { first: NaN, last: NaN }`:

```ts
  /** The FAB's anchor in the calendar view (DECISIONS: mid-week day of the
   *  docked week). Local, not read back from prefs — lastDockedDay is written
   *  at dock and never read at launch (SPEC "Settings"). */
  let dockedWeek: WeekIndex = state.weekOf(state.today())

  /** DECISIONS: warmCache is computed from monthState over the render window.
   *  `ready` alone is not enough: a warm start loads months as `ready` from
   *  localStorage and then flips them to `loading`/`error` as the stale-token
   *  refresh fails — and the first-run screen must NEVER cover a warm cache
   *  (SPEC). Both of those states KEEP the prior events, so events-on-screen is
   *  the durable signal. A genuinely empty cached month reads as cold; recorded
   *  in verification.md as a known edge. */
  function warmCache(): boolean {
    if (!Number.isFinite(lastRange.first)) return false
    for (let w = lastRange.first; w <= lastRange.last; w++) {
      const mon = state.dayAt(asWeek(w), MON)
      for (const k of [monthKey(mon), monthKey(addDays(mon, 6))]) {
        const s = state.monthState(k)
        if (s === 'ready') return true
        if ((s === 'loading' || s === 'error') && state.eventsForMonth(k).length > 0) return true
      }
    }
    return false
  }
```

In the `onDock` callback, add `dockedWeek = week` as its first statement.

- [ ] **Step 3: Add the FAB target and the open-then-add sequencing**

After `function closeDay()`, add:

```ts
  /** Set by addHere when the day has to be expanded first; consumed by the very
   *  next remeasure, in the SAME task as the invalidate that attaches the panel.
   *  day.openAdd is documented to do nothing unless its day is already shown. */
  let pendingOpenAdd: DayNumber | null = null

  /** DECISIONS "FAB date": calendar → mid-week day of the docked week; year → today. */
  function fabDay(): DayNumber {
    return inYear() ? state.today() : state.dayAt(dockedWeek, asOffset(3))
  }

  function addHere(): void {
    // fabDay() is read BEFORE any view switch below: in the year view the anchor
    // is today, and leaving the year view first would make it read the calendar's
    // docked week instead (DECISIONS "FAB date").
    const d = fabDay()
    if (inYear()) {
      showYear(false)
      ctl.goToWeek(state.weekOf(d), false)   // the year's anchor is off-screen here
    }
    if (openDay === d) { day.openAdd(d); return }
    pendingOpenAdd = d
    openDayAt(d)
  }
```

In `remeasure`, inside the `pendingFill` branch, immediately after `ctl.invalidate([week])`:

```ts
      // The panel is attached by the invalidate above, so openAdd's precondition
      // (its day is the one shown) now holds. Called BEFORE the contentHeight
      // read below, so the first expansion is already sized for the open form
      // instead of growing again a frame later.
      if (pendingOpenAdd !== null && pendingOpenAdd === openDay) {
        const d = pendingOpenAdd
        pendingOpenAdd = null
        day.openAdd(d)
      }
```

In `closeDay`, immediately after the `if (openDay === null) return`:

```ts
    pendingOpenAdd = null
```

- [ ] **Step 4: Mount chrome and wire the host**

Replace the line `ctl.setSnapStep(30)` and the `ctl.goToWeek(...)` line beneath it
with the block below. **Order matters:** `goToWeek` runs first because it drives
`place()` -> `onRangeChange`, which is what populates `lastRange`. Mount chrome
before that and `warmCache()` reads `{NaN, NaN}`, returns false for every user,
and flashes the first-run screen over a warm cache on every single launch — the
one thing SPEC "First-run and connection state" forbids. (DECISIONS' "first-run
may flash for a returning user" is about a CLEARED cache, not a warm one.)

```ts
  ctl.setSnapStep(state.prefs().snapStepDays ?? 30)
  ctl.goToWeek(state.weekOf(state.today()), false)

  const chromeCtl = chrome.mount(app, {
    avatarSlot: avatar,
    warmCache,
    setSnapStep: step => ctl.setSnapStep(step),
    addHere,
    // Clearing the auth gate is only half the recovery: onRangeChange
    // short-circuits while the range is unchanged, so without resetting
    // lastRange nothing would ever ask for the suppressed months again.
    onConnected: () => {
      lastRange = { first: NaN, last: NaN }
      ctl.invalidate()
    },
    onPrefsChanged: () => {
      applyTheme()
      ctl.invalidate()
      yearCtl?.invalidate()
    },
  })
```

The `defaultView` boot call is **not** placed here. `openYear()` is a hoisted
function declaration, but its body reads `yearCtl` and `shownYear`, which are
`let` bindings declared further down the file — calling it from here would throw
a TDZ `ReferenceError` before the app ever paints. It goes in Step 4b instead.

Refactor the `modeBtn` click handler so the year view has one entry point the boot path can share. Replace the whole `modeBtn.addEventListener('click', ...)` block with:

```ts
  function openYear(): void {
    showYear(true)
    if (yearCtl === null) {
      // Mounted AFTER unhiding so columnsFor sees a real clientWidth.
      yearCtl = year.mount(yearRoot, { onPickDay: d => {
        // Clicking a day returns to the calendar on that day (SPEC "Year view").
        showYear(false)
        ctl.goToWeek(state.weekOf(d), false)   // onDock restores the range label
      } })
    }
  }
  modeBtn.addEventListener('click', () => {
    if (inYear()) showYear(false)
    else openYear()
  })
```

- [ ] **Step 4b: Apply `defaultView` at launch, after the year bindings exist**

Immediately BELOW the `modeBtn.addEventListener` block above — not up with the
other boot lines, for the TDZ reason given in Step 4:

```ts
  // SPEC "Settings": defaultView IS read at launch, unlike lastDockedDay.
  if (state.prefs().defaultView === 'year') openYear()
```

- [ ] **Step 5: Hold the repaint while the sheet is open, and re-sync the pill**

In the `state.onCacheChange` callback, extend the transient-UI guard and add the sync. Replace:

```ts
      if (day.isFormOpen()) { heldRepaint = true; return }
      ctl.invalidate()
```

with:

```ts
      // CONVENTIONS: a background refresh must never destroy transient UI. The
      // settings sheet obeys the same rule as the form (DECISIONS).
      if (day.isFormOpen() || chromeCtl.isSheetOpen()) { heldRepaint = true; return }
      // A cache change is also how a withToken failure deep inside state.ts
      // reaches the pill: there is no auth event to subscribe to.
      chromeCtl.syncConnection()
      ctl.invalidate()
```

And in `releaseHeldRepaint`, add the same sync before `ctl.invalidate()`:

```ts
    heldRepaint = false
    chromeCtl.syncConnection()
    ctl.invalidate()
```

- [ ] **Step 6: Add `n`**

After the existing Escape `keydown` listener:

```ts
  // SPEC "Layout details": `n` opens the form on the centred date, ignored inside
  // inputs or with a day open. No modifier, so it cannot eat a browser shortcut.
  document.addEventListener('keydown', e => {
    if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return
    const t = e.target
    if (t instanceof HTMLElement && (t.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
    if (openDay !== null) return
    e.preventDefault()
    addHere()
  })
```

- [ ] **Step 7: Replace the DEV harness block**

Delete the entire `if (import.meta.env.DEV) { ... }` block at the end of `main.ts` and put this in its place:

```ts
  // Quiet renewal on load. Real behaviour, not a harness: its outcome is what
  // decides first-run vs the reconnect pill, and its failure is what arms
  // state.ts's auth gate. A signed-out phone cannot recover from here — the
  // popup needs a gesture — so the pill and Connect are the only ways back.
  void auth.getToken().then(
    () => {
      state.clearAuthGate()
      chromeCtl.syncConnection()
      // Re-arm the window the gate suppressed while the renewal was in flight.
      lastRange = { first: NaN, last: NaN }
      ctl.invalidate()
    },
    () => { chromeCtl.syncConnection() },
  )

  // SPEC "PWA": production only. Headless Chrome hangs on registration
  // (CONVENTIONS), which is the other reason this never runs in dev.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js') })
  }

  if (import.meta.env.DEV) {
    // The DEV console seam scripts/shot.mjs drives. NOT a harness UI: #devbar and
    // the #harness-* buttons were deleted this stage, because the real first-run
    // screen is what they stood in for. Kept because shot.mjs reads `ctl` and
    // `day` directly (shot.mjs:429-430) and has no other way in.
    // why: augmenting window for a dev-only test seam, without widening the global type
    ;(window as unknown as { bramwell: unknown }).bramwell = { ctl, day, chrome: chromeCtl }
  }
```

Also delete the now-unused `avatar` comment `// reserved; stage 05 fills it` — chrome fills it now — and change it to `// filled by chrome.ts (avatar, reconnect pill, or nothing)`.

- [ ] **Step 8: Delete the devbar CSS**

In `src/style.css`, delete the line:

```css
#devbar { position: fixed; bottom: 0; left: 0; z-index: 9; display: flex; gap: 6px; padding: 4px; background: var(--band-b); }
```

- [ ] **Step 9: Verify the harness is gone and the build is clean**

Run:

```bash
grep -rn "devbar\|harness-connect\|harness-signout\|harness-status" src/ || echo "harness UI gone"
grep -rnE "transition:|animation:|@keyframes" src/*.css | grep -v motion.css || echo "no motion outside motion.css"
npx tsc --noEmit && npm run selftest 2>&1 | tail -3
```

Expected: `harness UI gone`; `no motion outside motion.css`; `tsc` exit 0; `56/56`.

- [ ] **Step 10: Commit**

```bash
git add src/main.ts src/style.css
git commit -m "stage 05: wire chrome, FAB open-then-add, n, SW registration; delete the DEV harness UI"
```

---

### Task 7: Hit-tested shell probes in the headless harness

Every claim in `verification.md` that a control works must be backed by `elementFromPoint()` at its centre resolving to that control (CONVENTIONS). `element.click()` reports success on a control no user can reach.

**Files:**
- Modify: `scripts/shot.mjs`

**Interfaces:**
- Consumes: `window.bramwell.{ctl, day, chrome}`; the ids `fr-connect`, `avatar`, `reconnect`, `sheet`, `fab`, `colors`, `cat-add`, `signout`.
- Produces: probe rows printed by `npm run shot`.

- [ ] **Step 1: Read the harness before adding to it**

Run: `sed -n '1,120p' scripts/shot.mjs` and `sed -n '400,470p' scripts/shot.mjs`

Note how a probe is declared and how `SEED` is injected at `Page.addScriptToEvaluateOnNewDocument` (line ~98). Follow the existing probe shape exactly; do not invent a second one.

- [ ] **Step 2: Add a shared hit-test helper**

Add near the other in-page helpers:

```js
// CONVENTIONS: a control "works" only if elementFromPoint at its CENTRE resolves
// to it (or to a descendant). element.click() bypasses hit testing entirely.
const HIT = `(sel) => {
  const el = document.querySelector(sel)
  if (el === null) return { found: false }
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return { found: true, sized: false }
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return { found: true, sized: true, hits: hit !== null && (hit === el || el.contains(hit)) }
}`
```

- [ ] **Step 3: Add the shell probes**

Add these rows, following the file's existing probe structure:

1. **first-run over a cold cache** — clear `bramwell.cache.v1` before load; assert `#firstrun` is present, not `[hidden]`, and `HIT('#fr-connect')` reports `hits: true`.
2. **no first-run over a warm cache** — with the existing `SEED` in place, assert `#firstrun` is absent or `[hidden]` (SPEC: it never covers a warm cache).
3. **the reconnect pill** — with `SEED` and signed out, **report** whether `#reconnect` is present and, if so, `HIT('#reconnect')`. Do **not** assert on its absence: the run advances under `--virtual-time-budget`, so 2.5s of virtual time may well have elapsed before the DOM is dumped, and an absence assertion here would be flaky rather than informative. The grace's *timing* is a gate row a human judges on device; this probe only proves the pill is reachable when it is up.
4. **the avatar opens the sheet** — force `connected` by stubbing `window.bramwell` is not possible (auth is real); instead assert that when `#avatar` exists, `HIT('#avatar')` is `hits: true`. Record the signed-out case as "pill path exercised, avatar path is a gate item".
5. **the FAB clears the last row's Sunday** — this is the gate row. Find the bottom-most `.week`'s Sunday cell, take its `.chips` (or the cell itself when there are no chips), and assert `HIT` on it does **not** resolve into `#fab`:

```js
const FAB_CLEARS = `() => {
  const weeks = [...document.querySelectorAll('.week')]
  // The lowest row actually on screen, not the lowest in the pool.
  const vis = weeks.filter(w => w.getBoundingClientRect().bottom <= innerHeight + 1)
  const last = vis.sort((a, b) => a.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom).pop()
  if (last === undefined) return { ok: false, why: 'no visible week' }
  const sun = last.querySelector('.day:nth-child(7)')
  if (sun === null) return { ok: false, why: 'no sunday cell' }
  const target = sun.querySelector('.chips') ?? sun
  const r = target.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  const fab = document.getElementById('fab')
  return {
    ok: hit !== null && fab !== null && hit !== fab && !fab.contains(hit),
    hit: hit === null ? null : hit.className || hit.id,
    fabTop: fab === null ? null : Math.round(fab.getBoundingClientRect().top),
    sunBottom: Math.round(r.bottom),
  }
}`
```

6. **the colorId invariant is enforced in the UI** — open the sheet with `window.bramwell.chrome.openSheet()`, then:

```js
const COLOR_INVARIANT = `() => {
  window.bramwell.chrome.openSheet()
  const rows = [...document.querySelectorAll('.set-cat')]
  const chosen = rows.map(r => r.querySelector('select').value)
  const bad = []
  rows.forEach((r, i) => {
    const sel = r.querySelector('select')
    for (const o of sel.options) {
      // Every id another row holds must be unselectable here, and this row's own
      // id must stay selectable. That pair IS the invariant (SPEC).
      const takenElsewhere = chosen.some((v, j) => j !== i && v === o.value)
      if (takenElsewhere !== o.disabled) bad.push(\`row \${i} option \${o.value}: disabled=\${o.disabled}\`)
    }
  })
  return { rows: rows.length, chosen, ok: bad.length === 0, bad }
}`
```

Expected: `ok: true`, `bad: []`, and `rows` equal to the number of categories in
prefs. A non-empty `bad` names the exact row and option that broke the invariant.

7. **add is dead at 11** — write 11 categories into prefs, reopen the sheet, assert `#cat-add` is `disabled` and its sibling `.set-note` is non-empty.
8. **the sheet survives a background refresh** —

```js
const SHEET_SURVIVES = `() => {
  window.bramwell.chrome.openSheet()
  const before = window.bramwell.chrome.isSheetOpen()
  // Harsher than a real cache change, matching the existing form probe at
  // shot.mjs:429-430: a full pool refill, not a single row.
  window.bramwell.ctl.invalidate()
  const el = document.getElementById('sheet')
  return {
    before,
    stillThere: el !== null && !el.hidden,
    stillOpen: window.bramwell.chrome.isSheetOpen(),
  }
}`
```

Expected: `before`, `stillThere` and `stillOpen` all true. Note this probe only
covers the *structural* half — that `invalidate()` does not tear the sheet down.
The other half, that `main.ts` **holds** the repaint rather than running it, is
covered by reading `heldRepaint`'s effect: with the sheet open, a `state`
cache-change must not repaint. Assert it by stamping a marker on a `.week` node
before the change and checking the marker survives.

- [ ] **Step 4: Run the harness in both colour schemes**

Run:

```bash
npm run dev >/tmp/bramwell-dev.log 2>&1 &
sleep 3
npm run shot 2>&1 | tail -40
```

Expected: every shell probe reports its assertion. **`npm run shot`'s exit code carries no claim** (`OPEN.md`, stage-04 fix wave — it exits 0 even when every boolean is false), so read the printed field values, not the exit status, and cite those values in `verification.md`.

Kill the dev server when done: `kill %1`.

- [ ] **Step 5: Commit**

```bash
git add scripts/shot.mjs
git commit -m "stage 05: hit-tested shell probes — first-run, sheet, colour invariant, FAB clearance"
```

---

### Task 8: Deploy, gate, and `verification.md`

**Files:**
- Create: `05_shell/output/verification.md`
- Modify: `05_shell/CONTEXT.md` (the Status line)

- [ ] **Step 1: Human-only — Google Cloud Console**

Credentials → the existing v3 OAuth client → Authorized JavaScript origins → **add `https://bramwell.no.fail`**. No redirect URIs. Exact-match, and the port is part of the match. Origin changes take a few minutes to propagate; retry in a **fresh tab**, since GIS caches the rejection.

- [ ] **Step 2: Human-only — Cloudflare Pages**

DNS/zone for `no.fail` is already in place. Create the Pages project:

- Build command: `npm run build`
- Output directory: `dist`
- Node version: from `.node-version`
- Custom domain: `bramwell.no.fail`
- Environment variables (Production): `VITE_GOOGLE_CLIENT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

Vite inlines these at build time; `.env.local` is gitignored and never reaches the host. Client IDs and the anon key are public by design — the origin allowlist and RLS are the security boundaries.

- [ ] **Step 3: Deploy and confirm the worker is really at the root**

Run after the first deploy:

```bash
curl -sI https://bramwell.no.fail/sw.js | head -20
curl -sI https://bramwell.no.fail/manifest.webmanifest | head -5
```

Expected: `sw.js` returns 200 with `content-type: text/javascript` and `cache-control: no-cache`; the manifest returns 200. Note that `curl` against an SPA returns 200 for *unknown* paths too (CONVENTIONS) — so a 200 is not evidence the file exists. Check the body instead:

```bash
curl -s https://bramwell.no.fail/sw.js | head -c 40
curl -s https://bramwell.no.fail/sw.js | grep -cE '^(import|export)[ {]'
```

Expected: the body opens `"use strict";(()=>{` — esbuild's `iife` format emits the
`"use strict";` prologue ahead of the IIFE, so do NOT check for a literal `(()=>{`
prefix. The ESM grep prints `0`. A fallback `index.html` would satisfy neither.

- [ ] **Step 4: Run the gate**

On `https://bramwell.no.fail`, phone **and** desktop, light **and** dark:

| # | Criterion |
|---|---|
| 1 | Cold start signed out → first-run; Connect lands on today |
| 2 | Stale token over a warm cache → read-only calendar + reconnect pill (after the grace) |
| 3 | Settings persist across reload; sign-out returns to first-run |
| 4 | The sheet survives a background refresh |
| 5 | No shared colorId reachable; add dead at 11 with the reason |
| 6 | Delete leaves Google untouched (check the Google Calendar app); rename keeps the key |
| 7 | Display hex vs Google colour both visible when they disagree |
| 8 | Every mood readable at arm's length, both schemes |
| 9 | Install as PWA; offline open read-only; a write fails visibly and rolls back |
| 10 | A second deploy reaches the installed client on the next online open, no cache bump |
| 11 | FAB clears the last row's Sunday on the notched phone |
| 12 | **Carried:** 60fps on a mid phone — seed the cache across the whole visible window first, or the measurement is worthless |

Also confirm at the gate: the Google colour-table hexes in `SPEC.md` are still transcribed and unverified — open a created event in the Google Calendar app and check one.

- [ ] **Step 5: Write `verification.md`**

`05_shell/output/verification.md` records gate criteria, results, rulings the spec left open, and **what was not tested**. It must carry at least:

- Each gate row above with its result and the evidence (field values, not exit codes).
- **Rulings to promote at the gate close:**
  - The auth gate: one token request per signed-out session; writes ungated; `clearAuthGate()` is the only way back. → `DECISIONS.md`.
  - `sw.js` is emitted by `scripts/build-sw.mjs` (esbuild, IIFE), not by `vite.config.ts` — Vite's ESM output cannot make a classic worker. This **supersedes** the in-force `DECISIONS.md` line. → `DECISIONS.md`, with the reason.
  - `window.bramwell` survives as a DEV-only test seam; `#devbar` and the `#harness-*` buttons are deleted. This **amends** the stage-04 carry-forward. → `DECISIONS.md`.
  - `warmCache` counts `loading`/`error` months that still hold events, not `ready` alone — otherwise a stale-token warm start would flash first-run over a warm cache. Known edge: a genuinely empty cached month reads as cold. → `DECISIONS.md`.
  - `#app` reserves `--fab-inset` rather than floating the FAB, so the Sunday clearance is structural rather than measured-and-hoped. → `DECISIONS.md`.
  - `RECONNECT_GRACE_MS` is a timing constant that is neither a CSS motion value nor scroll physics. `CONVENTIONS.md` names only those two homes. → propose a `CONVENTIONS.md` amendment.
  - `chrome.ts` disables the FAB while stale but does not make the event form read-only; that would mean editing `day.ts`, outside this stage's Outputs. → `OPEN.md`.
- **What was not tested / stays open** (explicitly carried forward, not silently dropped): the `npm run shot` assertion work; a browser test layer for the three untested write-path fixes (`formGen`, the notes sentinel, `eventsOn` ordering); the `remeasure` re-entry race (b); the `animMs`/`parseFloat` divergence; `grid-template-columns` interpolation on iOS Safari; GIS response ordering.

- [ ] **Step 6: Flip the contract Status and commit**

In `05_shell/CONTEXT.md`, change the Status line to `**Status: VERIFIED <date>.**` — **not** CLOSED. Only the human closes a gate.

```bash
git add 05_shell/output/verification.md 05_shell/CONTEXT.md
git commit -m "stage 05: verification — chrome, PWA, first deploy to bramwell.no.fail"
```

- [ ] **Step 7: Stop**

Do not open stage 06. The human runs the gate; the gate close promotes every ruling above into `DECISIONS.md`, `SPEC.md` or `OPEN.md`, and only then does `06_demo` open.
