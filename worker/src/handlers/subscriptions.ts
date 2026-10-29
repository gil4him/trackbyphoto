/**
 * Following store subscriptions: the store, not the app, says how long a
 * paid plan lasts.
 *
 * changePlan writes planPayments/{payerUid} when a purchase goes through.
 * RevenueCat then renews it, hits a card problem, or lets it end, and tells
 * us nothing (there is no open port here for a webhook). So every few hours
 * this job asks about each payer:
 *
 *   renewed            → the expiry on the plan moves out
 *   card problem       → plan.status 'grace'; the family keeps everything
 *                        while the store retries
 *   ended or refunded  → the parent goes back to Free
 *   no answer          → nothing changes; a failed call must never take a
 *                        plan away
 *
 * A plan in the store's free trial carries periodType 'trial' and its
 * trialEndsAt. The poll follows it: the first paid period clears both and
 * writes one plan.trialConverted audit entry; with `planNudges` on, the payer
 * is reminded once in the trial's last three days and told when it ended
 * unpaid (trial.ts). The parent is never told.
 *
 * Going back to Free deletes nothing of the family's: Free simply keeps
 * less, and retention.ts gives its own week of notice before anything goes.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { lookupSubscriber, entitlementActive, type SubscriberState } from '../payments/revenuecat.js'
import type { PeriodType } from '../payments/index.js'
import { getPlans, type PlansDoc, type PlanTier } from '../plans.js'
import { pushToUsers, type PushMessage } from './push.js'
import { sendTrialNotice, TRIAL_ENDING_MS } from './trial.js'

/** Often enough that a cancelled plan ends the same day, rarely enough to
 *  stay far inside RevenueCat's rate limits. */
const POLL_EVERY_MS = 6 * 3600 * 1000
/** A restart loop must not hammer the API. */
const FIRST_POLL_MS = 2 * 60 * 1000

export interface SubscriptionDeps {
  /** Null when the store gave no answer about this payer. */
  lookup: (payerUid: string) => Promise<SubscriberState | null>
  now?: () => Date
  /** The plans table (the planNudges flag, prices); getPlans unless a test says. */
  plans?: () => Promise<PlansDoc | null>
  /** The trial reminder's push; pushToUsers unless a test says. */
  push?: (uids: string[], message: PushMessage) => Promise<unknown>
}

export const defaultSubscriptionDeps: SubscriptionDeps = {
  lookup: (payerUid) => lookupSubscriber(payerUid),
}

const msOf = (t: unknown): number | null => (t instanceof Timestamp ? t.toMillis() : null)

export interface SubscriptionPollResult {
  /** Rows looked at, answered or not. */
  checked: number
  renewed: number
  graced: number
  ended: number
}

