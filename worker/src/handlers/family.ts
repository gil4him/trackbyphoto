/**
 * How many family members share a parent's day is part of the plan.
 *
 *   - An invite past the plan's count is refused with `plan-limit`, carrying
 *     the next plan that has room, so the app can open the plan sheet.
 *     Family who already joined are never removed, whatever the plan.
 *   - Two weeks after a parent's first digest, a family member who is still
 *     the only one gets a single "언니·오빠도 함께 받아보세요".
 *
 * Both apply only while the `planSheet` flag is on.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { WorkerError } from '../context.js'
import { PLAN_TIERS, getPlans, tierOf, type PlansDoc, type PlanTier } from '../plans.js'

const DAY_MS = 24 * 3600 * 1000
export const INVITE_PROMPT_AFTER_DAYS = 14
export const INVITE_PROMPT_MESSAGE = '언니·오빠도 함께 받아보세요'

/** Active family members of a parent (the parent's own row, if any, doesn't count). */
async function activeFamily(patientUid: string): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const snap = await getFirestore().collection('memberships')
    .where('patientUid', '==', patientUid)
    .where('status', '==', 'active')
    .get()
  return snap.docs.filter((m) => m.get('caregiverUid') !== patientUid)
}

/** The first plan above `tier` that lets more than `count` family members in. */
export function nextTierWithRoom(plans: PlansDoc, tier: PlanTier, count: number): PlanTier | null {
  return PLAN_TIERS.slice(PLAN_TIERS.indexOf(tier) + 1)
    .find((t) => typeof plans[t]?.familyMembers === 'number' && plans[t].familyMembers > count) ?? null
}

/**
 * Throws `plan-limit` when the parent's plan has no room for one more family
 * member. Does nothing while plan limits aren't switched on, or when the
 * plans table has no count for the tier.
 */
export async function assertFamilyRoom(patientUid: string): Promise<void> {
  const plans = await getPlans()
  if (plans?.flags?.planSheet !== true) return
  const tier = tierOf((await getFirestore().doc(`users/${patientUid}`).get()).data())
  const limit = plans[tier]?.familyMembers
  if (typeof limit !== 'number') return
  const count = (await activeFamily(patientUid)).length
  if (count < limit) return
  throw new WorkerError('plan-limit', `this plan shares with ${limit} family member(s)`, {
    limit,
    tier,
    nextTier: nextTierWithRoom(plans, tier, count),
  })
}

/**
 * Called after a parent's digest exists for the day. Notes when the first
 * one was, and two weeks later, on the starting plan with one family member,
 * suggests inviting a sibling. Once per parent. Returns how many were told.
 */
export async function invitePrompt(a: { patientUid: string; plans: PlansDoc; tier: PlanTier; now: Date }): Promise<number> {
  const db = getFirestore()
  // Worker-only state; no client can read or write users/{uid}/private.
  const stateRef = db.doc(`users/${a.patientUid}/private/family`)
  const state = (await stateRef.get()).data()
  const firstDigestAt = (state?.firstDigestAt as Timestamp | undefined)?.toMillis()
  if (!firstDigestAt) {
    await stateRef.set({ firstDigestAt: Timestamp.fromDate(a.now) }, { merge: true })
    return 0
  }
  if (state?.invitePromptAt) return 0
  if (a.plans.flags?.planSheet !== true || a.tier !== PLAN_TIERS[0]) return 0
  if (a.now.getTime() - firstDigestAt < INVITE_PROMPT_AFTER_DAYS * DAY_MS) return 0

  const family = await activeFamily(a.patientUid)
  let told = 0
  // Only someone who can invite, and only while they are the only one.
  if (family.length === 1 && ['admin', 'guardian'].includes(family[0].get('role') as string)) {
    const recipientUid = family[0].get('caregiverUid') as string
    try {
      await db.doc(`notifications/invite_prompt_${a.patientUid}_${recipientUid}`).create({
        recipientUid,
        patientUid: a.patientUid,
        actorUid: 'worker',
        type: 'family.invite_prompt',
        message: INVITE_PROMPT_MESSAGE,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      })
      told = 1
    } catch (err) {
      if ((err as { code?: number }).code !== 6) throw err // 6 = already exists
    }
  }
  await stateRef.set({ invitePromptAt: Timestamp.fromDate(a.now) }, { merge: true })
  return told
}
