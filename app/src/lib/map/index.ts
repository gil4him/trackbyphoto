import { Capacitor } from '@capacitor/core'
// Which map draws a route.
//
//   in Korea            → Kakao Map (free quota), loaded when the page opens
//   anywhere else       → Google Static Maps, one picture when the trail page opens
//   no key for the area → the keyless sketch: the route's shape, no map tiles
//
// Kakao's JavaScript key only works on the website's registered domains: in
// the store apps (capacitor://localhost, https://localhost) the SDK answers
// 401, so there Korea gets the Google picture too (scripts/map-check.ts).
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

/** Kakao can draw here: the website, not the store apps. */
export const KAKAO_USABLE = !Capacitor.isNativePlatform()

/** `kakaoUsable` false: the store apps, or a Kakao map that already failed to load. */
export function pickProvider(points: LatLng[], keys: MapKeys = MAP_KEYS, kakaoUsable = KAKAO_USABLE): MapProvider {
  if (points.length === 0) return 'sketch'
  if (points.every(inKorea) && kakaoUsable && keys.kakao) return 'kakao'
  return keys.google ? 'googleStatic' : 'sketch'
}
