/**
 * changePlan: a family member puts a parent on a plan.
 *
 * The plan lives on the parent's own account (users/{patientUid}.plan) and
 * is written only here; rules keep every client from touching it. Whoever
 * manages the parent's records (the account's own owner, a guardian or an
 * admin family member) may change it; the plan records who did.
 *
 * Paying goes through payments/ (a stand-in today, so nothing is charged).
 *
 * The parent is never told: no notice goes to their phone, and their
 * screens are the same on every plan. The family is told one thing, once:
 * when a plan that includes voice replies is chosen and the parent had
 * already left some, "지난 음성 답장 n개가 열렸어요".
 *
 * Plan changes are open only while the `planSheet` flag is on.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { WorkerError, type Caller } from '../context.js'
import { paymentProvider, type PaymentProvider } from '../payments/index.js'
import { PLAN_TIERS, explicitTier, getPlans, tierOf, type PlanTier } from '../plans.js'
import { isOwnerOrAdminCaregiver } from './caregiver.js'

/** Where on the app the change was made: the sheet's four doors. Kept on the
 *  audit entry so the upgrade moments can be compared. */
const SOURCES = ['settings', 'family', 'voice', 'retention'] as const

export interface PlanDeps {
  payments: PaymentProvider
}

export interface ChangePlanResult {
  tier: PlanTier
  changed: boolean
  /** Voice replies the family can now hear (0 when none were waiting). */
  unlockedVoices: number
}

export async function changePlan(
  caller: Caller,
  data: { patientUid?: unknown; tier?: unknown; paymentToken?: unknown; source?: unknown },
  deps: PlanDeps = { payments: paymentProvider() },
): Promise<ChangePlanResult> {
  const patientUid = typeof data?.patientUid === 'string' ? data.patientUid : ''
  const tier = data?.tier as PlanTier
  if (!caller.uid || !patientUid) throw new WorkerError('invalid-argument', 'patientUid required')
  if (!PLAN_TIERS.includes(tier)) throw new WorkerError('invalid-argument', `tier must be one of ${PLAN_TIERS.join(', ')}`)
  const source = SOURCES.find((s) => s === data.source) ?? 'unknown'

  const plans = await getPlans()
  if (plans?.flags?.planSheet !== true) throw new WorkerError('failed-precondition', 'plan changes are not open yet')
  if (!plans[tier]) throw new WorkerError('failed-precondition', `no such plan: ${tier}`)
  if (!(await isOwnerOrAdminCaregiver(caller.uid, patientUid))) {
    throw new WorkerError('permission-denied', 'only whoever manages these records can change the plan')
  }

  const db = getFirestore()
  const userRef = db.doc(`users/${patientUid}`)
  const before = (await userRef.get()).data()
  if (!before) throw new WorkerError('not-found', 'no such account')
  if (explicitTier(before) === tier) return { tier, changed: false, unlockedVoices: 0 }
  const from = tierOf(before)

  const paid = await deps.payments.confirm({
    payerUid: caller.uid,
    patientUid,
    from,
    to: tier,
    token: typeof data.paymentToken === 'string' ? data.paymentToken : null,
  })
  if (!paid.ok) throw new WorkerError('payment-failed', paid.reason || 'the payment did not go through')

  const changed = await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(userRef)).data()
    if (!fresh) throw new WorkerError('not-found', 'no such account')
    // Two taps, or two family members at once: the second finds it done.
    if (explicitTier(fresh) === tier) return false
    tx.update(userRef, {
      plan: {
        tier,
        status: 'active',
        // Retention counts its week of notice from here.
        since: FieldValue.serverTimestamp(),
        changedBy: caller.uid,
        payment: { provider: paid.provider, ...(paid.reference ? { reference: paid.reference } : {}) },
      },
    })
    tx.set(db.collection('auditLogs').doc(), {
      patientUid,
      actorUid: caller.uid,
      action: 'plan.change',
      details: { from, to: tier, provider: paid.provider, source },
      timestamp: FieldValue.serverTimestamp(),
    })
    return true
  })
  if (!changed) return { tier, changed: false, unlockedVoices: 0 }

  let unlockedVoices = 0
  if (plans.flags.voiceReplies === true && plans[tier].voiceReplies === true && plans[from]?.voiceReplies !== true) {
    unlockedVoices = await announceUnlockedVoices(patientUid, (before.patientName as string) || '부모님', caller.uid)
  }
  logger.info('[plan] changed', { patientUid, from, to: tier, by: caller.uid, provider: paid.provider, source, unlockedVoices })
  return { tier, changed: true, unlockedVoices }
}

/**
 * Tell each family member, once ever, that the parent's earlier voice
 * replies can now be heard. Returns how many replies there are (0: nothing
 * to announce).
 */
async function announceUnlockedVoices(patientUid: string, patientName: string, actorUid: string): Promise<number> {
  const db = getFirestore()
  const replies = await db.collection('reactions').where('patientUid', '==', patientUid).get()
  const voices = replies.docs.filter((r) => r.get('actorUid') === patientUid && r.get('kind') === 'voice' && r.get('status') === 'ready').length
  if (voices === 0) return 0

  const family = await db.collection('memberships')
    .where('patientUid', '==', patientUid)
    .where('status', '==', 'active')
    .get()
  for (const member of family.docs) {
    const recipientUid = member.get('caregiverUid') as string
    if (!recipientUid || recipientUid === patientUid) continue
    try {
      // The id makes it once per person, however often the plan changes.
      await db.doc(`notifications/voice_unlocked_${patientUid}_${recipientUid}`).create({
        recipientUid,
        patientUid,
        actorUid,
        type: 'voice.unlocked',
        message: `${patientName}님의 지난 음성 답장 ${voices}개가 열렸어요`,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      })
    } catch (err) {
      if ((err as { code?: number }).code !== 6) throw err // 6 = already exists
    }
  }
  return voices
}
