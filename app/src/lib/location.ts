// Where the phone is, for stamping photos.
//
// One precise GPS attempt fails too often (indoors, abroad, on a train), so:
//   - warmUpLocation() starts locating as soon as the capture screen is open,
//   - findFix() asks for a precise and an approximate (Wi-Fi/cell) fix at the
//     same time and takes the precise one if it arrives in time,
//   - it keeps trying for a couple of minutes, and as a last resort uses the
//     last position the phone knew a few minutes ago.
// The caller attaches whatever comes back to the photo, even after upload.

import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'

export interface Geo { lat: number; lng: number }
interface Fix extends Geo { at: number }

const isNative = Capacitor.isNativePlatform()
const LAST_FIX_KEY = 'tbp:lastFix'
/** A fix this recent is used as-is, without asking again. */
const FRESH_MS = 2 * 60_000
/** Last resort: how old a remembered fix may be and still stamp a photo. */
const STALE_MS = 10 * 60_000
const PRECISE_WAIT_MS = 8_000
const RETRY_EVERY_MS = 15_000
const RETRY_FOR_MS = 2 * 60_000

let lastFix: Fix | null = loadLastFix()

function loadLastFix(): Fix | null {
  try {
    const f = JSON.parse(localStorage.getItem(LAST_FIX_KEY) || 'null') as Fix | null
    return f && typeof f.lat === 'number' && typeof f.lng === 'number' && typeof f.at === 'number' ? f : null
  } catch {
    return null
  }
}

function remember(geo: Geo): Geo {
  lastFix = { ...geo, at: Date.now() }
  try { localStorage.setItem(LAST_FIX_KEY, JSON.stringify(lastFix)) } catch { /* storage blocked */ }
  return geo
}

/** Forget where the phone last was (its account was deleted). */
export function forgetLastFix(): void {
  lastFix = null
  try { localStorage.removeItem(LAST_FIX_KEY) } catch { /* storage blocked */ }
}

/** One position request; null on denial, timeout or no signal. */
async function position(precise: boolean, timeoutMs: number): Promise<Geo | null> {
  // An approximate fix may be a little old; a precise one should be current.
  const options = { enableHighAccuracy: precise, timeout: timeoutMs, maximumAge: precise ? 15_000 : 5 * 60_000 }
  try {
    if (isNative) {
      const pos = await Geolocation.getCurrentPosition(options)
      return remember({ lat: pos.coords.latitude, lng: pos.coords.longitude })
    }
    if (!('geolocation' in navigator)) return null
    return await new Promise<Geo | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(remember({ lat: pos.coords.latitude, lng: pos.coords.longitude })),
        () => resolve(null),
        options,
      )
    })
  } catch {
    return null
  }
}

/** Precise if it comes within PRECISE_WAIT_MS, otherwise approximate. */
async function preciseOrApproximate(): Promise<Geo | null> {
  const approximate = position(false, PRECISE_WAIT_MS)
  return (await position(true, PRECISE_WAIT_MS)) ?? (await approximate)
}

async function alreadyAllowed(): Promise<boolean> {
  try {
    if (isNative) return (await Geolocation.checkPermissions()).location === 'granted'
    return (await navigator.permissions?.query({ name: 'geolocation' }))?.state === 'granted'
  } catch {
    return false
  }
}

/**
 * Start locating before the photo is taken, so a fix is ready at the shutter.
 * Does nothing until the user has allowed location (no surprise prompt).
 */
export function warmUpLocation(): void {
  void alreadyAllowed().then((ok) => { if (ok) void preciseOrApproximate() })
}

/** A fix from the last couple of minutes, if there is one. No waiting. */
export function recentFix(): Geo | null {
  return lastFix && Date.now() - lastFix.at <= FRESH_MS ? { lat: lastFix.lat, lng: lastFix.lng } : null
}

/**
 * Find where the phone is, trying for up to a couple of minutes. Falls back
 * to the last known position if it is at most ten minutes old. Null when
 * location is off or there is no signal at all.
 */
export async function findFix(): Promise<Geo | null> {
  const deadline = Date.now() + RETRY_FOR_MS
  for (;;) {
    const geo = await preciseOrApproximate()
    if (geo) return geo
    if (Date.now() + RETRY_EVERY_MS > deadline) break
    await new Promise((r) => setTimeout(r, RETRY_EVERY_MS))
  }
  return lastFix && Date.now() - lastFix.at <= STALE_MS ? { lat: lastFix.lat, lng: lastFix.lng } : null
}

/** A single quick attempt, for settings screens. */
export async function getGeo(): Promise<Geo | null> {
  return recentFix() ?? (await preciseOrApproximate())
}
