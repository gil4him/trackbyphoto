// 오늘 다녀온 곳: the day's photos as stops on a route, and how far from home
// they were. Pure functions; the map itself is drawn by lib/map/* or by the
// keyless sketch (components/TrailSketch).
//
// Home is the place family set in 설정 → 집 위치; otherwise it is worked out
// the same way the worker does it (worker/src/travel.ts): the ~10 km cell
// that holds most of the recent located photos, once enough of them agree.

import type { Memo } from '../types'

export interface LatLng { lat: number; lng: number }

/** Farther than this from home counts as travelling (same as the worker). */
export const AWAY_KM = 80
/** Photos taken this close together are one stop. */
export const STOP_RADIUS_KM = 0.15
/** Closer than this to home reads as "집 근처". */
const NEAR_HOME_KM = 0.2

const INFER_MIN_PHOTOS = 5
const INFER_MIN_SHARE = 0.3
const CELL_DEG = 0.1

export function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

/** Most common ~10 km cell among the points, if enough photos agree. */
export function inferHome(points: LatLng[]): LatLng | null {
  if (points.length < INFER_MIN_PHOTOS) return null
  const cells = new Map<string, LatLng[]>()
  for (const p of points) {
    const key = `${Math.floor(p.lat / CELL_DEG)}:${Math.floor(p.lng / CELL_DEG)}`
    cells.set(key, [...(cells.get(key) ?? []), p])
  }
  const top = [...cells.values()].sort((a, b) => b.length - a.length)[0]
  if (top.length < INFER_MIN_PHOTOS || top.length / points.length < INFER_MIN_SHARE) return null
  return {
    lat: top.reduce((s, p) => s + p.lat, 0) / top.length,
    lng: top.reduce((s, p) => s + p.lng, 0) / top.length,
  }
}

const located = (m: Memo): m is Memo & LatLng => typeof m.lat === 'number' && typeof m.lng === 'number'

/** Home for these memos: what family set, else inferred from where the photos are. */
export function homeFor(setHome: LatLng | null | undefined, memos: Memo[]): LatLng | null {
  if (setHome && typeof setHome.lat === 'number' && typeof setHome.lng === 'number') return { lat: setHome.lat, lng: setHome.lng }
  return inferHome(memos.filter(located))
}

export interface TrailStop {
  lat: number
  lng: number
  /** Photos taken at this stop, oldest first. */
  memos: Memo[]
  firstAt: Date
  /** Neighbourhood ("서초동"), when the photo has a place. */
  area: string
  kmFromHome: number | null
}

const areaOf = (place: string) => (place || '').split(' · ').pop()!.split(',')[0].trim()

/** The photos that have a location, as stops in the order they were visited.
 *  Coming back to a place later in the day is a new stop. */
export function trailStops(memos: Memo[], home: LatLng | null): TrailStop[] {
  const inOrder = memos.filter(located).sort((a, b) => a.takenAt.toMillis() - b.takenAt.toMillis())
  const stops: TrailStop[] = []
  for (const m of inOrder) {
    const last = stops[stops.length - 1]
    if (last && distanceKm(last, m) <= STOP_RADIUS_KM) {
      last.memos.push(m)
      if (!last.area) last.area = areaOf(m.place)
      continue
    }
    stops.push({
      lat: m.lat,
      lng: m.lng,
      memos: [m],
      firstAt: m.takenAt.toDate(),
      area: areaOf(m.place),
      kmFromHome: home ? distanceKm(home, m) : null,
    })
  }
  return stops
}

/** "집 근처", "1.2km", "900km". */
export function fmtKm(km: number): string {
  if (km < NEAR_HOME_KM) return '집 근처'
  return km < 10 ? `${km.toFixed(1)}km` : `${Math.round(km).toLocaleString('en-US')}km`
}

export interface TrailSummary {
  /** Farthest stop from home; null when home isn't known. */
  maxKm: number | null
  /** Every stop is far from home: a trip, not a day out. */
  away: boolean
  /** "집에서 최대 2.0km", "집 근처", "집에서 약 900km", or "" without a home. */
  text: string
}

export function trailSummary(stops: TrailStop[]): TrailSummary {
  const kms = stops.map((s) => s.kmFromHome).filter((k): k is number => k !== null)
  if (kms.length === 0) return { maxKm: null, away: false, text: '' }
  const maxKm = Math.max(...kms)
  const away = Math.min(...kms) >= AWAY_KM
  const text = away ? `집에서 약 ${fmtKm(maxKm)}` : maxKm < NEAR_HOME_KM ? '집 근처' : `집에서 최대 ${fmtKm(maxKm)}`
  return { maxKm, away, text }
}

/** Fit the points into a width × height box (north up), keeping the route's shape. */
export function project(points: LatLng[], width: number, height: number, pad: number): Array<{ x: number; y: number }> {
  if (points.length === 0) return []
  const midLat = points.reduce((s, p) => s + p.lat, 0) / points.length
  const k = Math.cos((midLat * Math.PI) / 180)
  const xs = points.map((p) => p.lng * k)
  const ys = points.map((p) => p.lat)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const spanX = maxX - minX, spanY = maxY - minY
  const scale = Math.min((width - 2 * pad) / (spanX || 1), (height - 2 * pad) / (spanY || 1))
  // A single place (or a straight line) sits in the middle of the box.
  const offX = (width - spanX * scale) / 2
  const offY = (height - spanY * scale) / 2
  return points.map((_, i) => ({
    x: spanX === 0 && spanY === 0 ? width / 2 : offX + (xs[i] - minX) * scale,
    y: spanX === 0 && spanY === 0 ? height / 2 : height - (offY + (ys[i] - minY) * scale),
  }))
}
