// Google Static Maps: one image of the route, for places outside Korea.
// A paid API, so the URL is only ever requested after the person taps
// "지도로 보기" (see pages/Trail.tsx) and never from a digest.

import type { LatLng } from '../trail'

/** Markers carry a single character, and long URLs are refused. */
const MAX_POINTS = 25
const ROUTE_COLOR = '0xFF6B2CFF'

export function staticMapUrl(points: LatLng[], key: string, size = { width: 640, height: 400 }): string {
  const pts = points.slice(0, MAX_POINTS)
  const at = (p: LatLng) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
  const params = new URLSearchParams({ size: `${size.width}x${size.height}`, scale: '2', language: 'ko', key })
  if (pts.length > 1) params.append('path', [`color:${ROUTE_COLOR}`, 'weight:4', ...pts.map(at)].join('|'))
  pts.forEach((p, i) => params.append('markers', [`color:0xFF6B2C`, ...(i < 9 ? [`label:${i + 1}`] : []), at(p)].join('|')))
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`
}
