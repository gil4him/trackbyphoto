import type { Memo } from '../types'

/** 지도에서 보기: Google Maps in the simple edition, Apple Maps in full. */
export function mapLink(memo: Pick<Memo, 'lat' | 'lng' | 'place'>, simple: boolean): string | null {
  if (memo.lat == null || memo.lng == null) return null
  return simple
    ? `https://www.google.com/maps/search/?api=1&query=${memo.lat},${memo.lng}`
    : `https://maps.apple.com/?ll=${memo.lat},${memo.lng}&q=${encodeURIComponent(memo.place || '위치')}`
}

export type DetailAction = 'share' | 'save' | 'edit' | 'rewrite' | 'delete'

/** What a photo page's ⋯ menu offers, top to bottom (삭제 last, in red).
 *  Sharing is the simple edition's; saving is for a browser (the app's share
 *  sheet already saves). Nothing for someone who may only look. */
export function detailActions(o: { simple: boolean; readOnly: boolean; native: boolean; hasPhoto: boolean; hasMemo: boolean; rewriting: boolean }): DetailAction[] {
  if (o.readOnly) return []
  const out: DetailAction[] = []
  if (o.simple && o.hasPhoto) {
    out.push('share')
    if (!o.native) out.push('save')
  }
  if (o.hasMemo && !o.rewriting) out.push('edit', 'rewrite')
  out.push('delete')
  return out
}
