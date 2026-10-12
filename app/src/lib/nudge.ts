/** 알림 켜기 nudge: closed for a week, then asked again (docs/DAYLIE_V3_UI_FIX.md A4). */
export const NUDGE_DISMISS_KEY = 'tbp.pushNudge.dismissed'
export const NUDGE_DISMISS_MS = 7 * 24 * 3600 * 1000

/** What to store when the nudge is closed now. */
export function nudgeDismissValue(now = Date.now()): string {
  return String(now)
}

/** True while a stored dismissal still holds. The old value '1' (closed for
 *  good, before the week rule) counts as closed just now. */
export function nudgeDismissed(stored: string | null, now = Date.now()): boolean {
  if (!stored) return false
  if (stored === '1') return true
  const at = Number(stored)
  return Number.isFinite(at) && now - at < NUDGE_DISMISS_MS
}
