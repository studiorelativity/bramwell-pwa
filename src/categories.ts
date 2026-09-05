// STAGE 02 — category resolution, Google colour table, moods, themeCss(). DOM-free; never imports state.ts.
import type { GoogleColor, MoodId, Prefs, StoredCategory } from './types.ts'
import { sanitizePlanning } from './plan.ts'

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

/** Frozen: existing events in the user's calendar already carry these colorIds.
 *  Vacation and Blackout were appended 2026-09-05 (DECISIONS "Planning layer
 *  rulings", amended): 7 and 11 collided with nothing, and no existing row or
 *  colorId changed. Vacation carries no budget — that is personal and set in
 *  Settings; Blackout blocks. */
const SEED: readonly StoredCategory[] = [
  { name: 'work', label: 'Work', colorId: '9', displayHex: '#3056D3' },
  { name: 'personal', label: 'Personal', colorId: '10', displayHex: '#17925A' },
  { name: 'financial', label: 'Financial', colorId: '5', displayHex: '#D97706' },
  { name: 'vacation', label: 'Vacation', colorId: '7', displayHex: '#0E86C4' },
  { name: 'blackout', label: 'Blackout', colorId: '11', displayHex: '#B3261E', blocks: true },
  OTHER,
]

/** Hand-picked dark twins, keyed on the LIGHT hex rather than on category identity,
 *  so they survive a rename or a colorId change and a hand-picked #3056D3 gets the good twin. */
const TWINS = new Map([
  ['#3056D3', '#7B96FF'],
  ['#17925A', '#4FC48D'],
  ['#D97706', '#F0A13C'],
  ['#64748B', '#94A3B8'],
  ['#0E86C4', '#5CC1F2'],
  ['#B3261E', '#F28B82'],
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
/** SPEC: a name is the slug of the label. It is interpolated unescaped into a
 *  `[data-cat="…"]` selector and a `--cat-…` property by themeCss(), so a corrupted blob
 *  must not be able to reach the sheet with a quote, a bracket or whitespace in it. */
const NAME_RE = /^[a-z0-9-]{1,32}$/

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
    if (typeof name !== 'string' || !NAME_RE.test(name)) continue
    if (typeof label !== 'string' || label === '') continue
    if (typeof colorId !== 'string' || !COLOR_ID_RE.test(colorId)) continue
    if (names.has(name) || colorIds.has(colorId)) continue
    names.add(name)
    colorIds.add(colorId)
    // The two branches are required by exactOptionalPropertyTypes: `displayHex: undefined`
    // is not assignable to an optional property. The planning fields come back
    // from plan.ts already in that shape (present only when valid).
    out.push(typeof displayHex === 'string' && HEX_RE.test(displayHex)
      ? { name, label, colorId, displayHex, ...sanitizePlanning(r) }
      : { name, label, colorId, ...sanitizePlanning(r) })
  }
  return out
}

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

// ---------- Theme ----------

type Bands = {
  surface: string
  bandA: string
  bandAEnd: string
  bandB: string
  bandBEnd: string
}
type MoodTokens = { light: Bands; dark: Bands }

/** The ladder is fixed; a mood shifts hue and saturation only (SPEC "Visual
 *  direction"). Lightness relative to the ground: band-a-end +2.5, band-a +4,
 *  band-b-end +4.5, band-b +6. Month parity is the a/b pair; weekend sits
 *  under its own band. Dark grounds are near-identical by design — Night Depth
 *  wants a near-black ground and the mood reads through the bands. */
const MOODS: Record<MoodId, MoodTokens> = {
  warm: {
    light: { surface: '#F2EFEA', bandA: '#FAF9F7', bandAEnd: '#F7F5F2', bandB: '#FEFEFD', bandBEnd: '#FBFAF9' },
    dark:  { surface: '#141210', bandA: '#1F1C19', bandAEnd: '#1B1816', bandB: '#25211E', bandBEnd: '#211D1A' },
  },
  paper: {
    light: { surface: '#F4F1E9', bandA: '#FBFAF6', bandAEnd: '#F8F7F1', bandB: '#FEFEFD', bandBEnd: '#FCFBF8' },
    dark:  { surface: '#131210', bandA: '#1F1D1A', bandAEnd: '#1A1916', bandB: '#24221E', bandBEnd: '#201E1B' },
  },
  cool: {
    // The stage-01 seed near-black #0f1115 is hue 220 and lands here exactly.
    light: { surface: '#EBEEF2', bandA: '#F7F9FA', bandAEnd: '#F3F5F7', bandB: '#FDFEFE', bandBEnd: '#F9FAFB' },
    dark:  { surface: '#0F1115', bandA: '#181B21', bandAEnd: '#14171C', bandB: '#1C1F26', bandBEnd: '#191C22' },
  },
  sage: {
    light: { surface: '#ECF1EC', bandA: '#F8FAF8', bandAEnd: '#F3F6F4', bandB: '#FEFEFE', bandBEnd: '#F9FBF9' },
    dark:  { surface: '#101411', bandA: '#191F1B', bandAEnd: '#151B18', bandB: '#1D2520', bandBEnd: '#1A211D' },
  },
  dusk: {
    light: { surface: '#EFECF1', bandA: '#F9F8FA', bandAEnd: '#F5F3F6', bandB: '#FEFEFE', bandBEnd: '#FAF9FB' },
    dark:  { surface: '#120F15', bandA: '#1C1820', bandAEnd: '#18151C', bandB: '#211C26', bandBEnd: '#1D1922' },
  },
}

function lightOf(c: StoredCategory): string {
  return c.displayHex ?? GOOGLE_HEX.get(c.colorId) ?? OTHER.displayHex ?? '#64748B'
}

function darkOf(c: StoredCategory): string {
  const light = lightOf(c)
  return TWINS.get(light.toUpperCase()) ?? brighten(light)
}

function bandVars(b: Bands, indent: string): string {
  return [
    `${indent}--surface: ${b.surface};`,
    `${indent}--band-a: ${b.bandA};`,
    `${indent}--band-a-end: ${b.bandAEnd};`,
    `${indent}--band-b: ${b.bandB};`,
    `${indent}--band-b-end: ${b.bandBEnd};`,
  ].join('\n')
}

/** [data-cat] rules, --cat-<name> properties, mood tokens. main.ts owns the <style>. */
export function themeCss(mood: MoodId): string {
  const tokens = MOODS[mood]
  const light = cats.map(c => `  --cat-${c.name}: ${lightOf(c)};`).join('\n')
  const dark = cats.map(c => `    --cat-${c.name}: ${darkOf(c)};`).join('\n')
  const rules = cats.map(c => `[data-cat="${c.name}"] { --cat: var(--cat-${c.name}); }`).join('\n')
  return [
    `:root {`,
    bandVars(tokens.light, '  '),
    light,
    `}`,
    `@media (prefers-color-scheme: dark) {`,
    `  :root {`,
    bandVars(tokens.dark, '    '),
    dark,
    `  }`,
    `}`,
    rules,
    ``,
  ].join('\n')
}
