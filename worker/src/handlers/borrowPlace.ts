/**
 * A photo the phone sent without a location shows the place of the same
 * person's photo taken closest in time, within an hour before or after
 * (owner decision, 2026-11-09). Most such photos were taken indoors, where the
 * phone found no fix, and people rarely move far within the hour.
 *
 * Only the place name is copied, into `memos.place`, with `placeFrom` = the
 * photo it came from. Never the coordinates (they feed 다녀온 곳, the map,
 * home detection and weather) and never the street address. The memo text is
 * not rewritten, and the memo prompt never sees a borrowed place as the
 * photo's own (memo.ts placeKnown). A real location that arrives later
 * replaces it (memo.ts / place.ts delete placeFrom). If the photo lent from is
 * deleted, the copied name stays.
 *
 * Flag `borrowPlace`: on unless admin_config/plans says false.
 */

import { getFirestore } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { getPlans } from '../plans.js'

export const BORROW_WINDOW_MS = 60 * 60_000

type Data = FirebaseFirestore.DocumentData

const hasCoords = (m: Data) => typeof m.lat === 'number' && typeof m.lng === 'number'
const takenMs = (m: Data): number | null => (m.takenAt?.toMillis?.() as number | undefined) ?? null

/** May this memo show a borrowed place? (No coordinates; no place of its own.) */
export function canBorrow(m: Data): boolean {
  return !hasCoords(m) && (!m.place || !!m.placeFrom) && m.status !== 'error' && takenMs(m) != null
}

/** May this memo lend its place? (Its own coordinates and place, settled.) */
export function canLend(m: Data): boolean {
  return hasCoords(m) && !!m.place && !m.placeFrom && m.needsGeocode !== true && takenMs(m) != null
}

/** The closest lender within the window; on equal gaps the earlier photo. */
export function pickLender(at: number, candidates: { id: string; data: Data }[]): { id: string; place: string; gapMs: number } | null {
  let best: { id: string; place: string; gapMs: number; at: number } | null = null
  for (const { id, data } of candidates) {
    if (!canLend(data)) continue
    const t = takenMs(data)!
    const gapMs = Math.abs(t - at)
    if (gapMs > BORROW_WINDOW_MS) continue
    if (!best || gapMs < best.gapMs || (gapMs === best.gapMs && t < best.at)) best = { id, place: data.place as string, gapMs, at: t }
  }
  return best && { id: best.id, place: best.place, gapMs: best.gapMs }
}

async function enabled(): Promise<boolean> {
  return (await getPlans())?.flags?.borrowPlace !== false
}

async function around(patientUid: string, at: number) {
  const snap = await getFirestore().collection('memos')
    .where('patientUid', '==', patientUid)
    .where('takenAt', '>=', new Date(at - BORROW_WINDOW_MS))
    .where('takenAt', '<=', new Date(at + BORROW_WINDOW_MS))
    .get()
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }))
}

export type BorrowOutcome = 'borrowed' | 'kept' | 'none' | 'off'

/** Give this memo the place of its closest neighbour, if it needs one. */
export async function borrowPlaceFor(memoId: string): Promise<BorrowOutcome> {
  if (!(await enabled())) return 'off'
  const db = getFirestore()
  const ref = db.collection('memos').doc(memoId)
  const data = (await ref.get()).data()
  if (!data || !canBorrow(data) || !data.patientUid) return 'none'
  const at = takenMs(data)!
  const lender = pickLender(at, (await around(data.patientUid as string, at)).filter((c) => c.id !== memoId))
  if (!lender) return 'none'
  if (data.placeFrom === lender.id && data.place === lender.place) return 'kept'
  // Re-read inside a transaction: the phone may have attached a real location meanwhile.
  const wrote = await db.runTransaction(async (tx) => {
    const now = (await tx.get(ref)).data()
    if (!now || !canBorrow(now)) return false
    tx.update(ref, { place: lender.place, placeFrom: lender.id })
    return true
  })
  if (!wrote) return 'none'
  logger.info('[place] borrowed', { memoId, from: lender.id, gapMin: Math.round(lender.gapMs / 60_000) })
  return 'borrowed'
}

/** This memo just got a real place: fill its neighbours that have none.
 *  Returns how many were filled. Never throws. */
export async function lendPlace(memoId: string): Promise<number> {
  try {
    if (!(await enabled())) return 0
    const data = (await getFirestore().collection('memos').doc(memoId).get()).data()
    if (!data || !canLend(data) || !data.patientUid) return 0
    let filled = 0
    for (const n of await around(data.patientUid as string, takenMs(data)!)) {
      if (n.id !== memoId && canBorrow(n.data) && (await borrowPlaceFor(n.id)) === 'borrowed') filled++
    }
    return filled
  } catch (err) {
    logger.warn('[place] lend failed', { memoId, err: String(err) })
    return 0
  }
}

/** Never throws; for the memo pipeline. */
export async function borrowPlaceSafely(memoId: string): Promise<void> {
  try {
    await borrowPlaceFor(memoId)
  } catch (err) {
    logger.warn('[place] borrow failed', { memoId, err: String(err) })
  }
}

/** One-off fill of existing photos (scripts/backfill-places.ts). */
export async function backfillBorrowedPlaces(opts: { sinceDays: number; patientUid?: string; apply: boolean }): Promise<{ id: string; at: number; from: string; place: string; gapMin: number }[]> {
  let q = getFirestore().collection('memos').where('takenAt', '>=', new Date(Date.now() - opts.sinceDays * 864e5))
  if (opts.patientUid) q = q.where('patientUid', '==', opts.patientUid)
  const docs = (await q.get()).docs.map((d) => ({ id: d.id, data: d.data() }))
  const out: { id: string; at: number; from: string; place: string; gapMin: number }[] = []
  for (const r of docs) {
    if (!canBorrow(r.data)) continue
    const at = takenMs(r.data)!
    const lender = pickLender(at, docs.filter((c) => c.id !== r.id && c.data.patientUid === r.data.patientUid))
    if (!lender || (r.data.placeFrom === lender.id && r.data.place === lender.place)) continue
    out.push({ id: r.id, at, from: lender.id, place: lender.place, gapMin: Math.round(lender.gapMs / 60_000) })
    if (opts.apply) await borrowPlaceFor(r.id)
  }
  return out
}
