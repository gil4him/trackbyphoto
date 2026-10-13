/**
 * Calls `onIdle` once nothing has been touched for `ms`. Any touch, tap, key
 * or scroll on `target` starts the wait again. Returns a stop function.
 * Used on the parent's phone: every screen but the camera goes back to the
 * camera after a minute without a touch (docs/DAYLIE_V3_UI_FIX.md A9).
 */
export const IDLE_RETURN_MS = 60_000
const EVENTS = ['pointerdown', 'touchstart', 'keydown', 'scroll', 'wheel'] as const

export function watchIdle(target: EventTarget, ms: number, onIdle: () => void): () => void {
  let timer = setTimeout(onIdle, ms)
  const reset = () => {
    clearTimeout(timer)
    timer = setTimeout(onIdle, ms)
  }
  for (const e of EVENTS) target.addEventListener(e, reset, { passive: true, capture: true })
  return () => {
    clearTimeout(timer)
    for (const e of EVENTS) target.removeEventListener(e, reset, { capture: true })
  }
}
