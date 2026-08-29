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
