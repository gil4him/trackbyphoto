/**
 * Invisible daily limits (runs inside the memo pipeline, before the model).
 *
 * Photos are unlimited on every plan: the shutter never refuses and nothing
 * here tells anyone about volume. What a plan limits is how many photos a day
 * get a memo written by the model. Past that (the Free allowance, or the
 * fair-use ceiling on any plan) a photo takes the stored-only path: it is
 * still placed, marked ready and sent to the family, with a plain memo and no
 * model call.
 *
 * Counters live on users/{uid}.dayCounters.{YYYYMMDD} = { photos, aiPhotos },
 * a field only the worker writes, keyed by the day on the parent's own clock.
 * Each memo carries `usage: { day, ai }` so a retry or a worker restart never
 * counts the same photo twice.
 *
 * Counting always runs (the numbers are for monitoring); the limits only
 * apply while the `usageCaps` flag is on.
 */

import { getFirestore } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { getPlans, tierOf, type PlansDoc, type PlanTier } from '../plans.js'
import { localOffsetMin } from '../travel.js'

/** Days of counters kept on the users doc. */
export const KEEP_DAYS = 7

const DAY_MS = 24 * 3600 * 1000

export interface DayCount { photos?: number; aiPhotos?: number }
export interface MemoUsage { day: string; ai: boolean }

/** YYYYMMDD on a clock `offsetMin` minutes ahead of UTC. */
export function dayKey(at: Date, offsetMin: number): string {
  return new Date(at.getTime() + offsetMin * 60_000).toISOString().slice(0, 10).replace(/-/g, '')
}

/**
 * Whether the model writes this photo's memo. `photos` already includes this
 * photo; `aiPhotos` is how many memos the model wrote earlier that day.
 */
export function allowAi(plans: PlansDoc | null, tier: PlanTier, photos: number, aiPhotos: number): boolean {
  if (plans?.flags?.usageCaps !== true) return true
  const ceiling = plans.fairUse?.photosPerDay
  if (typeof ceiling === 'number' && photos > ceiling) return false
  const allowance = plans[tier]?.aiPhotosPerDay
  if (typeof allowance === 'number' && aiPhotos >= allowance) return false
  return true
}

export interface PhotoToCount {
  memoId: string
  patientUid: string
  takenAt?: Date
  lat: number | null
  lng: number | null
  tzOffsetMin?: number | null
  /** The memo was finished before and is being written again. */
  rewrite: boolean
}

/**
 * Count the photo and decide its path. A memo that was already counted keeps
 * its decision, except a stored-only memo that someone asks to re-write: that
 * is decided again against today's allowance (a family that has since moved
 * to a paid plan gets the real memo) without counting the photo twice.
 */
export async function accountPhoto(photo: PhotoToCount, now: Date = new Date()): Promise<MemoUsage> {
  const db = getFirestore()
  const plans = await getPlans()
  const offsetMin = await localOffsetMin(photo.patientUid, photo.lat, photo.lng, photo.tzOffsetMin)
  const today = dayKey(now, offsetMin)
  const oldest = dayKey(new Date(now.getTime() - (KEEP_DAYS - 1) * DAY_MS), offsetMin)
  // A photo taken offline counts on the day it was taken, within the days kept.
  const taken = photo.takenAt ? dayKey(photo.takenAt, offsetMin) : today
  const takenDay = taken < oldest || taken > today ? today : taken

  const memoRef = db.collection('memos').doc(photo.memoId)
  const userRef = db.collection('users').doc(photo.patientUid)
  return db.runTransaction(async (tx) => {
    const [memoSnap, userSnap] = await Promise.all([tx.get(memoRef), tx.get(userRef)])
    const prior = memoSnap.data()?.usage as MemoUsage | undefined
    const redecide = photo.rewrite && prior?.ai === false
    if (prior && !redecide) return prior
    // Written before these counters existed: nothing to count, just write it.
    if (photo.rewrite && !prior) return { day: today, ai: true }
    if (!memoSnap.exists || !userSnap.exists) return { day: today, ai: true }

    const day = redecide ? today : takenDay
    const counters = (userSnap.data()?.dayCounters ?? {}) as Record<string, DayCount>
    const photos = (counters[day]?.photos ?? 0) + (redecide ? 0 : 1)
    const aiBefore = counters[day]?.aiPhotos ?? 0
    const ai = allowAi(plans, tierOf(userSnap.data()), photos, aiBefore)

    const kept = Object.fromEntries(Object.entries(counters).filter(([k]) => k >= oldest))
    kept[day] = { photos, aiPhotos: aiBefore + (ai ? 1 : 0) }
    const usage: MemoUsage = { day, ai }
    tx.update(userRef, { dayCounters: kept })
    tx.update(memoRef, { usage })
    return usage
  })
}

/** Counting must never cost the parent a photo: on any failure, write the memo. */
export async function accountPhotoSafely(photo: PhotoToCount): Promise<MemoUsage> {
  try {
    return await accountPhoto(photo)
  } catch (err) {
    logger.warn('[usage] could not count the photo; writing the memo anyway', { memoId: photo.memoId, err: String(err) })
    return { day: '', ai: true }
  }
}
