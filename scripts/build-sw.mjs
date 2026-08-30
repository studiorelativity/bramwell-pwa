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
