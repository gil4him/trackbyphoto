/**
 * Google Play reviews through the Android Publisher API, read as the worker's
 * own service account (invited in Play Console with "View app information").
 * The firebase-admin credential's token lacks the androidpublisher scope, so
 * a token is minted here from the same key file.
 *
 *   PLAY_PACKAGE_NAME, GOOGLE_APPLICATION_CREDENTIALS
 *
 * Google only returns reviews written or edited in the last week.
 */

import { readFileSync } from 'node:fs'
import { createPrivateKey, sign } from 'node:crypto'
import type { Review } from './index.js'
import type { ReviewsFetch } from './asc.js'

export const PLAY_REVIEWS_ENV = ['PLAY_PACKAGE_NAME', 'GOOGLE_APPLICATION_CREDENTIALS'] as const
const env = (k: string) => process.env[k]?.trim() || ''
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher'

export function playReviewsMissing(): string[] {
  return PLAY_REVIEWS_ENV.filter((k) => !env(k))
}

let token: { value: string; expiresAt: number } | null = null
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')

/** An access token for the Play API from the service-account key, reused while fresh. */
export async function playToken(fetchFn: typeof fetch = fetch): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (token && token.expiresAt > now + 60) return token.value
  const sa = JSON.parse(readFileSync(env('GOOGLE_APPLICATION_CREDENTIALS'), 'utf8')) as { client_email: string; private_key: string }
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))
  const sig = sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), createPrivateKey(sa.private_key))
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${b64url(sig)}` }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Google token ${res.status}`)
  const j = (await res.json()) as { access_token: string; expires_in: number }
  token = { value: j.access_token, expiresAt: now + (j.expires_in ?? 3600) }
  return j.access_token
}

/** Google's reviews.list JSON on our rows: the user's comment, and whether the developer answered. */
export function parsePlayReviews(json: unknown): Review[] {
  const list = (json as { reviews?: unknown })?.reviews
  if (list === undefined) return []
  if (!Array.isArray(list)) throw new Error('not a reviews answer')
  return list.flatMap((r: Record<string, unknown>) => {
    const comments = Array.isArray(r.comments) ? (r.comments as Record<string, Record<string, unknown>>[]) : []
    const user = comments.find((c) => c.userComment)?.userComment
    if (!user || typeof r.reviewId !== 'string') return []
    const secs = Number((user.lastModified as { seconds?: unknown } | undefined)?.seconds)
    return [{
      id: `android:${r.reviewId}`,
      store: 'play_store' as const,
      rating: typeof user.starRating === 'number' ? user.starRating : 0,
      title: '',
      body: typeof user.text === 'string' ? user.text.trim() : '',
      author: typeof r.authorName === 'string' ? r.authorName : '',
      atMs: Number.isFinite(secs) ? secs * 1000 : 0,
      where: typeof user.reviewerLanguage === 'string' ? user.reviewerLanguage : '',
      replied: comments.some((c) => c.developerComment),
      version: typeof user.appVersionName === 'string' ? user.appVersionName : null,
    }]
  })
}

export async function fetchPlayReviews(fetchFn: typeof fetch = fetch): Promise<ReviewsFetch> {
  let res: Response
  try {
    const t = await playToken(fetchFn)
    res = await fetchFn(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(env('PLAY_PACKAGE_NAME'))}/reviews?maxResults=50`, {
      headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    return { ok: false, error: String((err as Error).message ?? err).slice(0, 120) }
  }
  if (!res.ok) {
    const hint = res.status === 403 ? ' (프로젝트에서 Google Play Android Developer API를 켜고, 서비스 계정에 Play Console 권한이 있어야 해요)' : ''
    return { ok: false, error: `Google Play ${res.status}${hint}` }
  }
  try {
    return { ok: true, reviews: parsePlayReviews(await res.json()) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
