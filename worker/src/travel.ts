// Where a photo is relative to the patient's home, so the memo prompt can
// tell an everyday walk from a trip.
//
// Home comes from users/{uid}.home when the family has set it (설정 → 집
// 위치). Otherwise it's inferred: the ~10 km grid cell that holds the most of
// the patient's recent located photos, once enough of them agree.

import { getFirestore } from 'firebase-admin/firestore'
import { logger } from './log.js'

export interface LatLng { lat: number; lng: number }

/** Farther than this from home counts as travelling. */
export const AWAY_KM = 80

const INFER_SAMPLE = 200
const INFER_MIN_PHOTOS = 5
const INFER_MIN_SHARE = 0.3
const CELL_DEG = 0.1
const CACHE_MS = 30 * 60 * 1000

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
    const list = cells.get(key) ?? []
    list.push(p)
    cells.set(key, list)
  }
  const top = [...cells.values()].sort((a, b) => b.length - a.length)[0]
  if (top.length < INFER_MIN_PHOTOS || top.length / points.length < INFER_MIN_SHARE) return null
  return {
    lat: top.reduce((s, p) => s + p.lat, 0) / top.length,
    lng: top.reduce((s, p) => s + p.lng, 0) / top.length,
  }
}

/**
 * Rough UTC offset (hours) of a spot on the map. Korea and Japan are pinned
 * to +9 (their longitude alone would say +8); elsewhere it's the solar
 * estimate, which is within an hour — enough to tell morning from evening.
 */
export function utcOffsetHours(p: LatLng): number {
  if (p.lat >= 24 && p.lat <= 46 && p.lng >= 124 && p.lng <= 146) return 9
  return Math.round(p.lng / 15)
}

/** Used when neither the photo nor a home location says where the user is. */
const DEFAULT_UTC_OFFSET = Number(process.env.WORKER_DEFAULT_UTC_OFFSET ?? 9)

/**
 * HH:MM on the photographer's clock. The worker's own clock is no guide (the
 * Mac mini runs on US Pacific time), so use the photo's location, else home,
 * else the default (Korea).
 */
export async function localTimeHint(
  patientUid: string,
  takenAt: Date | undefined,
  lat: number | null,
  lng: number | null,
): Promise<string | undefined> {
  if (!takenAt) return undefined
  const where = lat != null && lng != null ? { lat, lng } : await resolveHome(patientUid)
  const offset = where ? utcOffsetHours(where) : DEFAULT_UTC_OFFSET
  return new Date(takenAt.getTime() + offset * 3600_000).toISOString().slice(11, 16)
}

const inferredCache = new Map<string, { home: LatLng | null; expiresAt: number }>()

/** Test hook: forget inferred homes. */
export function resetHomeCache() {
  inferredCache.clear()
}

export async function resolveHome(patientUid: string): Promise<LatLng | null> {
  const db = getFirestore()
  try {
    const home = (await db.collection('users').doc(patientUid).get()).data()?.home as Partial<LatLng> | undefined
    if (typeof home?.lat === 'number' && typeof home?.lng === 'number') return { lat: home.lat, lng: home.lng }

    const cached = inferredCache.get(patientUid)
    if (cached && cached.expiresAt > Date.now()) return cached.home
    const snap = await db.collection('memos')
      .where('patientUid', '==', patientUid)
      .orderBy('takenAt', 'desc')
      .limit(INFER_SAMPLE)
      .select('lat', 'lng')
      .get()
    const points = snap.docs
      .map((d) => d.data())
      .filter((m) => typeof m.lat === 'number' && typeof m.lng === 'number')
      .map((m) => ({ lat: m.lat as number, lng: m.lng as number }))
    const inferred = inferHome(points)
    inferredCache.set(patientUid, { home: inferred, expiresAt: Date.now() + CACHE_MS })
    return inferred
  } catch (err) {
    // Travel context is a nicety; never fail a memo over it.
    logger.warn('[travel] could not resolve home', { patientUid, err: String(err) })
    return null
  }
}

/** Distance-from-home hint for the prompt; undefined when either end is unknown. */
export async function homeHintFor(
  patientUid: string,
  lat: number | null,
  lng: number | null,
): Promise<{ km: number; away: boolean } | undefined> {
  if (lat == null || lng == null) return undefined
  const home = await resolveHome(patientUid)
  if (!home) return undefined
  const km = distanceKm(home, { lat, lng })
  return { km: km < 10 ? Math.round(km) : Math.round(km / 10) * 10, away: km >= AWAY_KM }
}
