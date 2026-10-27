/**
 * adminReviews — 스토어 리뷰 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D13). Read-only.
 * The App Store's and Google Play's reviews on one list, newest first, with
 * the 30-day summary. Kept 30 minutes in memory; `refresh: true` skips that.
 * A store without its env says so; a store that failed keeps the other's
 * answer. The parsers are in ../reviews/.
 */

import type { Caller } from '../context.js'
import { requireAdmin } from './admin.js'
import { ascReviewsMissing, fetchAscReviews, type ReviewsFetch } from '../reviews/asc.js'
import { fetchPlayReviews, playReviewsMissing } from '../reviews/play.js'
import { mergeReviews, reviewsSummary, type Review, type ReviewsSummary, type StoreReviews } from '../reviews/index.js'
import { logger } from '../log.js'

const CACHE_MS = 30 * 60_000

export interface AdminReviews {
  ios: StoreReviews
  android: StoreReviews
  reviews: Review[]
  summary: ReviewsSummary
  at: string
}

export interface ReviewsDeps {
  iosMissing: () => string[]
  androidMissing: () => string[]
  fetchIos: () => Promise<ReviewsFetch>
  fetchAndroid: () => Promise<ReviewsFetch>
  now: () => number
}

export const defaultReviewsDeps: ReviewsDeps = {
  iosMissing: ascReviewsMissing,
  androidMissing: playReviewsMissing,
  fetchIos: () => fetchAscReviews(),
  fetchAndroid: () => fetchPlayReviews(),
  now: () => Date.now(),
}

let cache: { at: number; value: AdminReviews } | null = null
export function resetReviewsCache() { cache = null }

async function oneStore(missing: string[], fetchIt: () => Promise<ReviewsFetch>, name: string): Promise<StoreReviews> {
  if (missing.length) return { state: 'unconfigured', missing, error: null, reviews: [] }
  const got = await fetchIt()
  if (!got.ok) {
    logger.warn('[adminReviews] store failed', { store: name, err: got.error })
    return { state: 'error', missing: [], error: got.error, reviews: [] }
  }
  return { state: 'ok', missing: [], error: null, reviews: got.reviews }
}

/** The reviews as of now (no caller check): the morning push reads them too. */
export async function loadReviews(deps: ReviewsDeps = defaultReviewsDeps, refresh = false): Promise<AdminReviews> {
  const now = deps.now()
  if (cache && !refresh && now - cache.at < CACHE_MS) return cache.value
  const [ios, android] = await Promise.all([
    oneStore(deps.iosMissing(), deps.fetchIos, 'app_store'),
    oneStore(deps.androidMissing(), deps.fetchAndroid, 'play_store'),
  ])
  const reviews = mergeReviews(ios.reviews, android.reviews)
  const value: AdminReviews = { ios, android, reviews, summary: reviewsSummary(reviews, now), at: new Date(now).toISOString() }
  cache = { at: now, value }
  return value
}

export async function adminReviews(caller: Caller, data: { refresh?: unknown } = {}, deps: ReviewsDeps = defaultReviewsDeps): Promise<AdminReviews> {
  requireAdmin(caller)
  return loadReviews(deps, data?.refresh === true)
}
