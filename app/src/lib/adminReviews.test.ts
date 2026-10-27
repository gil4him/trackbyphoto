// 스토어 리뷰 (D13): the small text the 오늘 card needs.
import { describe, it, expect, vi } from 'vitest'
vi.mock('./worker', () => ({ callWorker: vi.fn() }))
import { reviewAgo, reviewLine, stars, summaryLine, type Review } from './adminReviews'

const H = 3_600_000
const r = (over: Partial<Review>): Review => ({ id: 'x', store: 'app_store', rating: 4, title: '', body: '', author: 'a', atMs: 0, where: 'KOR', replied: false, version: null, ...over })

describe('stars and lines', () => {
  it('draws the stars and keeps a review to one line', () => {
    expect(stars(4)).toBe('★★★★☆')
    expect(stars(0)).toBe('☆☆☆☆☆')
    expect(reviewLine(r({ title: '좋아요', body: '길게' }))).toBe('좋아요')
    expect(reviewLine(r({ body: ' 본문만 ' }))).toBe('본문만')
    expect(reviewLine(r({}))).toBe('(글 없이 별점만)')
  })
  it('says when, in Seoul', () => {
    const now = Date.parse('2026-10-27T03:00:00Z')
    expect(reviewAgo(now - 10 * 60_000, now)).toBe('방금')
    expect(reviewAgo(now - 3 * H, now)).toBe('3시간 전')
    expect(reviewAgo(now - 30 * H, now)).toBe('어제')
    expect(reviewAgo(now - 4 * 24 * H, now)).toBe('4일 전')
    expect(reviewAgo(Date.parse('2026-10-03T00:00:00Z'), now)).toBe('10월 3일')
  })
  it('sums up the month', () => {
    expect(summaryLine({ count30d: 3, avg30d: 3.3, new24h: 1, unanswered: 2, stars30d: [1, 0, 0, 1, 1] })).toBe('30일 3개 · 평균 ★3.3 · 답장 없음 2개')
    expect(summaryLine({ count30d: 0, avg30d: null, new24h: 0, unanswered: 1, stars30d: [0, 0, 0, 0, 0] })).toBe('30일 안 리뷰 없음 · 답장 없음 1개')
    expect(summaryLine({ count30d: 0, avg30d: null, new24h: 0, unanswered: 0, stars30d: [0, 0, 0, 0, 0] })).toBe('30일 안 리뷰 없음')
  })
})
