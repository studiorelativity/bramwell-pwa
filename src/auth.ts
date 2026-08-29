// STAGE 02 — GIS token client. The ONLY file that knows about Google auth. Exports exactly these four.
const E = () => new Error('STAGE 02: not implemented')
export function getToken(_forceRefresh = false): Promise<string> { throw E() }
export function signIn(): Promise<void> { throw E() }
export function signOut(): Promise<void> { throw E() }
export function isSignedIn(): boolean { throw E() }
