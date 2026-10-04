/**
 * Fill in a memo's place after the fact.
 *
 * A memo carries `needsGeocode: true` when its coordinates still have to be
 * turned into a place name:
 *   - the phone found its location only after the memo was uploaded and
 *     attached lat/lng late (weak GPS indoors, abroad, on a train), or
 *   - the geocoder didn't answer while the memo was being written.
 *
 * When a late location shows the photo was taken far from home, the memo is
 * put back in the queue so the model can write it again knowing the place.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { reverseGeocode, type GeoResult } from '../geocode.js'
import { homeHintFor } from '../travel.js'

const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000]

export type LocateOutcome = 'done' | 'retry'

export async function locateMemo(
  memoId: string,
  geocode: (lat: number | null, lng: number | null) => Promise<GeoResult> = reverseGeocode,
): Promise<LocateOutcome> {
  const ref = getFirestore().collection('memos').doc(memoId)
  const data = (await ref.get()).data()
  if (!data || data.needsGeocode !== true) return 'done'

  const lat = typeof data.lat === 'number' ? data.lat : null
  const lng = typeof data.lng === 'number' ? data.lng : null
  if (lat == null || lng == null) {
    await ref.update({ needsGeocode: FieldValue.delete() })
    return 'done'
  }

  const { place, address } = await geocode(lat, lng)
  if (!place && !address) return 'retry'

  const update: Record<string, unknown> = { place, address, needsGeocode: FieldValue.delete() }
  // The memo was written without knowing where the photo was taken. If that
  // turns out to be far from home, have it written again with the place.
  const writtenBlind = data.status === 'ready' && !data.place && data.memoSource === 'local-llm' && data.humanEdited !== true
  if (writtenBlind && (await homeHintFor(data.patientUid as string, lat, lng))?.away) update.status = 'pending'
  await ref.update(update)
  logger.info('[place] located', { memoId, place, rewrite: update.status === 'pending' })
  return 'done'
}

/** Subscribe to memos waiting for a place. Lookups run one at a time
 *  (Nominatim allows one request a second) and back off on failure. */
export function watchGeocodeRequests(): () => void {
  const attempts = new Map<string, number>()
  const timers = new Map<string, NodeJS.Timeout>()
  let chain: Promise<void> = Promise.resolve()

  const run = (memoId: string) => {
    chain = chain.then(async () => {
      const attempt = attempts.get(memoId) ?? 0
      let outcome: LocateOutcome
      try {
        outcome = await locateMemo(memoId)
      } catch (err) {
        logger.warn('[place] lookup threw', { memoId, err: String(err) })
        outcome = 'retry'
      }
      if (outcome === 'done') { attempts.delete(memoId); return }
      if (attempt >= RETRY_DELAYS_MS.length) {
        // Leave the flag set: the next worker start tries again.
        logger.warn('[place] giving up for now', { memoId })
        attempts.delete(memoId)
        return
      }
      attempts.set(memoId, attempt + 1)
      timers.set(memoId, setTimeout(() => { timers.delete(memoId); run(memoId) }, RETRY_DELAYS_MS[attempt]))
    })
  }

  const unsub = getFirestore()
    .collection('memos')
    .where('needsGeocode', '==', true)
    .onSnapshot(
      (snap) => {
        for (const change of snap.docChanges()) {
          const id = change.doc.id
          if (change.type === 'removed') {
            const t = timers.get(id)
            if (t) clearTimeout(t)
            timers.delete(id)
            attempts.delete(id)
          } else if (change.type === 'added') {
            run(id)
          }
        }
      },
      (err) => {
        logger.error('[place] listener died; exiting so launchd restarts us', { err: String(err) })
        process.exit(1)
      },
    )
  return () => {
    unsub()
    for (const t of timers.values()) clearTimeout(t)
  }
}
