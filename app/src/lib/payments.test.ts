// Store subscriptions in the phone app, with the RevenueCat plugin faked:
// when the store may take money, prices, the purchase, cancelling, restoring.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const native = vi.hoisted(() => ({ platform: 'ios', isNative: true }))
const rc = vi.hoisted(() => ({
  configured: [] as string[], logins: [] as string[], purchased: [] as string[],
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
  Purchases: {
    configure: async ({ appUserID }: { appUserID: string }) => { rc.configured.push(appUserID) },
    logIn: async ({ appUserID }: { appUserID: string }) => { rc.logins.push(appUserID) },
    getOfferings: async () => ({ current: { availablePackages: rc.packages }, all: {} }),
    purchasePackage: async ({ aPackage }: { aPackage: { product: { identifier: string } } }) => {
      if (rc.cancelNext) { rc.cancelNext = false; throw Object.assign(new Error('cancelled'), { code: '1' }) }
      rc.purchased.push(aPackage.product.identifier)
      return {}
    },
    restorePurchases: async () => ({ customerInfo: { entitlements: { active: Object.fromEntries(rc.active.map((t) => [t, {}])) } } }),
    getCustomerInfo: async () => ({ customerInfo: { managementURL: rc.managementURL } }),
  },
}))
vi.stubEnv('VITE_REVENUECAT_APPLE_KEY', 'appl_test')

import { configurePayments, managementUrl, paymentsElsewhere, paymentsLive, PurchaseCancelled, restorePurchases, startCheckout, storePrices } from './payments'
import type { Plans } from '../types'

const plans = (payments: boolean) => ({ flags: { payments }, fairUse: { photosPerDay: null } }) as unknown as Plans

beforeEach(() => { rc.configured = []; rc.logins = []; rc.purchased = []; rc.cancelNext = false; rc.active = [] })

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
    expect(await storePrices()).toEqual({ plus: '₩4,900/월', family: '₩7,900/월' })
  })

  it("buys the tier's product and hands back the payer as the token; free and the stand-in buy nothing", async () => {
    await configurePayments('kid2')
    expect(await startCheckout({ patientUid: 'p1', tier: 'plus' }, true)).toEqual({ provider: 'revenuecat', token: 'kid2' })
    expect(rc.purchased).toEqual(['daylie_plus_monthly'])
    expect(await startCheckout({ patientUid: 'p1', tier: 'free' }, true)).toEqual({ provider: 'stub', token: null })
    expect(await startCheckout({ patientUid: 'p1', tier: 'plus' }, false)).toEqual({ provider: 'stub', token: null })
    expect(rc.purchased).toEqual(['daylie_plus_monthly'])
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
