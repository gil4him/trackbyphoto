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
 * Going back to Free deletes nothing of the family's: Free simply keeps
 * less, and retention.ts gives its own week of notice before anything goes.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { lookupSubscriber, entitlementActive, type SubscriberState } from '../payments/revenuecat.js'
import type { PlanTier } from '../plans.js'

/** Often enough that a cancelled plan ends the same day, rarely enough to
 *  stay far inside RevenueCat's rate limits. */
const POLL_EVERY_MS = 6 * 3600 * 1000
/** A restart loop must not hammer the API. */
const FIRST_POLL_MS = 2 * 60 * 1000

export interface SubscriptionDeps {
  /** Null when the store gave no answer about this payer. */
  lookup: (payerUid: string) => Promise<SubscriberState | null>
  now?: () => Date
}

export const defaultSubscriptionDeps: SubscriptionDeps = {
  lookup: (payerUid) => lookupSubscriber(payerUid),
}

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
      if (!(await userRef.get()).exists) {
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
        await userRef.update({ 'plan.status': status, 'plan.payment.expiresAt': expiresAt })
        await row.ref.set({ expiresAt, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
        if (status === 'grace') result.graced++
        else result.renewed++
        continue
      }

      await db.runTransaction(async (tx) => {
        const fresh = (await tx.get(userRef)).data()
        if (!fresh) {
          tx.delete(row.ref)
          return
        }
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
          details: { from: tier, to: 'free', provider: 'revenuecat', source: 'subscription', refunded: !!ent?.refunded },
          timestamp: FieldValue.serverTimestamp(),
        })
      })
      result.ended++
      logger.info('[subscriptions] a subscription ended; back to Free', { payerUid, patientUid, from: tier, refunded: !!ent?.refunded })
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
