// Paying for a plan in the store app: Apple and Google require their own
// in-app billing for subscriptions, so the purchase runs through RevenueCat's
// plugin (one SDK for both stores). The family member who pays is the
// RevenueCat user; the plan still lands on the parent's account, written by
// the worker after it has checked the purchase with RevenueCat
// (worker/src/payments/revenuecat.ts). On the website, and while the
// `payments` flag is off, nothing is charged: the stand-in hands back no
// token and the worker's stand-in approves the change.

import { Capacitor } from '@capacitor/core'
import { Purchases, PURCHASES_ERROR_CODE } from '@revenuecat/purchases-capacitor'
import type { Plans, PlanTier } from '../types'

export interface Checkout {
  provider: string
  /** What the worker verifies with the payment company; null with the stand-in. */
  token: string | null
}

/** The store products, one monthly subscription per paid tier. */
export const STORE_PRODUCT: Record<Exclude<PlanTier, 'free'>, string> = {
  basic: 'daylie_basic_monthly',
  plus: 'daylie_plus_monthly',
  family: 'daylie_family_monthly',
}
const TIER_OF_PRODUCT = Object.fromEntries(Object.entries(STORE_PRODUCT).map(([t, p]) => [p, t])) as Record<string, PlanTier>

/** The store product id without Play's base plan: Android reports a
 *  subscription as `daylie_basic_monthly:<base plan>`, iOS as the bare id. */
export function baseProductId(identifier: string): string {
  return identifier.split(':')[0]
}

/** The store's public SDK key for this phone (simple/app/.env.simple); none on the web. */
function apiKey(): string | undefined {
  const platform = Capacitor.getPlatform()
  const key = platform === 'ios' ? import.meta.env.VITE_REVENUECAT_APPLE_KEY : platform === 'android' ? import.meta.env.VITE_REVENUECAT_GOOGLE_KEY : undefined
  return typeof key === 'string' && key ? key : undefined
}

/** The store can take money here: the phone app, with its key, once the
 *  `payments` flag is on. Elsewhere the sheet changes nothing for money. */
export function paymentsLive(plans: Plans | null): boolean {
  return Capacitor.isNativePlatform() && !!apiKey() && plans?.flags?.payments === true
}

/** The website (or a build without keys) while payments are on: the sheet
 *  says subscriptions happen in the app instead of offering to buy. */
export function paymentsElsewhere(plans: Plans | null): boolean {
  return plans?.flags?.payments === true && !paymentsLive(plans)
}

let configuredFor: string | null = null

/** Once per sign-in: RevenueCat knows this family member by their uid, so a
 *  purchase can be matched to them on the worker. Safe to call again. */
export async function configurePayments(uid: string): Promise<void> {
  const key = apiKey()
  if (!Capacitor.isNativePlatform() || !key || configuredFor === uid) return
  try {
    if (configuredFor) await Purchases.logIn({ appUserID: uid })
    else await Purchases.configure({ apiKey: key, appUserID: uid })
    configuredFor = uid
  } catch (err) {
    console.warn('[payments] not configured', err)
  }
}

/** The store's own price for each paid tier ("₩4,900/월" as the store writes
 *  it), from the current offering. Empty when the store has nothing to say. */
export async function storePrices(): Promise<Partial<Record<PlanTier, string>>> {
  if (!configuredFor) return {}
  try {
    const { current } = await Purchases.getOfferings()
    const out: Partial<Record<PlanTier, string>> = {}
    for (const p of current?.availablePackages ?? []) {
      const tier = TIER_OF_PRODUCT[baseProductId(p.product.identifier)]
      if (tier) out[tier] = `${p.product.priceString}/월`
    }
    return out
  } catch (err) {
    console.warn('[payments] no store prices', err)
    return {}
  }
}

/** The person closed the store's sheet without paying. Not an error to show. */
export class PurchaseCancelled extends Error {
  constructor() { super('purchase cancelled') }
}

/**
 * Start the payment for a plan. Live: the store's purchase sheet for the
 * tier's product, then the token the worker verifies (the payer's uid, which
 * the worker ignores in favour of the signed-in caller). Free, or not live:
 * the stand-in.
 */
export async function startCheckout(order: { patientUid: string; tier: PlanTier }, live = false): Promise<Checkout> {
  if (!live || order.tier === 'free' || !configuredFor) return { provider: 'stub', token: null }
  const product = STORE_PRODUCT[order.tier]
  const { current } = await Purchases.getOfferings()
  const pkg = current?.availablePackages.find((p) => baseProductId(p.product.identifier) === product)
  if (!pkg) throw new Error(`no store product for ${order.tier}`)
  try {
    await Purchases.purchasePackage({ aPackage: pkg })
  } catch (err) {
    if ((err as { code?: string })?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) throw new PurchaseCancelled()
    throw err
  }
  return { provider: 'revenuecat', token: configuredFor }
}

/** 구매 복원: the store's record of this person's subscriptions. The highest
 *  paid tier that is active, or null when there is none. */
export async function restorePurchases(): Promise<{ tier: PlanTier | null; token: string | null }> {
  if (!configuredFor) return { tier: null, token: null }
  const { customerInfo } = await Purchases.restorePurchases()
  const active = Object.keys(customerInfo.entitlements.active)
  const order: PlanTier[] = ['family', 'plus', 'basic']
  const tier = order.find((t) => active.includes(t)) ?? null
  return { tier, token: tier ? configuredFor : null }
}

/** The store's page for this person's subscriptions (구독 관리), or null. */
export async function managementUrl(): Promise<string | null> {
  if (!configuredFor) return null
  try {
    return (await Purchases.getCustomerInfo()).customerInfo.managementURL ?? null
  } catch {
    return null
  }
}
