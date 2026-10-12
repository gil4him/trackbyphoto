import type { Memo, Reaction } from '../types'
import { distanceKm, type LatLng } from './trail'

// ── The parent's day on the family home (simple edition, option C) ─────────

/** `10월 4일 토요일` */
export function dayEyebrow(d: Date): string {
  const wk = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${wk}요일`
}

/** `15:30` — the timeline's rail. */
export function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The memos taken on `day` (local), in the order given (newest first). */
export function memosOnDay(memos: Memo[], day: Date): Memo[] {
  return memos.filter((m) => {
    const t = m.takenAt.toDate()
    return t.getFullYear() === day.getFullYear() && t.getMonth() === day.getMonth() && t.getDate() === day.getDate()
  })
}

/** How far from home the day went, in km; null when home is unknown or no photo is located. */
export function farthestKm(memos: Memo[], home: LatLng | null): number | null {
  if (!home) return null
  let max: number | null = null
  for (const m of memos) {
    if (typeof m.lat !== 'number' || typeof m.lng !== 'number') continue
    const km = distanceKm(home, { lat: m.lat, lng: m.lng })
    if (max == null || km > max) max = km
  }
  return max
}

/** `사진 9장 · 집에서 최대 2.0km`; just the count when the distance is unknown. */
export function dayCaption(count: number, maxKm: number | null): string {
  const photos = `사진 ${count}장`
  if (maxKm == null) return photos
  return `${photos} · 집에서 최대 ${maxKm < 10 ? maxKm.toFixed(1) : Math.round(maxKm)}km`
}

/** Who sent hearts (each once) and how many words came back, for one card. */
export function reactionSummary(items: Reaction[] | undefined): { hearts: string[]; words: number } {
  const hearts: string[] = []
  let words = 0
  for (const r of items ?? []) {
    if (r.kind === 'heart') { const n = r.actorName.trim(); if (n && !hearts.includes(n)) hearts.push(n) }
    else if (r.kind === 'comment' || r.kind === 'voice') words++
  }
  return { hearts, words }
}

/** The card's title: the memo's line, or what is happening to it. */
export function cardTitle(m: Pick<Memo, 'status' | 'memo' | 'activity'>, serverDown = false): string {
  if (m.status !== 'pending') return m.memo || m.activity || '기록'
  return serverDown ? '메모 서버가 쉬는 중이에요. 켜지면 써 드려요.' : '메모 작성 중…'
}

/** `place · category · ♥ 지민, 민수 · 💬 2` — only the parts that exist. */
export function cardMeta(m: Pick<Memo, 'place' | 'activity'>, items: Reaction[] | undefined): string {
  const { hearts, words } = reactionSummary(items)
  return [m.place, m.activity, hearts.length ? `♥ ${hearts.join(', ')}` : '', words ? `💬 ${words}` : '']
    .filter(Boolean).join(' · ')
}

/** 지도에서 보기: Google Maps in the simple edition, Apple Maps in full. */
export function mapLink(memo: Pick<Memo, 'lat' | 'lng' | 'place'>, simple: boolean): string | null {
  if (memo.lat == null || memo.lng == null) return null
  return simple
    ? `https://www.google.com/maps/search/?api=1&query=${memo.lat},${memo.lng}`
    : `https://maps.apple.com/?ll=${memo.lat},${memo.lng}&q=${encodeURIComponent(memo.place || '위치')}`
}

export type DetailAction = 'share' | 'edit' | 'rewrite' | 'delete'

/** What a photo page's ⋯ menu offers, top to bottom (삭제 last, in red).
 *  Sharing is the simple edition's (its share sheet also saves the photo on
 *  an iPhone). Nothing for someone who may only look. */
export function detailActions(o: { simple: boolean; readOnly: boolean; hasPhoto: boolean; hasMemo: boolean; rewriting: boolean }): DetailAction[] {
  if (o.readOnly) return []
  const out: DetailAction[] = []
  if (o.simple && o.hasPhoto) out.push('share')
  if (o.hasMemo && !o.rewriting) out.push('edit', 'rewrite')
  out.push('delete')
  return out
}
