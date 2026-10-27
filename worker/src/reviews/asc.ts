/**
 * App Store customer reviews through the App Store Connect API.
 *
 * Reading reviews takes an App Manager (or Customer Support) key; the Sales
 * key that reads the installs report is refused here. So this uses its own
 * key names, with the issuer and app id shared with traffic/asc.ts:
 *
 *   ASC_REVIEWS_KEY_ID, ASC_REVIEWS_KEY_PATH, ASC_ISSUER_ID, ASC_APP_ID
 */

import { ascTokenFor } from '../traffic/asc.js'
import type { Review } from './index.js'

export const ASC_REVIEWS_ENV = ['ASC_REVIEWS_KEY_ID', 'ASC_REVIEWS_KEY_PATH', 'ASC_ISSUER_ID', 'ASC_APP_ID'] as const
const env = (k: string) => process.env[k]?.trim() || ''

export function ascReviewsMissing(): string[] {
  return ASC_REVIEWS_ENV.filter((k) => !env(k))
}

/** Apple's customerReviews JSON (with `include=response`) on our rows. */
export function parseAscReviews(json: unknown): Review[] {
  const data = (json as { data?: unknown })?.data
  if (!Array.isArray(data)) throw new Error('not a customer reviews answer')
  return data.flatMap((r: Record<string, unknown>) => {
    const a = (r.attributes ?? {}) as Record<string, unknown>
    const at = typeof a.createdDate === 'string' ? Date.parse(a.createdDate) : NaN
    if (typeof r.id !== 'string' || Number.isNaN(at)) return []
    const response = ((r.relationships as Record<string, { data?: unknown }> | undefined)?.response?.data ?? null)
    return [{
      id: `ios:${r.id}`,
      store: 'app_store' as const,
      rating: typeof a.rating === 'number' ? a.rating : 0,
      title: typeof a.title === 'string' ? a.title : '',
      body: typeof a.body === 'string' ? a.body : '',
      author: typeof a.reviewerNickname === 'string' ? a.reviewerNickname : '',
      atMs: at,
      where: typeof a.territory === 'string' ? a.territory : '',
      replied: response !== null && response !== undefined,
      version: null,
    }]
  })
}

export type ReviewsFetch = { ok: true; reviews: Review[] } | { ok: false; error: string }

export async function fetchAscReviews(fetchFn: typeof fetch = fetch): Promise<ReviewsFetch> {
  const q = new URLSearchParams({ sort: '-createdDate', limit: '50', include: 'response', 'fields[customerReviewResponses]': 'state' })
  let res: Response
  try {
    res = await fetchFn(`https://api.appstoreconnect.apple.com/v1/apps/${encodeURIComponent(env('ASC_APP_ID'))}/customerReviews?${q}`, {
      headers: { Authorization: `Bearer ${ascTokenFor('ASC_REVIEWS_KEY_ID', 'ASC_REVIEWS_KEY_PATH')}` }, signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    return { ok: false, error: String((err as Error).message ?? err).slice(0, 120) }
  }
  if (!res.ok) return { ok: false, error: `App Store Connect ${res.status}${res.status === 403 ? ' (리뷰는 App Manager 키로만 읽혀요)' : ''}` }
  try {
    return { ok: true, reviews: parseAscReviews(await res.json()) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
