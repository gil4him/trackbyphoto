import type { Memo } from '../types'

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
