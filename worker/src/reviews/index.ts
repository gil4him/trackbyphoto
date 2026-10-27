/**
 * 스토어 리뷰 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D13): what families wrote
 * on the App Store and Google Play, on one list.
 *
 * Both stores are read, never written: a reply is left in the store's own
 * console. Apple returns every review; Google's API only returns reviews
 * written or edited in the last week, so the Play side is a window, and the
 * screen says so. A store without its env says `unconfigured` with the
 * names missing.
 */

export interface Review {
  id: string
  store: 'app_store' | 'play_store'
  /** 1–5 */
  rating: number
  title: string
  body: string
  author: string
  atMs: number
  /** Country (Apple) or language (Google), as the store gives it. */
  where: string
  /** The developer answered in the store's console. */
  replied: boolean
  version: string | null
}

export type SourceState = 'ok' | 'unconfigured' | 'error'

export interface StoreReviews {
  state: SourceState
  missing: string[]
  error: string | null
  reviews: Review[]
}

export interface ReviewsSummary {
  /** Reviews written in the last 30 days, and their average. */
  count30d: number
  avg30d: number | null
  /** Written in the last 24 hours (the morning push names them). */
  new24h: number
  unanswered: number
  /** How many gave 1…5 stars, in the last 30 days (index 0 = 1 star). */
  stars30d: number[]
}

const D = 86_400_000

export function reviewsSummary(reviews: Review[], now: number): ReviewsSummary {
  const recent = reviews.filter((r) => r.atMs >= now - 30 * D)
  const stars30d = [0, 0, 0, 0, 0]
  for (const r of recent) if (r.rating >= 1 && r.rating <= 5) stars30d[r.rating - 1]++
  return {
    count30d: recent.length,
    avg30d: recent.length ? Math.round((recent.reduce((s, r) => s + r.rating, 0) / recent.length) * 10) / 10 : null,
    new24h: reviews.filter((r) => r.atMs >= now - D).length,
    unanswered: reviews.filter((r) => !r.replied).length,
    stars30d,
  }
}

/** Newest first, both stores together. */
export function mergeReviews(...lists: Review[][]): Review[] {
  return lists.flat().sort((a, b) => b.atMs - a.atMs)
}
