/** 알림 켜기 nudge: closed for a day the first three times, then a week. */
export const NUDGE_DISMISS_KEY = 'tbp.pushNudge.dismissed'
export const NUDGE_SHORT_MS = 24 * 3600 * 1000
export const NUDGE_DISMISS_MS = 7 * NUDGE_SHORT_MS
const SHORT_CLOSES = 3

/** What to store when the nudge is closed now: the time and how many closes. */
export function nudgeDismissValue(now = Date.now(), stored: string | null = null): string {
  const closes = Number(stored?.split(':')[1]) || 0
  return `${now}:${closes + 1}`
}

/** True while a stored dismissal still holds. An older value without a count
 *  counts as one close; the oldest ('1', closed for good) has long run out. */
export function nudgeDismissed(stored: string | null, now = Date.now()): boolean {
  if (!stored) return false
  const [at, closes] = stored.split(':').map(Number)
  if (!Number.isFinite(at)) return false
  return now - at < ((closes || 1) <= SHORT_CLOSES ? NUDGE_SHORT_MS : NUDGE_DISMISS_MS)
}
