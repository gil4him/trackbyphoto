import { isSameDay } from '../util'
import type { Memo } from '../types'

/** The parent's 내 사진 in the simple edition: only what was taken today. */
export function todayMemos(memos: Memo[], now: Date = new Date()): Memo[] {
  return memos.filter((m) => isSameDay(m.takenAt.toDate(), now))
}

/** 지도에서 보기: Google Maps in the simple edition, Apple Maps in full. */
export function mapLink(memo: Pick<Memo, 'lat' | 'lng' | 'place'>, simple: boolean): string | null {
  if (memo.lat == null || memo.lng == null) return null
  return simple
    ? `https://www.google.com/maps/search/?api=1&query=${memo.lat},${memo.lng}`
    : `https://maps.apple.com/?ll=${memo.lat},${memo.lng}&q=${encodeURIComponent(memo.place || '위치')}`
}