/** One pass over every purchase on file. */
export async function pollSubscriptions(deps: SubscriptionDeps = defaultSubscriptionDeps): Promise<SubscriptionPollResult> {
  const db = getFirestore()
  const now = deps.now ? deps.now() : new Date()
  const result: SubscriptionPollResult = { checked: 0, renewed: 0, graced: 0, ended: 0 }
  const plans = await (deps.plans ?? getPlans)()
  const push = deps.push ?? pushToUsers

  const rows = await db.collection('planPayments').get()
  for (const row of rows.docs) {
    const payerUid = row.id
    const patientUid = row.get('patientUid') as string | undefined
    const tier = row.get('tier') as PlanTier | undefined
    result.checked++
    try {
      if (!patientUid || !tier) {
        logger.warn('[subscriptions] a purchase row says nothing about what it pays for; removed', { payerUid })
        await row.ref.delete()
        continue
      }
      const userRef = db.doc(`users/${patientUid}`)
      const userSnap = await userRef.get()
      if (!userSnap.exists) {
        // The parent's account went away (부모님 삭제, or straight from the
        // console). There is no plan left to keep paid.
        await row.ref.delete()
        logger.info('[subscriptions] a purchase outlived the parent account; removed', { payerUid, patientUid })
        continue
      }

      const state = await deps.lookup(payerUid)
      if (!state) {
        logger.warn('[subscriptions] no answer about a payer; the plan stays as it is', { payerUid, patientUid })
        continue
      }
      const ent = state.entitlements[tier]
      if (ent && !ent.refunded && entitlementActive(ent, now)) {
        const expiresAt = ent.expiresAt ? Timestamp.fromDate(ent.expiresAt) : null
        const status = ent.billingIssue ? 'grace' : 'active'
        const wasPeriod = (userSnap.get('plan.payment.periodType') ?? row.get('periodType') ?? null) as PeriodType | null
        // A store that did not say which period it is leaves what we recorded.
        const period = ent.periodType
          ? { periodType: ent.periodType, trialEndsAt: ent.periodType === 'trial' ? expiresAt : null }
          : null
        await userRef.update({
          'plan.status': status,
          'plan.payment.expiresAt': expiresAt,
          ...(period ? { 'plan.payment.periodType': period.periodType, 'plan.payment.trialEndsAt': period.trialEndsAt } : {}),
        })
        await row.ref.set({ expiresAt, ...(period ?? {}), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
        if (wasPeriod === 'trial' && period && period.periodType !== 'trial') {
          // The first paid period: no notice, only the record.
          await db.collection('auditLogs').add({
            patientUid,
            actorUid: payerUid,
            action: 'plan.trialConverted',
            details: { tier, periodType: period.periodType, productId: ent.productId, provider: 'revenuecat', source: 'subscription' },
            timestamp: FieldValue.serverTimestamp(),
          })
          logger.info('[subscriptions] a free trial became paid', { payerUid, patientUid, tier })
        }
        const trialEndsAtMs = period ? msOf(period.trialEndsAt) : wasPeriod === 'trial' ? msOf(userSnap.get('plan.payment.trialEndsAt')) : null
        const left = trialEndsAtMs === null ? null : trialEndsAtMs - now.getTime()
        if (trialEndsAtMs !== null && left !== null && left > 0 && left <= TRIAL_ENDING_MS) {
          await sendTrialNotice({ kind: 'plan.trialEnding', payerUid, patientUid, tier, trialEndsAtMs, plans, push })
            .catch((err) => logger.warn('[subscriptions] trial reminder failed', { payerUid, patientUid, err: String(err) }))
        }
        if (status === 'grace') result.graced++
        else result.renewed++
        continue
      }

      const refunded = !!ent?.refunded
      const trial = await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(userRef)).data()
        if (!fresh) {
          tx.delete(row.ref)
          return null
        }
        // Ended inside the free trial, never paid: what we recorded says
        // trial and the store does not say otherwise.
        const inTrial = fresh.plan?.payment?.periodType === 'trial' && (ent?.periodType ?? 'trial') === 'trial'
        tx.update(userRef, {
          plan: {
            tier: 'free',
            status: 'active',
            // Retention counts its week of notice from here.
            since: FieldValue.serverTimestamp(),
            changedBy: 'subscription',
            payment: { provider: 'revenuecat', endedFrom: tier },
          },
        })
        tx.delete(row.ref)
        tx.set(db.collection('auditLogs').doc(), {
          patientUid,
          actorUid: payerUid,
          action: 'plan.change',
          details: { from: tier, to: 'free', provider: 'revenuecat', source: 'subscription', refunded, trial: inTrial },
          timestamp: FieldValue.serverTimestamp(),
        })
        return { inTrial, endsAtMs: msOf(fresh.plan?.payment?.trialEndsAt) }
      })
      result.ended++
      logger.info('[subscriptions] a subscription ended; back to Free', { payerUid, patientUid, from: tier, refunded, trial: !!trial?.inTrial })
      if (trial?.inTrial && !refunded) {
        const trialEndsAtMs = trial.endsAtMs ?? ent?.expiresAt?.getTime() ?? now.getTime()
        await sendTrialNotice({ kind: 'plan.trialEnded', payerUid, patientUid, tier, trialEndsAtMs, plans })
          .catch((err) => logger.warn('[subscriptions] trial-ended notice failed', { payerUid, patientUid, err: String(err) }))
      }
    } catch (err) {
      logger.error('[subscriptions] a payer failed; continuing with the rest', { payerUid, err: String(err) })
    }
  }

  logger.info('[subscriptions] done', { ...result })
  return result
}

/**
 * A few minutes after start, then every six hours. Returns how to stop.
 * Only started when PAYMENT_PROVIDER names RevenueCat (index.ts).
 */
export function startSubscriptionPoll(deps: SubscriptionDeps = defaultSubscriptionDeps, intervalMs = POLL_EVERY_MS): () => void {
  const run = () => {
    pollSubscriptions(deps).catch((err) => logger.error('[subscriptions] poll failed', { err: String(err) }))
  }
  const first = setTimeout(run, FIRST_POLL_MS)
  const timer = setInterval(run, intervalMs)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
