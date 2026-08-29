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
  const [nr, ng, nb] = fromHsl(h, Math.min(s, 0.71), Math.max(l, 0.62))
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
