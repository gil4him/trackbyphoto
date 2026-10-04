// Which map draws a route.
//
//   in Korea            → Kakao Map (free quota), loaded when the page opens
//   anywhere else       → Google Static Maps, fetched only when the person taps
//   no key for the area → the keyless sketch: the route's shape, no map tiles
//
// The digest page only ever uses the sketch, so opening a digest never makes
// a map request.

import type { LatLng } from '../trail'

export type MapProvider = 'kakao' | 'googleStatic' | 'sketch'

export interface MapKeys { kakao?: string; google?: string }

export const MAP_KEYS: MapKeys = {
  kakao: (import.meta.env.VITE_KAKAO_JS_KEY as string | undefined) || undefined,
  google: (import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined) || undefined,
}

/** Rough box around South Korea (Jeju to the DMZ, Baengnyeong to Dokdo). */
export function inKorea(p: LatLng): boolean {
  return p.lat >= 33 && p.lat <= 38.7 && p.lng >= 124.5 && p.lng <= 132
}

export function pickProvider(points: LatLng[], keys: MapKeys = MAP_KEYS): MapProvider {
  if (points.length === 0) return 'sketch'
  if (points.every(inKorea)) return keys.kakao ? 'kakao' : 'sketch'
  return keys.google ? 'googleStatic' : 'sketch'
}
