// 스토어 리뷰 (운영실 D13): the two stores' answers on one list, the 30-day
// summary, and the handler with each store connected, missing, or failing.

import { describe, it, expect, beforeEach } from 'vitest'
import { parseAscReviews } from '../src/reviews/asc'
import { parsePlayReviews } from '../src/reviews/play'
import { mergeReviews, reviewsSummary, type Review } from '../src/reviews/index'
import { adminReviews, resetReviewsCache, type ReviewsDeps } from '../src/handlers/adminReviews'

const D = 86_400_000
const NOW = Date.parse('2026-10-27T03:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

const ASC = {
  data: [
    { type: 'customerReviews', id: 'r1', attributes: { rating: 5, title: '엄마가 좋아해요', body: '사진 한 장으로 하루를 알 수 있어요.', reviewerNickname: '지은', createdDate: iso(NOW - 2 * D), territory: 'KOR' }, relationships: { response: { data: { type: 'customerReviewResponses', id: 'x' } } } },
    { type: 'customerReviews', id: 'r2', attributes: { rating: 2, title: '', body: '알림이 늦어요', reviewerNickname: 'A', createdDate: iso(NOW - 40 * D), territory: 'USA' }, relationships: { response: { data: null } } },
    { type: 'customerReviews', id: 'bad', attributes: {} },
  ],
}
const PLAY = {
  reviews: [
    { reviewId: 'p1', authorName: '민수', comments: [
      { userComment: { text: '\t부모님 사진이 매일 와요', lastModified: { seconds: String(Math.floor((NOW - 3 * D) / 1000)) }, starRating: 4, reviewerLanguage: 'ko', appVersionName: '1.0.1' } },
      { developerComment: { text: '고마워요', lastModified: { seconds: '1' } } },
    ] },
    { reviewId: 'p2', authorName: 'B', comments: [{ userComment: { text: '', lastModified: { seconds: String(Math.floor((NOW - 6 * 3600_000) / 1000)) }, starRating: 1 } }] },
    { reviewId: 'p3', comments: [] },
  ],
}

describe('store review parsers', () => {
  it('reads Apple\'s customerReviews with whether a response exists', () => {
    const r = parseAscReviews(ASC)
    expect(r.map((x) => [x.id, x.rating, x.title, x.author, x.where, x.replied])).toEqual([['ios:r1', 5, '엄마가 좋아해요', '지은', 'KOR', true], ['ios:r2', 2, '', 'A', 'USA', false]])
    expect(() => parseAscReviews({ errors: [] })).toThrow(/not a customer reviews answer/)
  })
  it('reads Google\'s reviews.list: the user comment, the version, a developer reply', () => {
    const r = parsePlayReviews(PLAY)
    expect(r.map((x) => [x.id, x.rating, x.body, x.author, x.where, x.replied, x.version])).toEqual([['android:p1', 4, '부모님 사진이 매일 와요', '민수', 'ko', true, '1.0.1'], ['android:p2', 1, '', 'B', '', false, null]])
    expect(parsePlayReviews({})).toEqual([])
    expect(() => parsePlayReviews({ reviews: 'x' })).toThrow(/not a reviews answer/)
  })
})

describe('reviewsSummary', () => {
  it('counts the last 30 days, the last day, and what has no reply', () => {
    const all = mergeReviews(parseAscReviews(ASC), parsePlayReviews(PLAY))
    expect(all.map((r) => r.id)).toEqual(['android:p2', 'ios:r1', 'android:p1', 'ios:r2'])
    expect(reviewsSummary(all, NOW)).toEqual({ count30d: 3, avg30d: 3.3, new24h: 1, unanswered: 2, stars30d: [1, 0, 0, 1, 1] })
    expect(reviewsSummary([], NOW)).toEqual({ count30d: 0, avg30d: null, new24h: 0, unanswered: 0, stars30d: [0, 0, 0, 0, 0] })
  })
})

describe('adminReviews handler', () => {
  const ADMIN = { uid: 'admin1', email: 'zymer4him@gmail.com', name: 'Shawn', emailVerified: true }
  const deps = (over: Partial<ReviewsDeps> = {}): ReviewsDeps => ({
    iosMissing: () => [], androidMissing: () => [],
    fetchIos: async () => ({ ok: true, reviews: parseAscReviews(ASC) }),
    fetchAndroid: async () => ({ ok: true, reviews: parsePlayReviews(PLAY) }),
    now: () => NOW, ...over,
  })
  beforeEach(() => resetReviewsCache())

  it('is for the admin only', async () => {
    await expect(adminReviews({ uid: 'x', email: 'x@example.com', name: 'x' }, {}, deps())).rejects.toThrow(/admin only/)
  })
  it('merges both stores newest first with the summary', async () => {
    const r = await adminReviews(ADMIN, {}, deps())
    expect(r.ios.state).toBe('ok')
    expect(r.android.state).toBe('ok')
    expect(r.reviews.length).toBe(4)
    expect(r.summary.count30d).toBe(3)
  })
  it('a store without its env says so; a store that failed keeps the other\'s answer', async () => {
    const r = await adminReviews(ADMIN, {}, deps({ iosMissing: () => ['ASC_REVIEWS_KEY_ID'], fetchAndroid: async () => ({ ok: false, error: 'Google Play 403' }) }))
    expect(r.ios).toEqual({ state: 'unconfigured', missing: ['ASC_REVIEWS_KEY_ID'], error: null, reviews: [] })
    expect(r.android).toMatchObject({ state: 'error', error: 'Google Play 403' })
    expect(r.reviews).toEqual([])
  })
  it('answers from memory for half an hour unless asked to refresh', async () => {
    let calls = 0
    const d = deps({ fetchIos: async () => { calls++; return { ok: true, reviews: [] as Review[] } } })
    await adminReviews(ADMIN, {}, d)
    await adminReviews(ADMIN, {}, d)
    expect(calls).toBe(1)
    await adminReviews(ADMIN, { refresh: true }, d)
    expect(calls).toBe(2)
  })
})
