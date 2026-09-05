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
 *  calendar renders read-only and the pill offers the way back. connected = avatar.
 *  demo (stage 06) = the in-memory seed: checked FIRST, because seeded months are
 *  `ready` and would otherwise read as `stale` — a Reconnect pill after the grace
 *  and a dead FAB, when the demo wants its own pill at once and a live FAB (a
 *  rejected save is the demo's whole lesson). */
type Conn = 'first-run' | 'stale' | 'connected' | 'demo'

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
  /** "Try the demo" was pressed. main.ts calls state.enableDemo(), re-runs
   *  configure() from the demo prefs, and repaints both views; chrome then
   *  re-syncs itself. One direction only: chrome never calls enableDemo. */
  enterDemo(): void
  /** state.exitDemo() has just run (the pill, or Connect anywhere). main.ts
   *  re-runs configure() from the real prefs and repaints (SPEC "Demo mode":
   *  leaving demo re-runs configure()). */
  onDemoExit(): void
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
  /** The harness's way past the landing page (2026-09-05). The landing covers
   *  every signed-out state, and headless Chrome cannot sign in, so the
   *  stage-03/04/05 probes would otherwise never reach a day cell. Restores the
   *  pre-landing read-only state over a warm cache for this session only.
   *  Reachable only through the dev-only `window.bramwell` seam, which is
   *  stripped from production builds — production has no way to uncover. */
  uncover(): void
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

type Landing = { root: HTMLElement; setWarm(warm: boolean): void }

/** The mini year: six rows of fourteen tiles with a few painted runs, built from
 *  the same tokens the real grid uses ([data-cat] resolves through themeCss, the
 *  today ring is today's own reserved hue). An illustration of the product in
 *  the product's own material — no image, no second palette. */
function buildArt(): HTMLElement {
  const art = el('div', 'ld-art')
  art.setAttribute('aria-hidden', 'true')
  const strip = el('div', 'ld-strip')
  for (const [cat, label, fig] of [['vacation', 'Vacation', '12 / 30'], ['blackout', 'Blackout', '5'], ['work', 'Work', '9']] as const) {
    const chip = el('span', 'ld-chip')
    chip.dataset['cat'] = cat
    chip.append(el('span', 'ld-dot'), el('span', undefined, label), el('span', 'ld-fig', fig))
    strip.append(chip)
  }
  art.append(strip)
  // [row, startCol (1-based), span, cat]
  const runs: readonly (readonly [number, number, number, string])[] = [
    [0, 3, 5, 'vacation'], [1, 9, 1, 'blackout'], [2, 2, 3, 'work'], [2, 11, 4, 'vacation'],
    [3, 6, 2, 'work'], [4, 1, 4, 'vacation'], [4, 12, 1, 'blackout'], [5, 8, 3, 'work'],
  ]
  for (let r = 0; r < 6; r++) {
    const row = el('div', 'ld-row')
    for (let c = 0; c < 14; c++) {
      const cell = el('span', 'ld-cell')
      cell.style.gridColumn = String(c + 1)      // explicit, so the runs overlay instead of displacing
      if (c >= 12) cell.dataset['weekend'] = ''
      if (r === 3 && c === 9) cell.dataset['today'] = ''
      row.append(cell)
    }
    for (const [rr, col, span, cat] of runs) {
      if (rr !== r) continue
      const bar = el('span', 'ld-run')
      bar.dataset['cat'] = cat
      bar.style.gridColumn = `${col} / span ${span}`
      row.append(bar)
    }
    art.append(row)
  }
  return art
}

/** The landing page. Shown whenever the app is not connected and not in demo —
 *  a cold visitor and a returning one alike (2026-09-05: the calendar is never
 *  painted for anyone who has not signed in; the old read-only-behind-a-pill
 *  state is gone). Layout follows SPEC "Visual direction — Night Depth": the
 *  ground, three elevations, two reserved hues, nothing new. */
function buildLanding(onConnect: () => void, onDemo: () => void): Landing {
  const root = el('div')
  root.id = 'firstrun'
  const page = el('div', 'ld')

  const top = el('header', 'ld-top')
  const mark = el('div', 'set-fr-mark', 'B')
  mark.setAttribute('aria-hidden', 'true')
  top.append(mark, el('span', 'ld-word', 'Bramwell'))

  const hero = el('section', 'ld-hero')
  const copy = el('div', 'ld-copy')
  const h1 = el('h1', 'ld-h1')
  h1.append('Your whole year.', el('br'), 'One screen.')
  const lede = el('p', 'ld-lede',
    'A year planner over your Google Calendar. Paint vacations, blackouts and commitments straight onto the days, and watch each one count against the budget you gave it.')
  const cta = el('div', 'ld-cta')
  const connect = el('button', 'set-fr-connect', 'Connect Google Calendar')
  connect.id = 'fr-connect'
  connect.type = 'button'
  connect.addEventListener('click', onConnect)
  // SPEC "Demo mode": the no-sign-in path. Nothing is persisted, so a reload
  // lands right back here.
  const demo = el('button', 'set-fr-demo', 'Try the demo')
  demo.id = 'fr-demo'
  demo.type = 'button'
  demo.addEventListener('click', onDemo)
  cta.append(connect, demo)
  const note = el('p', 'set-fr-note', 'Events live only in your Google Calendar. Bramwell keeps no copy of its own.')
  copy.append(h1, lede, cta, note)
  hero.append(copy, buildArt())

  const points = el('section', 'ld-points')
  for (const [head, body] of [
    ['Paint, don’t type.', 'Pick a category and drag across the days. One run is one event, in your own Google Calendar.'],
    ['Budgets that count.', 'Give Vacation thirty days. The strip keeps the score all year and says so the moment you go past it.'],
    ['Blackouts hold.', 'Mark the days nothing may be planned over. A run that touches one is refused before it is written.'],
  ]) {
    const tile = el('div', 'ld-point')
    tile.append(el('h2', 'ld-h2', head), el('p', 'ld-p', body))
    points.append(tile)
  }

  const foot = el('footer', 'ld-foot')
  const support = el('a', 'set-fr-support', 'Something wrong? Get in touch.')
  support.href = `mailto:${SUPPORT_EMAIL}`
  const about = el('a', 'ld-link', 'About'); about.href = '/about'
  const privacy = el('a', 'ld-link', 'Privacy'); privacy.href = '/privacy'
  const links = el('nav', 'ld-links'); links.append(about, privacy, support)
  foot.append(links, el('span', 'ld-made', 'Studio Relativity · MIT'))

  page.append(top, hero, points, foot)
  root.append(page)
  return {
    root,
    /** A returning visitor has a calendar waiting; the button says so in one word. */
    setWarm(warm) { connect.textContent = warm ? 'Go' : 'Connect Google Calendar' },
  }
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
  // In demo the row says so and offers Connect — the pill's own path — rather
  // than a Sign out with nothing to sign out of (B's finding, 2026-09-05).
  const inDemo = state.isDemo()
  const acct = row(inDemo ? 'Demo' : auth.isSignedIn() ? 'Google Calendar · Connected' : 'Google Calendar · Not connected')
  if (inDemo) {
    const go = el('button', 'set-btn', 'Connect')
    go.id = 'sheet-connect'
    go.type = 'button'
    go.addEventListener('click', () => { closeSheet(); connectRef?.() })
    acct.append(go)
  } else {
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
  }
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
  // LABELS are Last/Month/Year — Month/Year to match the header toggle
  // (2026-08-31), Last for the view the previous session ended in (SPEC
  // "Settings", amended 2026-09-05). The STORED value is 'last'/'cal'/'year':
  // persisted prefs, and renaming it would silently reset every existing
  // install's default view. An absent field means 'last'.
  const VIEW_LABEL: Record<'last' | 'cal' | 'year', string> = { last: 'Last', cal: 'Month', year: 'Year' }
  const VIEW_VALUE: Record<string, 'last' | 'cal' | 'year'> = { Last: 'last', Month: 'cal', Year: 'year' }
  view.append(segment(['Last', 'Month', 'Year'], VIEW_LABEL[p0.defaultView ?? 'last'], v => {
    state.savePrefs({ ...state.prefs(), defaultView: VIEW_VALUE[v] ?? 'last' })
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

/** Set by mount; in demo the sheet's account row offers Connect on the SAME
 *  path the demo pill takes (exit demo, then sign in) — mount's connect(),
 *  reached the way syncRef is, so no new host hook. */
let connectRef: (() => void) | null = null

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
  connectRef = () => { connect() }
  markLeftRef = () => { leftDeliberately = true }

  let firstRun: Landing | null = null
  let uncovered = false

  /** SPEC "Demo mode": the pill, "or Connect anywhere", exits demo and starts
   *  sign-in. Done here, at the one place every Connect funnels through, so the
   *  first-run button and the reconnect pill need no demo knowledge of their own.
   *  The resync lands the shell on first-run (cold) or stale (warm) behind the
   *  popup, rather than leaving the demo pill up while sign-in is pending. */
  function connect(): void {
    if (state.isDemo()) {
      state.exitDemo()
      host.onDemoExit()
      api.syncConnection()
    }
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
    if (conn === 'demo') {
      // The pill in the avatar's slot (SPEC). It reuses .set-pill and carries
      // data-demo for session C to colour; today it inherits Reconnect's paint,
      // which reads as "not connected" — true. Settings stays reachable through
      // a dot-less avatar beside it: SPEC says customization works in memory,
      // and the avatar is the only door to the sheet. No dot — the dot "exists
      // only in the connected state" (style.css).
      const pill = el('button', 'set-pill', 'Demo · Connect')
      pill.id = 'demo-pill'
      pill.type = 'button'
      pill.dataset['demo'] = ''
      pill.addEventListener('click', connect)
      const av = el('button', 'set-avatar')
      av.id = 'avatar'
      av.type = 'button'
      av.setAttribute('aria-label', 'Settings')
      av.addEventListener('click', () => toggleSheet())
      slot.append(pill, av)
      return
    }
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
      const next: Conn = state.isDemo() ? 'demo'
        : auth.isSignedIn() ? 'connected'
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
      // The landing covers every signed-out state (2026-09-05): a cold visitor
      // and a returning one alike see the page, never the calendar. `uncovered`
      // is the harness seam only (see ChromeController.uncover).
      const covered = conn === 'first-run' || (conn === 'stale' && !uncovered)
      if (covered) {
        if (firstRun === null) {
          firstRun = buildLanding(connect, () => { host.enterDemo(); api.syncConnection() })
          root.append(firstRun.root)
          // The shared enter utility: .enter, reflow, [data-in] (motion.css).
          firstRun.root.classList.add('enter')
          void firstRun.root.offsetWidth
          firstRun.root.dataset['in'] = ''
        }
        firstRun.setWarm(conn === 'stale')
        firstRun.root.hidden = false
      } else if (firstRun !== null) {
        firstRun.root.hidden = true
      }
      // It covers the header visually but not in the tab order: from the body,
      // Tab reached Year and Today behind it (ticket 4 probe, 2026-09-05).
      // Every other child of the root is inert while it shows — a sibling
      // rule, so chrome.ts learns nothing about what main.ts put there.
      for (const c of root.children) if (c !== firstRun?.root) c.toggleAttribute('inert', covered)
      // Read-only while stale: the FAB is the one write entry point chrome owns.
      // Live in demo: the write is refused with the demo message (SPEC), which is
      // the point. `n` in main.ts gates on the same two facts.
      fab.disabled = conn !== 'connected' && conn !== 'demo'
      paintSlot()
    },
    isSheetOpen(): boolean { return sheet !== null && !sheet.hidden },
    uncover(): void { uncovered = true; api.syncConnection() },
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
