// Store subscriptions in the phone app, with the RevenueCat plugin faked:
// when the store may take money, prices, the purchase, cancelling, restoring.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const native = vi.hoisted(() => ({ platform: 'ios', isNative: true }))
const rc = vi.hoisted(() => ({
  configured: [] as string[], logins: [] as string[], purchased: [] as string[],
  purchaseOptions: [] as Record<string, unknown>[],
  eligibility: {} as Record<string, { status: number }>,
  activeEntitlements: {} as Record<string, { isActive: boolean; store: string; productIdentifier: string }>,
  cancelNext: false,
  active: [] as string[],
  managementURL: 'https://apps.apple.com/account/subscriptions' as string | null,
  packages: [
    { identifier: '$rc_monthly', product: { identifier: 'daylie_plus_monthly', priceString: '₩4,900' } },
    { identifier: 'family', product: { identifier: 'daylie_family_monthly', priceString: '₩7,900' } },
  ],
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.isNative, getPlatform: () => native.platform } }))
vi.mock('@revenuecat/purchases-capacitor', () => ({
  PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: '1' },
  INTRO_ELIGIBILITY_STATUS: { INTRO_ELIGIBILITY_STATUS_UNKNOWN: 0, INTRO_ELIGIBILITY_STATUS_INELIGIBLE: 1, INTRO_ELIGIBILITY_STATUS_ELIGIBLE: 2, INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS: 3 },
  Purchases: {
    configure: async ({ appUserID }: { appUserID: string }) => { rc.configured.push(appUserID) },
    logIn: async ({ appUserID }: { appUserID: string }) => { rc.logins.push(appUserID) },
    getOfferings: async () => ({ current: { availablePackages: rc.packages }, all: {} }),
    purchasePackage: async ({ aPackage, ...options }: { aPackage: { product: { identifier: string } } }) => {
      if (rc.cancelNext) { rc.cancelNext = false; throw Object.assign(new Error('cancelled'), { code: '1' }) }
      rc.purchased.push(aPackage.product.identifier)
      rc.purchaseOptions.push(options)
      return {}
    },
    restorePurchases: async () => ({ customerInfo: { entitlements: { active: Object.fromEntries(rc.active.map((t) => [t, {}])) } } }),
    getCustomerInfo: async () => ({ customerInfo: { managementURL: rc.managementURL, entitlements: { active: rc.activeEntitlements } } }),
    checkTrialOrIntroductoryPriceEligibility: async ({ productIdentifiers }: { productIdentifiers: string[] }) =>
      Object.fromEntries(productIdentifiers.filter((id) => rc.eligibility[id]).map((id) => [id, rc.eligibility[id]])),
  },
}))
vi.stubEnv('VITE_REVENUECAT_APPLE_KEY', 'appl_test')

import { INTRO_ELIGIBILITY_STATUS } from '@revenuecat/purchases-capacitor'
import { configurePayments, isoPeriodDays, managementUrl, paymentsElsewhere, paymentsLive, PurchaseCancelled, restorePurchases, startCheckout, storeOffers, trialDaysOf } from './payments'
import type { Plans } from '../types'

const plans = (payments: boolean) => ({ flags: { payments }, fairUse: { photosPerDay: null } }) as unknown as Plans

beforeEach(() => {
  rc.configured = []; rc.logins = []; rc.purchased = []; rc.purchaseOptions = []; rc.cancelNext = false; rc.active = []
  rc.eligibility = {}; rc.activeEntitlements = {}; native.platform = 'ios'
})

describe('when the store may take money', () => {
  it('only in the phone app, with a key, once the payments flag is on', () => {
    expect(paymentsLive(plans(true))).toBe(true)
    expect(paymentsLive(plans(false))).toBe(false)
    expect(paymentsLive(null)).toBe(false)
  })
  it('elsewhere, with the flag on, the sheet points at the app', () => {
    expect(paymentsElsewhere(plans(true))).toBe(false) // this is the app
    expect(paymentsElsewhere(plans(false))).toBe(false)
  })
})

