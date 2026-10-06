/**
 * searchAddress — 설정 → 집 위치 → 주소로 찾기. The family types an address
 * or a building name; the worker looks it up (it holds the Kakao key and the
 * Nominatim User-Agent a browser can't set) and returns a few places to pick
 * from. Nothing is stored here: picking one is an ordinary settings write.
 */

import { WorkerError, type Caller } from '../context.js'
import { logger } from '../log.js'
import { searchAddress as search, type GeoCandidate } from '../geocode.js'
import { resolveGeoLang } from '../travel.js'
import { isOwnerOrAdminCaregiver } from './caregiver.js'

const QUERY_MAX = 100

export async function searchAddress(
  caller: Caller,
  payload: { query?: unknown; patientUid?: unknown },
): Promise<{ candidates: GeoCandidate[] }> {
  const query = typeof payload?.query === 'string' ? payload.query.trim() : ''
  if (!query || query.length > QUERY_MAX) throw new WorkerError('invalid-argument', `query must be 1–${QUERY_MAX} characters`)
  // Names in the language of the person whose home it is, when the caller
  // manages them; the caller's own otherwise.
  const asked = typeof payload?.patientUid === 'string' ? payload.patientUid : ''
  const patientUid = asked && (await isOwnerOrAdminCaregiver(caller.uid, asked)) ? asked : caller.uid
  try {
    return { candidates: await search(query, await resolveGeoLang(patientUid)) }
  } catch (err) {
    logger.warn('[searchAddress] lookup failed', { err: String(err) })
    throw new WorkerError('unavailable', 'address lookup failed')
  }
}
