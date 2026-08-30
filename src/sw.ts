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
