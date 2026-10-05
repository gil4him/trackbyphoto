/**
 * Nightly retention: how long memories are kept is part of the plan.
 *
 * For each patient on a plan with a retention period, photos and their memos
 * older than that period are deleted. Hearts, comments, voice replies and
 * their transcripts are never deleted. A week before photos go, each family
 * member gets one `retention.expiring` notice (at most one a week); the
 * parent is never told.
 *
 * Deleting can't be undone, so the job is careful about who it touches:
 *   - it only runs while the `retentionJob` flag is on,
 *   - only patients whose tier was set explicitly are included; an account
 *     that nobody has put on a plan keeps everything,
 *   - nothing is deleted for a patient until a week after the job first ran
 *     (or a week after their plan last changed), so the notice always comes
 *     first,
 *   - a retention period shorter than a week is treated as a mistake in
 *     admin_config/plans and skipped.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { logger } from '../log.js'
import { PLAN_TIERS, getPlans, type PlansDoc, type PlanTier } from '../plans.js'

const DAY_MS = 24 * 3600 * 1000
/** How far ahead the family is told, and the grace before the first delete. */
export const NOTICE_DAYS = 7
const MIN_RETENTION_DAYS = 7
const PAGE = 300
/** The job was off this long: start the grace period again. */
const PAUSED_MS = NOTICE_DAYS * DAY_MS
const RUN_EVERY_MS = 23 * 3600 * 1000
const CHECK_EVERY_MS = 3600 * 1000
const FIRST_CHECK_MS = 5 * 60 * 1000

const TIER_LABEL: Record<PlanTier, string> = { free: 'Free', basic: 'Basic으로', plus: 'Plus로', family: 'Family로' }

export interface RetentionDeps {
  /** Remove the photo from Storage; a photo that is already gone is fine. */
  deletePhoto: (photoPath: string) => Promise<void>
}

export const defaultRetentionDeps: RetentionDeps = {
  deletePhoto: async (photoPath) => {
    await getStorage().bucket().file(photoPath).delete({ ignoreNotFound: true })
  },
}

export interface RetentionResult { patients: number; deleted: number; notices: number }

const validDays = (days: unknown): days is number =>
  typeof days === 'number' && Number.isFinite(days) && days >= MIN_RETENTION_DAYS

function keptFor(days: number | null): string {
  if (days == null) return '평생'
  return days % 365 === 0 ? `${days / 365}년 동안` : `${days}일 동안`
}

/** How many photos go this week, and what the next plan up would keep. */
export function expiringMessage(plans: PlansDoc, tier: PlanTier, count: number): string {
  const head = `이번 주에 사진 ${count}장이 지워져요.`
  const mine = plans[tier]?.retentionDays
  const next = PLAN_TIERS.slice(PLAN_TIERS.indexOf(tier) + 1).find((t) => {
    const days = plans[t]?.retentionDays
    return days === null || (validDays(days) && typeof mine === 'number' && days > mine)
  })
  return next ? `${head} ${TIER_LABEL[next]} 바꾸면 ${keptFor(plans[next]?.retentionDays ?? null)} 보관해요.` : head
}

/**
 * One pass over every patient on a plan. Returns null when the job is
 * switched off.
 */
export async function runRetention(now: Date = new Date(), deps: RetentionDeps = defaultRetentionDeps): Promise<RetentionResult | null> {
  const plans = await getPlans()
  if (plans?.flags?.retentionJob !== true) return null
  const db = getFirestore()

  const stateRef = db.doc('admin_config/retention')
  const state = (await stateRef.get()).data()
  const lastRunAt = (state?.lastRunAt as Timestamp | undefined)?.toDate()
  let startedAt = (state?.startedAt as Timestamp | undefined)?.toDate()
  if (!startedAt || (lastRunAt && now.getTime() - lastRunAt.getTime() > PAUSED_MS)) startedAt = now

  const result: RetentionResult = { patients: 0, deleted: 0, notices: 0 }
  for (const tier of PLAN_TIERS) {
    const days = plans[tier]?.retentionDays
    if (days == null) continue
    if (!validDays(days)) {
      logger.error('[retention] retentionDays is not a number of days of a week or more; skipping the tier', { tier, days })
      continue
    }
    const patients = await db.collection('users').where('plan.tier', '==', tier).get()
    for (const patient of patients.docs) {
      try {
        const since = (patient.get('plan.since') as Timestamp | undefined)?.toDate() ?? startedAt
        const graceUntil = Math.max(startedAt.getTime(), since.getTime()) + NOTICE_DAYS * DAY_MS
        const one = await sweepPatient(patient.id, tier, days, now, now.getTime() >= graceUntil, plans, deps)
        result.patients++
        result.deleted += one.deleted
        result.notices += one.notices
      } catch (err) {
        logger.error('[retention] patient failed; continuing with the rest', { patientUid: patient.id, err: String(err) })
      }
    }
  }

  await stateRef.set({
    startedAt: Timestamp.fromDate(startedAt),
    lastRunAt: Timestamp.fromDate(now),
    lastRun: result,
  }, { merge: true })
  if (result.deleted) {
    const day = now.toISOString().slice(0, 10)
    await db.collection('admin_daily').doc(day).set({ date: day, retentionDeleted: FieldValue.increment(result.deleted) }, { merge: true })
  }
  logger.info('[retention] done', { ...result })
  return result
}

