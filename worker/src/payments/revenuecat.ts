/**
 * RevenueCat: the App Store / Play subscription behind a paid plan.
 *
 * The family buys in the store app, RevenueCat records the purchase against
 * the paying family member's uid, and the worker asks RevenueCat what that
 * uid is entitled to. Nothing the app sends is believed: changePlan looks up
 * the caller's own uid, so a forged token buys nobody a plan.
 *
 * Entitlement ids are the tier names (basic / plus / family); Free is never
 * a store product. An entitlement counts as live until its expiry passes —
 * a cancelled subscription keeps working to the end of the month, which is
 * what the family paid for. The poll in handlers/subscriptions.ts watches
 * for the end.
 */

import { logger } from '../log.js'
import { PLAN_TIERS, type PlanTier } from '../plans.js'
import type { PaymentProvider, PaymentRequest, PaymentResult } from './index.js'

/** A tier anyone can buy. Free is never a store product. */
export type PaidTier = Exclude<PlanTier, 'free'>

/** The store product per tier, as submitted to both stores. */
export const PRODUCT_IDS: Record<PaidTier, string> = {
  basic: 'daylie_basic_monthly',
  plus: 'daylie_plus_monthly',
  family: 'daylie_family_monthly',
}

const API = 'https://api.revenuecat.com/v1/subscribers'
/** A lookup that hangs must not hold up the plan sheet. */
const TIMEOUT_MS = 10_000

export interface EntitlementState {
  /** Null means a subscription with no end (a lifetime purchase). */
  expiresAt: Date | null
  productId: string
  graceUntil?: Date | null
  /** The card was refused; the store is retrying. */
  billingIssue: boolean
  refunded: boolean
}

export interface SubscriberState {
  entitlements: Partial<Record<PlanTier, EntitlementState>>
}

const asDate = (iso: unknown): Date | null => {
  if (typeof iso !== 'string') return null
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? null : at
}

/**
 * RevenueCat's subscriber JSON, cut down to what a plan depends on. The
 * refund and billing flags live on the subscription, not the entitlement,
 * so each entitlement is paired with the product that granted it.
 */
export function toSubscriberState(json: unknown): SubscriberState {
  const subscriber = (json as { subscriber?: Record<string, Record<string, Record<string, unknown>> | undefined> })?.subscriber
  const entitlements: SubscriberState['entitlements'] = {}
  for (const tier of PLAN_TIERS) {
    if (tier === 'free') continue
    const ent = subscriber?.entitlements?.[tier]
    if (!ent) continue
    const productId = typeof ent.product_identifier === 'string' ? ent.product_identifier : PRODUCT_IDS[tier as PaidTier]
    const sub = subscriber?.subscriptions?.[productId]
    entitlements[tier] = {
      expiresAt: asDate(ent.expires_date),
      productId,
      graceUntil: asDate(ent.grace_period_expires_date),
      billingIssue: !!sub?.billing_issues_detected_at,
      refunded: !!sub?.refunded_at,
    }
  }
  return { entitlements }
}

/** Live until the expiry passes; no expiry never ends. */
export function entitlementActive(ent: EntitlementState, now: Date = new Date()): boolean {
  return ent.expiresAt === null || ent.expiresAt.getTime() > now.getTime()
}

/** Why a lookup came back empty. The three are told apart because buying
 *  and renewing answer differently: a purchase may say "not entitled", a
 *  renewal must never end a plan over a failed call. */
type LookupProblem = 'missing-key' | 'unknown-subscriber' | 'unreachable'

async function fetchSubscriber(payerUid: string, doFetch: typeof fetch): Promise<SubscriberState | LookupProblem> {
  const key = process.env.REVENUECAT_SECRET_KEY
  if (!key) return 'missing-key'
  try {
    const res = await doFetch(`${API}/${encodeURIComponent(payerUid)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status === 404) return 'unknown-subscriber'
    if (!res.ok) {
      logger.warn('[payments] revenuecat refused a lookup', { payerUid, status: res.status })
      return 'unreachable'
    }
    return toSubscriberState(await res.json())
  } catch (err) {
    logger.warn('[payments] revenuecat could not be reached', { payerUid, err: String(err) })
    return 'unreachable'
  }
}

/**
 * What RevenueCat knows about one payer. Null when it has never heard of
 * them or could not be reached: a caller must then leave whatever plan is
 * already in place alone.
 */
export async function lookupSubscriber(payerUid: string, doFetch: typeof fetch = fetch): Promise<SubscriberState | null> {
  const found = await fetchSubscriber(payerUid, doFetch)
  if (typeof found !== 'string') return found
  logger.warn('[payments] no answer about a payer', { payerUid, problem: found })
  return null
}

/**
 * Checks the store instead of charging: the purchase already happened in the
 * app. Free costs nothing and is always approved, so a family can always
 * step back down.
 */
export function revenueCatPayments(doFetch: typeof fetch = fetch): PaymentProvider {
  const provider = 'revenuecat'
  return {
    name: provider,
    confirm: async (req: PaymentRequest): Promise<PaymentResult> => {
      if (req.to === 'free') return { ok: true, provider }
      const found = await fetchSubscriber(req.payerUid, doFetch)
      if (found === 'missing-key') return { ok: false, provider, reason: 'REVENUECAT_SECRET_KEY missing' }
      if (found === 'unreachable') return { ok: false, provider, reason: 'the store could not be reached' }
      if (found === 'unknown-subscriber') return { ok: false, provider, reason: 'not entitled' }
      const ent = found.entitlements[req.to]
      if (!ent || ent.refunded || !entitlementActive(ent)) return { ok: false, provider, reason: 'not entitled' }
      return { ok: true, provider, reference: ent.productId, productId: ent.productId, expiresAt: ent.expiresAt }
    },
  }
}
