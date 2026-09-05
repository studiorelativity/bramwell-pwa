// STAGE 05 — first-run, connection state, settings sheet (Colors + Mood), FAB, toasts.
// Imports auth.ts and state.ts directly, per this stage's contract; everything it
// cannot know — the scroll controller, the current view, the render window — arrives
// through ChromeHost. Never imports scroll/render/day/year/gcal.
import * as auth from './auth.ts'
import * as state from './state.ts'
import type { MoodId, StoredCategory } from './types.ts'
import { GOOGLE_COLORS, all as catsAll, mintName } from './categories.ts'

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
  /** The sheet closed. Symmetric with day.ts's onFormClosed: main.ts holds a
   *  background repaint while the sheet is open (CONVENTIONS transient-UI rule)
   *  and needs a moment to release it. Without this the held repaint never
   *  runs and syncConnection never re-checks auth. */
  onSheetClosed(): void
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
  /** True only in the connected state. The FAB disables itself on this; `n` is
   *  the FAB's keyboard twin and must gate on the same fact. */
  isConnected(): boolean
}

/** Created on first use, so this module stays free of DOM at module scope. */
let toastHost: HTMLElement | null = null

/** One animation is the toast's whole life — appear, dwell, leave — so its timing
 *  lives in motion.css and nothing here counts milliseconds. Under reduced motion
 *  the dwell survives and only the movement goes (motion.css carve-out). The role
 *  is `alert` not `status`: this is the error surface; a polite region can be skipped,
 *  and the toast self-removes with no way to recall it (SPEC "Event form" + DECISIONS). */
