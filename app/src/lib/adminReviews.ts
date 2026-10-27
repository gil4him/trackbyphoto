// 스토어 리뷰 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D13): the worker's list
// (worker/src/reviews) and the small text the 오늘 card needs.

import { callWorker } from './worker'

export interface Review {
  id: string
  store: 'app_store' | 'play_store'
  rating: number
  title: string
  body: string
  author: string
  atMs: number
  where: string
  replied: boolean
  version: string | null
}
export interface StoreReviews { state: 'ok' | 'unconfigured' | 'error'; missing: string[]; error: string | null; reviews: Review[] }
export interface ReviewsSummary { count30d: number; avg30d: number | null; new24h: number; unanswered: number; stars30d: number[] }
export interface AdminReviews { ios: StoreReviews; android: StoreReviews; reviews: Review[]; summary: ReviewsSummary; at: string }

export const adminReviews = (refresh = false) =>
  callWorker<AdminReviews>('adminReviews', refresh ? { refresh: true } : {}, { timeoutMs: 60_000 })

export const STORE_KO = { app_store: 'App Store', play_store: 'Google Play' } as const

/** 4 → "★★★★☆". */
export function stars(n: number): string {
  const k = Math.max(0, Math.min(5, Math.round(n)))
  return '★'.repeat(k) + '☆'.repeat(5 - k)
}

/** The review's one line: its title, else its text, else a note. */
export function reviewLine(r: Review): string {
  const t = r.title.trim() || r.body.trim()
  return t || '(글 없이 별점만)'
}

/** "3시간 전", "어제", "10월 3일". */
export function reviewAgo(atMs: number, now = Date.now()): string {
  const h = Math.floor((now - atMs) / 3_600_000)
  if (h < 1) return '방금'
  if (h < 24) return `${h}시간 전`
  const d = Math.floor(h / 24)
  if (d === 1) return '어제'
  if (d < 7) return `${d}일 전`
  const at = new Date(atMs)
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' }).format(at)
}

/** "30일 3개 · 평균 ★3.3 · 답장 없음 2개", or what there is. */
export function summaryLine(s: ReviewsSummary): string {
  if (s.count30d === 0) return s.unanswered ? `30일 안 리뷰 없음 · 답장 없음 ${s.unanswered}개` : '30일 안 리뷰 없음'
  return `30일 ${s.count30d}개 · 평균 ★${s.avg30d} · 답장 없음 ${s.unanswered}개`
}
