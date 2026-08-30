// STAGE 05 — first-run, settings sheet, FAB. `toast` is built at stage 04: it is the
// error surface SPEC "Event form" requires, and the file layout puts toasts here, so
// there is no interim home to delete later (DECISIONS "Stage 04 rulings").
export function mount(_root: HTMLElement): void { throw new Error('STAGE 05: not implemented') }

/** Created on first use, so this module stays free of DOM at module scope. */
let host: HTMLElement | null = null

/** One animation is the toast's whole life — appear, dwell, leave — so its timing
 *  lives in motion.css and nothing here counts milliseconds. Under reduced motion
 *  the dwell survives and only the movement goes (motion.css carve-out). The role
 *  is `alert` not `status`: this is the error surface; a polite region can be skipped,
 *  and the toast self-removes with no way to recall it (SPEC "Event form" + DECISIONS). */
export function toast(message: string): void {
  if (host === null || !host.isConnected) {
    host = document.createElement('div')
    host.id = 'toasts'
    document.body.append(host)
  }
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'alert')
  el.textContent = message
  el.addEventListener('animationend', () => el.remove())
  host.append(el)
}