export function toast(message: string): void {
  if (toastHost === null || !toastHost.isConnected) {
    toastHost = document.createElement('div')
    toastHost.id = 'toasts'
    document.body.append(toastHost)
  }
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'alert')
  el.textContent = message
  el.addEventListener('animationend', () => el.remove())
  toastHost.append(el)
}

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

    // --- planning fields (SPEC "Planning layer"): a second line under the
    // row, because .set-cat already carries six controls at 380px and does not
    // wrap. Both are structural edits -> rebuild(). ---
    const pr = el('div', 'plan-row')
    pr.dataset['cat'] = c.name
    pr.append(el('span', 'plan-lbl', 'Budget'))
    const bud = el('input', 'plan-bud')
    bud.type = 'number'
    bud.min = '1'
    bud.max = '366'
    bud.inputMode = 'numeric'
    bud.placeholder = '—'
    bud.value = c.budgetDays === undefined ? '' : String(c.budgetDays)
    bud.setAttribute('aria-label', `Budget in days per year for ${c.label}`)
    bud.addEventListener('change', () => {
      const raw = bud.value.trim()
      if (raw === '') {
        // Blank = delete the field (exactOptionalPropertyTypes: drop the key, never `undefined`).
        writeCats(currentCats().map(x => {
          if (x.name !== c.name) return x
          const { budgetDays: _drop, ...rest } = x
          return rest
        }), fallbackName)
        rebuild()
        return
      }
      const n = Number(raw)
      // sanitize() would drop an out-of-range value on the next load; refuse it
      // here instead of writing a field that silently vanishes.
      if (!Number.isInteger(n) || n < 1 || n > 366) { bud.value = c.budgetDays === undefined ? '' : String(c.budgetDays); return }
      writeCats(currentCats().map(x => x.name === c.name ? { ...x, budgetDays: n } : x), fallbackName)
      rebuild()
    })
    pr.append(bud, el('span', 'plan-unit', 'days / yr'))
    // A pressed button styled as the segment control, not a checkbox — iOS PWA
    // checkbox styling is the OPEN.md hazard (brief, step 6).
    const segw = el('div', 'set-seg')
    const blk = el('button', 'set-segb plan-blocks', 'Blocks')
    blk.type = 'button'
    blk.setAttribute('aria-pressed', String(c.blocks === true))
    blk.setAttribute('aria-label', `${c.label} blocks planning over its days`)
    blk.addEventListener('click', () => {
      writeCats(currentCats().map(x => {
        if (x.name !== c.name) return x
        if (x.blocks === true) { const { blocks: _drop, ...rest } = x; return rest }
        return { ...x, blocks: true }
      }), fallbackName)
      rebuild()
    })
    segw.append(blk)
    pr.append(segw)

    wrap.append(r, pr)
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
    // Mark BEFORE the resync: syncRef -> syncConnection reads leftDeliberately to
    // land on first-run rather than stale (SPEC "Settings": "sign-out returns to
    // first-run" — the cache is still warm the instant signOut() resolves).
    void auth.signOut().finally(() => { markLeftRef?.(); closeSheet(); syncRef?.() })
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
  // LABELS are Month/Year to match the header toggle (2026-08-31); the STORED
  // value stays 'cal'/'year' — it is persisted prefs, and renaming it would
  // silently reset every existing install's default view.
  view.append(segment(['Month', 'Year'], p0.defaultView === 'year' ? 'Year' : 'Month', v => {
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

/** Set by mount; the sheet's sign-out row needs to mark the departure as
 *  deliberate BEFORE syncRef's resync runs (see `leftDeliberately` in mount). */
let markLeftRef: (() => void) | null = null

function closeSheet(): void {
  // Guard on already-hidden too, not just null: a no-op close (e.g. a second
  // Escape, or signing out from an already-closing sheet) must not notify.
  if (sheet === null || sheet.hidden) return
  sheet.hidden = true
  if (scrim !== null) scrim.hidden = true
  hostRef?.onSheetClosed()
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

export function mount(root: HTMLElement, host: ChromeHost): ChromeController {
  let conn: Conn = 'first-run'
  let graceTimer: ReturnType<typeof setTimeout> | null = null
  /** True once the grace has elapsed for the CURRENT stale spell. Reset whenever
   *  the connection state changes, so a reconnect-then-drop waits again. */
  let graced = false
  /** Set when the user signs out from the sheet; outranks `warmCache()` so
   *  sign-out returns to first-run as SPEC "Settings" requires, even though the
   *  cache is still warm the instant `signOut()` resolves. NOT persisted — a
   *  later reload with a warm cache legitimately returns to `stale` plus the
   *  pill, because the cache really is warm and the grant really was revoked. */
  let leftDeliberately = false

  hostRef = host
  syncRef = () => { api.syncConnection() }
  markLeftRef = () => { leftDeliberately = true }

  let firstRun: HTMLElement | null = null

  function connect(): void {
    void auth.signIn().then(
      () => {
        leftDeliberately = false   // a session began; outrank nothing now.
        state.clearAuthGate(); host.onConnected(); api.syncConnection()
      },
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
      // leftDeliberately outranks warmCache(): SPEC "Settings" — sign-out returns
      // to first-run, even though the cache the user leaves behind is still warm.
      const next: Conn = auth.isSignedIn() ? 'connected'
        : leftDeliberately ? 'first-run'
        : host.warmCache() ? 'stale'
        : 'first-run'
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
    isConnected(): boolean { return conn === 'connected' },
  }

  const fab = el('button', 'set-fab', '+')
  fab.id = 'fab'
  fab.type = 'button'
  fab.setAttribute('aria-label', 'Add event')
  fab.addEventListener('click', () => host.addHere())
  document.body.append(fab)

  // Escape closes the sheet first, regardless of registration order: this
  // listener runs in the CAPTURE phase, and day.ts's own Escape handler in
  // main.ts is a default bubble-phase listener, so capture always fires
  // first. stopPropagation() then keeps the event from ever reaching that
  // bubble-phase handler, so with both a sheet open and a day expanded, one
  // Escape closes the sheet and a second Escape is needed to unwind the day.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !api.isSheetOpen()) return
    e.preventDefault()
    e.stopPropagation()
    closeSheet()
  }, { capture: true })

  api.syncConnection()
  return api
}