describe('the purchase', () => {
  it('knows the family member once, and switches when another signs in', async () => {
    await configurePayments('kid1')
    await configurePayments('kid1')
    await configurePayments('kid2')
    expect(rc.configured).toEqual(['kid1'])
    expect(rc.logins).toEqual(['kid2'])
  })

  it("shows the store's own price for each paid tier it sells", async () => {
    await configurePayments('kid2')
    expect(await storeOffers()).toEqual({ plus: { price: '₩4,900', trialDays: null }, family: { price: '₩7,900', trialDays: null } })
  })

  it("buys the tier's product and hands back the payer as the token; free and the stand-in buy nothing", async () => {
    await configurePayments('kid2')
    expect(await startCheckout({ patientUid: 'p1', tier: 'plus' }, true)).toEqual({ provider: 'revenuecat', token: 'kid2' })
    expect(rc.purchased).toEqual(['daylie_plus_monthly'])
    expect(await startCheckout({ patientUid: 'p1', tier: 'free' }, true)).toEqual({ provider: 'stub', token: null })
    expect(await startCheckout({ patientUid: 'p1', tier: 'plus' }, false)).toEqual({ provider: 'stub', token: null })
    expect(rc.purchased).toEqual(['daylie_plus_monthly'])
  })

  it('finds Play subscriptions, which Android names with their base plan', async () => {
    const ios = rc.packages
    rc.packages = [{ identifier: '$rc_monthly', product: { identifier: 'daylie_plus_monthly:monthly', priceString: '₩4,900' } }]
    try {
      await configurePayments('kid2')
      expect(await storeOffers()).toEqual({ plus: { price: '₩4,900', trialDays: null } })
      await startCheckout({ patientUid: 'p1', tier: 'plus' }, true)
      expect(rc.purchased).toEqual(['daylie_plus_monthly:monthly'])
    } finally { rc.packages = ios }
  })

  it('tells closing the store sheet apart from a failure', async () => {
    await configurePayments('kid2')
    rc.cancelNext = true
    await expect(startCheckout({ patientUid: 'p1', tier: 'plus' }, true)).rejects.toBeInstanceOf(PurchaseCancelled)
    await expect(startCheckout({ patientUid: 'p1', tier: 'basic' }, true)).rejects.toThrow(/no store product/)
  })

  it('restores the highest active tier, or nothing', async () => {
    await configurePayments('kid2')
    expect(await restorePurchases()).toEqual({ tier: null, token: null })
    rc.active = ['basic', 'plus']
    expect(await restorePurchases()).toEqual({ tier: 'plus', token: 'kid2' })
    expect(await managementUrl()).toBe('https://apps.apple.com/account/subscriptions')
  })
})

// Store-shaped products: what RevenueCat hands back for a 2-week free trial.
const ELIGIBLE = INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE
const INELIGIBLE = INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE
const iosIntro = (over: Record<string, unknown> = {}) => ({
  introPrice: { price: 0, priceString: '₩0', cycles: 1, period: 'P2W', periodUnit: 'WEEK', periodNumberOfUnits: 2, ...over },
  defaultOption: null,
}) as unknown as Parameters<typeof trialDaysOf>[0]
const playOption = (freePhase: unknown) => ({ introPrice: null, defaultOption: { freePhase } }) as unknown as Parameters<typeof trialDaysOf>[0]
const freePhase = (iso: string, unit: string, value: number) => ({
  billingPeriod: { unit, value, iso8601: iso }, billingCycleCount: 1, recurrenceMode: 2,
  price: { formatted: 'Free', amountMicros: 0, currencyCode: 'KRW' }, offerPaymentMode: 'FREE_TRIAL',
})

