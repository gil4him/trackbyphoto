// Paying for a plan in the store app: Apple and Google require their own
// in-app billing for subscriptions, so the purchase runs through RevenueCat's
// plugin (one SDK for both stores). The family member who pays is the
// RevenueCat user; the plan still lands on the parent's account, written by
// the worker after it has checked the purchase with RevenueCat
// (worker/src/payments/revenuecat.ts). On the website, and while the
// `payments` flag is off, nothing is charged: the stand-in hands back no
// token and the worker's stand-in approves the change.

import { Capacitor } from '@capacitor/core'
import { INTRO_ELIGIBILITY_STATUS, Purchases, PURCHASES_ERROR_CODE, type PurchasesStoreProduct } from '@revenuecat/purchases-capacitor'
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

/** What the store offers this payer for one paid tier: its own monthly
 *  price ("₩4,400" as the store writes it, without "/월") and the days of a
 *  free trial this payer would get, or null when there is none for them. */
export interface StoreOffer {
  price: string
  trialDays: number | null
}

const UNIT_DAYS: Record<string, number> = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 }

/** An ISO 8601 period ("P2W", "P14D", "P1M") in days; null when unreadable. */
export function isoPeriodDays(iso: string | null | undefined): number | null {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/.exec(iso ?? '')
  if (!m || !m.slice(1).some(Boolean)) return null
  const [y, mo, w, d] = m.slice(1).map((v) => Number(v ?? 0))
  return y * 365 + mo * 30 + w * 7 + d
}

/** The bits of a store product a free trial is read from. */
type TrialSource = Pick<PurchasesStoreProduct, 'introPrice' | 'defaultOption'>

/**
 * Days of free trial a product gives this payer, or null.
 * iOS: the product's introductory price when it is free (price 0) and the
 * store says this payer is ELIGIBLE for it. Android: the free phase of the
 * default subscription option; Play leaves it out for a payer who already
 * had it, so there is nothing more to check. Elsewhere: never.
 */
export function trialDaysOf(product: TrialSource, platform: string, eligibility?: INTRO_ELIGIBILITY_STATUS): number | null {
  if (platform === 'ios') {
    const intro = product.introPrice
    if (!intro || intro.price !== 0 || eligibility !== INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE) return null
    const unit = UNIT_DAYS[intro.periodUnit]
    const days = unit ? unit * intro.periodNumberOfUnits : isoPeriodDays(intro.period)
    return days && days > 0 ? days * Math.max(1, intro.cycles || 1) : null
  }
  if (platform === 'android') {
    const free = product.defaultOption?.freePhase
    if (!free || free.price.amountMicros !== 0) return null
    const unit = UNIT_DAYS[free.billingPeriod.unit]
    const days = isoPeriodDays(free.billingPeriod.iso8601) ?? (unit ? unit * free.billingPeriod.value : null)
    return days && days > 0 ? days * Math.max(1, free.billingCycleCount ?? 1) : null
  }
  return null
}

/** The store's offer for each paid tier it sells, from the current
 *  offering. Empty when the store has nothing to say. */
export async function storeOffers(): Promise<Partial<Record<PlanTier, StoreOffer>>> {
  if (!configuredFor) return {}
  try {
    const platform = Capacitor.getPlatform()
    const { current } = await Purchases.getOfferings()
    const packages = (current?.availablePackages ?? []).filter((p) => TIER_OF_PRODUCT[baseProductId(p.product.identifier)])
    // Apple decides per payer whether they still get the free trial.
    let eligible: Record<string, { status: INTRO_ELIGIBILITY_STATUS }> = {}
    if (platform === 'ios' && packages.some((p) => p.product.introPrice)) {
      eligible = await Purchases.checkTrialOrIntroductoryPriceEligibility({ productIdentifiers: packages.map((p) => p.product.identifier) })
        .catch((err) => { console.warn('[payments] no trial eligibility', err); return {} })
    }
    const out: Partial<Record<PlanTier, StoreOffer>> = {}
    for (const p of packages) {
      out[TIER_OF_PRODUCT[baseProductId(p.product.identifier)]] = {
        price: p.product.priceString,
        trialDays: trialDaysOf(p.product, platform, eligible[p.product.identifier]?.status),
      }
    }
    return out
  } catch (err) {
    console.warn('[payments] no store offers', err)
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
  // Play: a payer who already pays for another tier switches that
  // subscription instead of starting a second one next to it. (Apple does
  // this itself: both products are in one subscription group.)
  const from = Capacitor.getPlatform() === 'android' ? await activePlayProduct(product) : null
  try {
    await Purchases.purchasePackage({ aPackage: pkg, ...(from ? { storeProductChangeInfo: { oldProductIdentifier: from } } : {}) })
  } catch (err) {
    if ((err as { code?: string })?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) throw new PurchaseCancelled()
    throw err
  }
  return { provider: 'revenuecat', token: configuredFor }
}

/** The Play subscription this payer is on now, if it is one of ours and not
 *  `product` itself: what a purchase of `product` should replace. */
async function activePlayProduct(product: string): Promise<string | null> {
  try {
    const { customerInfo } = await Purchases.getCustomerInfo()
    const ours = Object.values(customerInfo.entitlements.active)
      .filter((e) => e.isActive && e.store === 'PLAY_STORE')
      .map((e) => baseProductId(e.productIdentifier))
      .filter((id) => id in TIER_OF_PRODUCT && id !== product)
    return ours[0] ?? null
  } catch (err) {
    console.warn('[payments] could not read the current subscription', err)
    return null
  }
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
