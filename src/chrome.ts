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

// TASK 5 deletes this stub and supplies the real Colors section builder.
function buildColors(): HTMLElement { return el('div') }

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

export function mount(root: HTMLElement, host: ChromeHost): ChromeController {
  let conn: Conn = 'first-run'
  let graceTimer: ReturnType<typeof setTimeout> | null = null
  /** True once the grace has elapsed for the CURRENT stale spell. Reset whenever
   *  the connection state changes, so a reconnect-then-drop waits again. */
  let graced = false

  hostRef = host
  syncRef = () => { api.syncConnection() }

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

  // Escape closes the sheet. day.ts's own Escape handler in main.ts unwinds the
  // form and the expansion; this listener is added AFTER it, so a sheet opened
  // over an expanded day still closes the sheet first.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !api.isSheetOpen()) return
    e.preventDefault()
    e.stopPropagation()
    closeSheet()
  }, { capture: true })

  api.syncConnection()
  return api
}