describe('the free trial', () => {
  it('reads ISO periods in days', () => {
    expect(isoPeriodDays('P2W')).toBe(14)
    expect(isoPeriodDays('P14D')).toBe(14)
    expect(isoPeriodDays('P1M')).toBe(30)
    expect(isoPeriodDays('P1W3D')).toBe(10)
    expect(isoPeriodDays('P')).toBeNull()
    expect(isoPeriodDays('')).toBeNull()
  })

  it('iOS: a free introductory price the payer is eligible for is the trial', () => {
    expect(trialDaysOf(iosIntro(), 'ios', ELIGIBLE)).toBe(14)
    expect(trialDaysOf(iosIntro({ periodUnit: 'DAY', periodNumberOfUnits: 14, period: 'P14D' }), 'ios', ELIGIBLE)).toBe(14)
  })

  it('iOS: no trial for a payer who is not eligible, whose eligibility is unknown, or for a paid intro price', () => {
    expect(trialDaysOf(iosIntro(), 'ios', INELIGIBLE)).toBeNull()
    expect(trialDaysOf(iosIntro(), 'ios', INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_UNKNOWN)).toBeNull()
    expect(trialDaysOf(iosIntro(), 'ios', undefined)).toBeNull()
    expect(trialDaysOf(iosIntro({ price: 1100, priceString: '₩1,100' }), 'ios', ELIGIBLE)).toBeNull()
    expect(trialDaysOf({ introPrice: null, defaultOption: null } as unknown as Parameters<typeof trialDaysOf>[0], 'ios', ELIGIBLE)).toBeNull()
  })

  it("Android: the default option's free phase is the trial (Play offers it only to eligible payers)", () => {
    expect(trialDaysOf(playOption(freePhase('P2W', 'WEEK', 2)), 'android')).toBe(14)
    expect(trialDaysOf(playOption(null), 'android')).toBeNull()
    expect(trialDaysOf({ introPrice: null, defaultOption: null } as unknown as Parameters<typeof trialDaysOf>[0], 'android')).toBeNull()
  })

  it('the web never has one', () => {
    expect(trialDaysOf(iosIntro(), 'web', ELIGIBLE)).toBeNull()
    expect(trialDaysOf(playOption(freePhase('P2W', 'WEEK', 2)), 'web')).toBeNull()
  })

  it("storeOffers asks Apple about this payer's eligibility per product", async () => {
    const saved = rc.packages
    rc.packages = [
      { identifier: '$rc_monthly', product: { identifier: 'daylie_plus_monthly', priceString: '₩4,400', ...iosIntro() } },
      { identifier: 'family', product: { identifier: 'daylie_family_monthly', priceString: '₩7,700', ...iosIntro() } },
    ] as unknown as typeof rc.packages
    rc.eligibility = { daylie_plus_monthly: { status: ELIGIBLE }, daylie_family_monthly: { status: INELIGIBLE } }
    try {
      await configurePayments('kid2')
      expect(await storeOffers()).toEqual({ plus: { price: '₩4,400', trialDays: 14 }, family: { price: '₩7,700', trialDays: null } })
    } finally { rc.packages = saved }
  })

  it('storeOffers on Android reads the free phase', async () => {
    native.platform = 'android'
    vi.stubEnv('VITE_REVENUECAT_GOOGLE_KEY', 'goog_test')
    const saved = rc.packages
    rc.packages = [
      { identifier: '$rc_monthly', product: { identifier: 'daylie_plus_monthly:monthly', priceString: '₩4,400', ...playOption(freePhase('P2W', 'WEEK', 2)) } },
      { identifier: 'family', product: { identifier: 'daylie_family_monthly:monthly', priceString: '₩7,700', ...playOption(null) } },
    ] as unknown as typeof rc.packages
    try {
      await configurePayments('kid2')
      expect(await storeOffers()).toEqual({ plus: { price: '₩4,400', trialDays: 14 }, family: { price: '₩7,700', trialDays: null } })
    } finally { rc.packages = saved }
  })
})

describe('switching tiers on Play', () => {
  const playPackages = [
    { identifier: '$rc_monthly', product: { identifier: 'daylie_plus_monthly:monthly', priceString: '₩4,400' } },
    { identifier: 'family', product: { identifier: 'daylie_family_monthly:monthly', priceString: '₩7,700' } },
  ]

  it('replaces the active subscription instead of starting a second one', async () => {
    native.platform = 'android'
    const saved = rc.packages
    rc.packages = playPackages
    rc.activeEntitlements = { plus: { isActive: true, store: 'PLAY_STORE', productIdentifier: 'daylie_plus_monthly' } }
    try {
      await configurePayments('kid2')
      await startCheckout({ patientUid: 'p1', tier: 'family' }, true)
      expect(rc.purchased).toEqual(['daylie_family_monthly:monthly'])
      expect(rc.purchaseOptions).toEqual([{ storeProductChangeInfo: { oldProductIdentifier: 'daylie_plus_monthly' } }])
    } finally { rc.packages = saved }
  })

  it('a first purchase, the same product, or an App Store subscription is a plain purchase', async () => {
    native.platform = 'android'
    const saved = rc.packages
    rc.packages = playPackages
    try {
      await configurePayments('kid2')
      await startCheckout({ patientUid: 'p1', tier: 'plus' }, true)
      rc.activeEntitlements = { plus: { isActive: true, store: 'PLAY_STORE', productIdentifier: 'daylie_plus_monthly:monthly' } }
      await startCheckout({ patientUid: 'p1', tier: 'plus' }, true)
      rc.activeEntitlements = { plus: { isActive: true, store: 'APP_STORE', productIdentifier: 'daylie_plus_monthly' } }
      await startCheckout({ patientUid: 'p1', tier: 'family' }, true)
      expect(rc.purchaseOptions).toEqual([{}, {}, {}])
    } finally { rc.packages = saved }
  })

  it('iOS never passes change info (Apple switches within the subscription group)', async () => {
    rc.activeEntitlements = { plus: { isActive: true, store: 'APP_STORE', productIdentifier: 'daylie_plus_monthly' } }
    await configurePayments('kid2')
    await startCheckout({ patientUid: 'p1', tier: 'family' }, true)
    expect(rc.purchaseOptions).toEqual([{}])
  })
})
