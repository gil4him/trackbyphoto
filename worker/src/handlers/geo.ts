/**
 * searchAddress — 설정 → 집 위치 → 주소로 찾기. The family types an address
 * or a building name; the worker looks it up (it holds the Kakao key and the
 * Nominatim User-Agent a browser can't set) and returns a few places to pick
 * from. `auto` marks a search fired while typing (see geocode.ts). Nothing
 * is stored here: picking one is an ordinary settings write.
 */

import { getFirestore } from 'firebase-admin/firestore'
import { WorkerError, type Caller } from '../context.js'
import { logger } from '../log.js'
import { searchAddress as search, type GeoCandidate } from '../geocode.js'
import { resolveGeoLang, resolveHome } from '../travel.js'
import { isOwnerOrAdminCaregiver } from './caregiver.js'

const QUERY_MAX = 100

/** Where this person's most recent located photo was taken, if any. */
async function latestPhotoSpot(patientUid: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const snap = await getFirestore().collection('memos')
      .where('patientUid', '==', patientUid)
      .orderBy('takenAt', 'desc')
      .limit(10)
      .select('lat', 'lng')
      .get()
    const m = snap.docs.map((d) => d.data()).find((x) => typeof x.lat === 'number' && typeof x.lng === 'number')
    return m ? { lat: m.lat as number, lng: m.lng as number } : null
  } catch (err) {
    logger.warn('[searchAddress] no recent photo spot', { patientUid, err: String(err) })
    return null
  }
}

export async function searchAddress(
  caller: Caller,
  payload: { query?: unknown; patientUid?: unknown; auto?: unknown },
): Promise<{ candidates: GeoCandidate[] }> {
  const query = typeof payload?.query === 'string' ? payload.query.trim() : ''
  if (!query || query.length > QUERY_MAX) throw new WorkerError('invalid-argument', `query must be 1–${QUERY_MAX} characters`)
  // Names in the language of the person whose home it is, when the caller
  // manages them; the caller's own otherwise.
  const asked = typeof payload?.patientUid === 'string' ? payload.patientUid : ''
  const patientUid = asked && (await isOwnerOrAdminCaregiver(caller.uid, asked)) ? asked : caller.uid
  try {
    const auto = payload?.auto === true
    // While typing, rank places near this person's home, or failing that
    // where their latest photo was taken.
    const near = auto ? (await resolveHome(patientUid)) ?? (await latestPhotoSpot(patientUid)) : null
    return { candidates: await search(query, await resolveGeoLang(patientUid), { auto, near }) }
  } catch (err) {
    logger.warn('[searchAddress] lookup failed', { err: String(err) })
    throw new WorkerError('unavailable', 'address lookup failed')
  }
}
