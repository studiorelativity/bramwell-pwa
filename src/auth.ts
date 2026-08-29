// STAGE 02 — GIS token client. The ONLY file that knows about Google auth. Exports exactly these four.

type TokenResponse = { access_token?: string; expires_in?: number; error?: string; error_description?: string }
type TokenClient = { requestAccessToken: (o?: { prompt?: string }) => void }
type Gis = {
  accounts: {
    oauth2: {
      initTokenClient: (c: {
        client_id: string; scope: string
        callback: (r: TokenResponse) => void
        error_callback?: (e: { type?: string }) => void
      }) => TokenClient
      revoke: (token: string, done?: () => void) => void
    }
  }
}

const SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const POLL_MS = 50
const LOAD_TIMEOUT_MS = 10_000
/** A token never dies mid-request. */
const SKEW_MS = 60_000

/** Module-private: SPEC "Auth" says auth.ts exports exactly four names. Identified by `.name`. */
class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

let token: string | null = null
let expiresAt = 0
let pending: Promise<string> | null = null
let client: TokenClient | null = null
let settle: ((r: TokenResponse) => void) | null = null

/** globalThis.google IS window.google in a browser. Read inside the function, never at
 *  module scope, so this module survives `npm run selftest` under bare node. */
function gis(): Gis | undefined {
  return (globalThis as { google?: Gis }).google
}

async function whenReady(): Promise<Gis> {
  const deadline = Date.now() + LOAD_TIMEOUT_MS
  for (;;) {
    const g = gis()
    if (g !== undefined && g.accounts !== undefined && g.accounts.oauth2 !== undefined) return g
    if (Date.now() >= deadline) throw new AuthError('Google Identity Services did not load')
    await new Promise(r => setTimeout(r, POLL_MS))
  }
}

async function ensureClient(): Promise<TokenClient> {
  if (client !== null) return client
  const g = await whenReady()
  // import.meta.env is undefined under bare node; the optional chain is load-bearing.
  const clientId = (import.meta.env as { VITE_GOOGLE_CLIENT_ID?: string } | undefined)?.VITE_GOOGLE_CLIENT_ID ?? ''
  // The clear error belongs where it is actionable. Under bare node (selftest) there is no
  // document and no env; the stubbed GIS client ignores the id. In a browser a missing id
  // is a real misconfiguration and must say so.
  if (clientId === '' && (globalThis as { document?: unknown }).document !== undefined) {
    throw new AuthError('VITE_GOOGLE_CLIENT_ID is not set')
  }
  client = g.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: r => settle?.(r),
    error_callback: e => settle?.({ error: e.type ?? 'popup_failed' }),
  })
  return client
}

function request(prompt: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    ensureClient().then(c => {
      settle = r => {
        settle = null
        if (r.access_token === undefined) {
          token = null
          expiresAt = 0
          reject(new AuthError(r.error_description ?? r.error ?? 'token request failed'))
          return
        }
        token = r.access_token
        expiresAt = Date.now() + (r.expires_in ?? 3600) * 1000 - SKEW_MS
        resolve(token)
      }
      c.requestAccessToken({ prompt })
    }, reject)
  })
}

/** Cached while valid. A failed quiet renewal leaves isSignedIn() false and surfaces the
 *  reconnect pill; it never auto-escalates to a popup, which browsers block outside a gesture. */
export function getToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && token !== null && Date.now() < expiresAt) return Promise.resolve(token)
  if (pending !== null) return pending
  const p = request('').finally(() => { if (pending === p) pending = null })
  pending = p
  return p
}

/** Called from a click, so GIS may raise the account picker or the consent screen.
 *  The gesture is the only difference from a quiet renewal. */
export function signIn(): Promise<void> {
  return getToken(true).then(() => undefined)
}

/** Revokes, never only clears: a local clear would quiet-renew straight back in.
 *  Also drops the cached client: after a revoke it is stale, and a fresh sign-in should
 *  rebuild it rather than keep firing the previous initTokenClient callback. */
export function signOut(): Promise<void> {
  const held = token
  token = null
  expiresAt = 0
  client = null
  if (held === null) return Promise.resolve()
  return whenReady().then(g => new Promise<void>(resolve => { g.accounts.oauth2.revoke(held, () => resolve()) }))
}

export function isSignedIn(): boolean {
  return token !== null && Date.now() < expiresAt
}
