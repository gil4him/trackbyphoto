import { PUBLIC_ORIGIN } from '../publicUrl'
import type { LatLng } from '../trail'
import type { MapPin } from './kakao'

/** What public/kakao-map.html draws, sent in its URL hash. */
export interface FramePins {
  key: string
  pins: Array<Pick<MapPin, 'lat' | 'lng' | 'label' | 'photoUrl'>>
  home: LatLng | null
  /** Room around the route. */
  pad?: number
  /** Full-size pins with photos (다녀온 곳); small numbered dots otherwise. */
  big?: boolean
}

/**
 * The store apps can't load Kakao themselves (its key only works on the
 * site's domains), so they show the site's map page in an iframe; there the
 * map is drawn on the registered domain.
 */
export function kakaoFrameUrl({ key, pins, home, pad, big }: FramePins, origin = PUBLIC_ORIGIN): string {
  const data = {
    k: key,
    pins: pins.map((p) => ({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6), label: p.label, ...(p.photoUrl ? { photoUrl: p.photoUrl } : {}) })),
    home: home ? { lat: +home.lat.toFixed(6), lng: +home.lng.toFixed(6) } : null,
    ...(pad !== undefined ? { pad } : {}),
    ...(big ? { big: true } : {}),
  }
  return `${origin}/kakao-map.html#${encodeURIComponent(JSON.stringify(data))}`
}

export type FrameMessage = { type: 'ready' } | { type: 'error' } | { type: 'pick'; index: number }

/** A message from the map page, or null for anything else on the channel. */
export function frameMessage(data: unknown): FrameMessage | null {
  const d = data as { source?: unknown; type?: unknown; index?: unknown } | null
  if (!d || d.source !== 'daylie-map') return null
  if (d.type === 'ready' || d.type === 'error') return { type: d.type }
  if (d.type === 'pick' && typeof d.index === 'number') return { type: 'pick', index: d.index }
  return null
}
