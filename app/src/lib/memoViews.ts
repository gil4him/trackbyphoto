import type { Memo, Reaction } from '../types'
import { distanceKm, type LatLng } from './trail'
import { lang, tr } from './lang'

const EN_DAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

// ── The parent's day on the family home (simple edition, option C) ─────────

/** `10월 4일 토요일` */
export function dayEyebrow(d: Date): string {
  if (lang === 'en') return EN_DAY.format(d)
  const wk = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${wk}요일`
}

/** `15:30` — the timeline's rail. */
export function clock(d: Date): string {
  if (lang === 'en') {
    // 12-hour, compact enough for the 46pt time column: 7:10 PM.
    const h = d.getHours() % 12 || 12
    return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`
  }
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
export function dayCaption(count: number, maxKm: number | null, places = 0): string {
  if (lang === 'en') {
    // English readers are mostly in the US: miles.
    const photos = `${count} photo${count === 1 ? '' : 's'}`
    const at = places ? `${places} place${places === 1 ? '' : 's'}` : ''
    if (maxKm == null) return [photos, at].filter(Boolean).join(' · ')
    const mi = maxKm * 0.621371
    return [photos, at, `up to ${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi from home`].filter(Boolean).join(' · ')
  }
  const photos = `사진 ${count}장`
  const at = places ? `${places}곳` : ''
  if (maxKm == null) return [photos, at].filter(Boolean).join(' · ')
  return [photos, at, `집에서 최대 ${maxKm < 10 ? maxKm.toFixed(1) : Math.round(maxKm)}km`].filter(Boolean).join(' · ')
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

/** The memo's own words when the model wrote nothing particular. */
const GENERIC_TITLE = '사진을 남겼어요'

/** The card's title: the memo's line, or what is happening to it. A generic
 *  `사진을 남겼어요` reads `{place}에서` when the place is known. */
export function cardTitle(m: Pick<Memo, 'status' | 'memo' | 'activity'> & { place?: string }, serverDown = false): string {
  if (m.status !== 'pending') {
    const name = placeName(m.place)
    if ((m.memo || '').trim() === GENERIC_TITLE && name) return tr(`${name}에서`, `At ${name}`)
    if ((m.memo || '').trim() === GENERIC_TITLE && lang === 'en') return 'Photo'
    return m.memo || m.activity || tr('기록', 'Photo')
  }
  return serverDown ? tr('메모 서버가 쉬는 중이에요. 켜지면 써 드려요.', "The memo server is resting. We'll write it once it's back.") : tr('메모 작성 중…', 'Writing the memo…')
}

/** `♥ 2 · 💬 1` for a list card; '' when nothing was left on the photo. */
export function rowCounts(items: Reaction[] | undefined): string {
  const { hearts, words } = reactionSummary(items)
  return [hearts.length ? `♥ ${hearts.length}` : '', words ? `💬 ${words}` : ''].filter(Boolean).join(' · ')
}

/** `place · category · ♥ 지민, 민수 · 💬 2` — only the parts that exist. */
export function cardMeta(m: Pick<Memo, 'place' | 'activity'>, items: Reaction[] | undefined): string {
  const { hearts, words } = reactionSummary(items)
  return [m.place, m.activity, hearts.length ? `♥ ${hearts.join(', ')}` : '', words ? `💬 ${words}` : '']
    .filter(Boolean).join(' · ')
}

export type DetailAction = 'share' | 'send' | 'edit' | 'rewrite' | 'delete'

/** What a photo page's ⋯ menu offers, top to bottom (삭제 last, in red).
 *  Sharing is the simple edition's (its share sheet also saves the photo on
 *  an iPhone). Nothing for someone who may only look. */
export function detailActions(o: { simple: boolean; readOnly: boolean; hasPhoto: boolean; hasMemo: boolean; rewriting: boolean; canSend?: boolean }): DetailAction[] {
  if (o.readOnly) return []
  const out: DetailAction[] = []
  if (o.simple && o.hasPhoto) out.push('share')
  // 부모님께 보내기: a family member's own photo, to their parents.
  if (o.canSend && o.hasPhoto) out.push('send')
  if (o.hasMemo && !o.rewriting) out.push('edit', 'rewrite')
  out.push('delete')
  return out
}

/**
 * A place's own name, without 동/구: `석촌호수 · 잠실동, 송파구` → `석촌호수`,
 * `잠실동, 송파구` → `잠실동`. '' when unknown. The full place stays on the
 * photo's page.
 */
export function placeName(place: string | undefined): string {
  const p = (place || '').trim()
  if (!p) return ''
  if (p.includes(' · ')) return p.split(' · ')[0].trim()
  return p.split(',')[0].trim()
}

/** A row's meta line (A14.2): the place's name only. */
export function rowMeta(m: Pick<Memo, 'place'>): string {
  return placeName(m.place)
}

/** How many hearts (each person once) and words came back on a photo. */
export function reactionCounts(items: Reaction[] | undefined): { hearts: number; words: number } {
  const { hearts, words } = reactionSummary(items)
  return { hearts: hearts.length, words }
}