async function sweepPatient(
  patientUid: string,
  tier: PlanTier,
  days: number,
  now: Date,
  mayDelete: boolean,
  plans: PlansDoc,
  deps: RetentionDeps,
): Promise<{ deleted: number; notices: number }> {
  const db = getFirestore()
  const deleteBefore = now.getTime() - days * DAY_MS
  const noticeBefore = deleteBefore + NOTICE_DAYS * DAY_MS

  // Everything that is gone, or will be, within the notice period.
  let deleted = 0
  let expiring = 0
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null
  for (;;) {
    let q = db.collection('memos')
      .where('patientUid', '==', patientUid)
      .where('takenAt', '<', Timestamp.fromMillis(noticeBefore))
      .orderBy('takenAt', 'desc')
      .limit(PAGE)
    if (cursor) q = q.startAfter(cursor)
    const page = await q.get()
    for (const memo of page.docs) {
      const takenAt = (memo.get('takenAt') as Timestamp).toMillis()
      if (!mayDelete || takenAt >= deleteBefore) {
        expiring++
        continue
      }
      // Photo first: if the memo went first and this failed, the file would
      // be orphaned; this way a failure is simply retried tomorrow night.
      const photoPath = memo.get('photoPath') as string | undefined
      if (photoPath?.startsWith(`photos/${patientUid}/`)) await deps.deletePhoto(photoPath)
      await memo.ref.delete()
      deleted++
    }
    if (page.size < PAGE) break
    cursor = page.docs[page.docs.length - 1]
  }

  if (deleted) {
    await db.collection('auditLogs').add({
      patientUid,
      actorUid: 'worker',
      action: 'retention.delete',
      details: { count: deleted, tier, retentionDays: days },
      timestamp: FieldValue.serverTimestamp(),
    })
  }

  let notices = 0
  // On whatever plan: a family is always told before kept photos go.
  if (expiring > 0) {
    notices = await tellFamily(patientUid, expiringMessage(plans, tier, expiring), now)
  }
  return { deleted, notices }
}

/** One notice per family member per week. Never to the parent. */
async function tellFamily(patientUid: string, message: string, now: Date): Promise<number> {
  const db = getFirestore()
  const family = await db.collection('memberships')
    .where('patientUid', '==', patientUid)
    .where('status', '==', 'active')
    .get()
  const weekAgo = Timestamp.fromMillis(now.getTime() - NOTICE_DAYS * DAY_MS)
  let sent = 0
  for (const member of family.docs) {
    const recipientUid = member.get('caregiverUid') as string
    if (!recipientUid || recipientUid === patientUid) continue
    const recent = await db.collection('notifications')
      .where('recipientUid', '==', recipientUid)
      .where('createdAt', '>', weekAgo)
      .orderBy('createdAt', 'desc')
      .get()
    if (recent.docs.some((n) => n.get('type') === 'retention.expiring' && n.get('patientUid') === patientUid)) continue
    await db.collection('notifications').add({
      recipientUid,
      patientUid,
      actorUid: 'worker',
      type: 'retention.expiring',
      message,
      read: false,
      createdAt: Timestamp.fromDate(now),
    })
    sent++
  }
  return sent
}

/**
 * Run the job about once a day while the worker is up. The first check comes
 * a few minutes after start, so a restart loop can't repeat it.
 */
export function startRetention(): () => void {
  const check = async () => {
    try {
      const plans = await getPlans()
      if (plans?.flags?.retentionJob !== true) return
      const lastRunAt = ((await getFirestore().doc('admin_config/retention').get()).get('lastRunAt') as Timestamp | undefined)?.toMillis() ?? 0
      if (Date.now() - lastRunAt < RUN_EVERY_MS) return
      await runRetention()
    } catch (err) {
      logger.error('[retention] run failed', { err: String(err) })
    }
  }
  const first = setTimeout(() => void check(), FIRST_CHECK_MS)
  const timer = setInterval(() => void check(), CHECK_EVERY_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
