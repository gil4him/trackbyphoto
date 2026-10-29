// RevenueCat: what the store says, and what the worker will believe.
// No network — fetch is a fake returning recorded subscriber JSON.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  PRODUCT_IDS,
  entitlementActive,
  lookupSubscriber,
  revenueCatPayments,
  toSubscriberState,
} from '../src/payments/revenuecat'

const DAY_MS = 24 * 3600 * 1000
const iso = (fromNowMs: number) => new Date(Date.now() + fromNowMs).toISOString()

/** One entitlement plus the subscription that granted it, as RevenueCat sends it. */
const subscriberJson = (
  tier: 'basic' | 'plus' | 'family',
  expires: string | null,
  sub: Record<string, unknown> = {},
  ent: Record<string, unknown> = {},
) => ({
  subscriber: {
    original_app_user_id: 'cg1',
    entitlements: {
      [tier]: {
        expires_date: expires,
        product_identifier: PRODUCT_IDS[tier],
        purchase_date: iso(-30 * DAY_MS),
        ...ent,
      },
    },
    subscriptions: {
      [PRODUCT_IDS[tier]]: {
        expires_date: expires,
        billing_issues_detected_at: null,
        unsubscribe_detected_at: null,
        refunded_at: null,
        store: 'app_store',
        ...sub,
      },
    },
  },
})

interface Call { url: string; auth: unknown }

const fakeFetch = (status: number, json: unknown, calls: Call[] = []) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') })
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch

const buy = (tier: 'basic' | 'plus' | 'family' = 'plus') =>
  ({ payerUid: 'cg1', patientUid: 'p1', from: 'free' as const, to: tier, token: 'cg1' })

beforeEach(() => { process.env.REVENUECAT_SECRET_KEY = 'sk_test' })
afterEach(() => { delete process.env.REVENUECAT_SECRET_KEY })

describe('revenuecat confirm', () => {
  it('approves a live entitlement and hands back the product and its expiry', async () => {
    const calls: Call[] = []
    const expires = iso(20 * DAY_MS)
    const res = await revenueCatPayments(fakeFetch(200, subscriberJson('plus', expires), calls)).confirm(buy())
    expect(res).toEqual({
      ok: true,
      provider: 'revenuecat',
      reference: 'daylie_plus_monthly',
      productId: 'daylie_plus_monthly',
      expiresAt: new Date(expires),
      periodType: null,
    })
    // The payer's own uid is the app user id, and the key is a bearer token.
    expect(calls).toEqual([{ url: 'https://api.revenuecat.com/v1/subscribers/cg1', auth: 'Bearer sk_test' }])
  })

  it('says when the purchase is in the store\'s free trial', async () => {
    const expires = iso(14 * DAY_MS)
    const res = await revenueCatPayments(fakeFetch(200, subscriberJson('plus', expires, { period_type: 'trial' }))).confirm(buy())
    expect(res).toMatchObject({ ok: true, productId: 'daylie_plus_monthly', expiresAt: new Date(expires), periodType: 'trial' })
    const paid = await revenueCatPayments(fakeFetch(200, subscriberJson('family', expires, { period_type: 'normal' }))).confirm(buy('family'))
    expect(paid.periodType).toBe('normal')
  })

  it('refuses when the entitlement has run out, or is for another tier', async () => {
    const expired = await revenueCatPayments(fakeFetch(200, subscriberJson('plus', iso(-DAY_MS)))).confirm(buy())
    expect(expired).toEqual({ ok: false, provider: 'revenuecat', reason: 'not entitled' })
    const other = await revenueCatPayments(fakeFetch(200, subscriberJson('basic', iso(DAY_MS)))).confirm(buy('family'))
    expect(other.reason).toBe('not entitled')
  })

  it('refuses a refunded purchase even while the entitlement still runs', async () => {
    const json = subscriberJson('plus', iso(20 * DAY_MS), { refunded_at: iso(-DAY_MS) })
    expect((await revenueCatPayments(fakeFetch(200, json)).confirm(buy())).reason).toBe('not entitled')
  })

  it('refuses a payer the store has never heard of', async () => {
    const res = await revenueCatPayments(fakeFetch(404, { code: 7259, message: 'Not found' })).confirm(buy())
    expect(res).toEqual({ ok: false, provider: 'revenuecat', reason: 'not entitled' })
  })

  it('refuses rather than guess when the key is missing or the store is down', async () => {
    delete process.env.REVENUECAT_SECRET_KEY
    expect(await revenueCatPayments(fakeFetch(200, subscriberJson('plus', null))).confirm(buy())).toEqual({
      ok: false, provider: 'revenuecat', reason: 'REVENUECAT_SECRET_KEY missing',
    })

    process.env.REVENUECAT_SECRET_KEY = 'sk_test'
    const dead = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    expect((await revenueCatPayments(dead).confirm(buy())).reason).toBe('the store could not be reached')
    expect((await revenueCatPayments(fakeFetch(500, {})).confirm(buy())).reason).toBe('the store could not be reached')
  })

  it('charges nothing for Free, whatever the store says', async () => {
    const dead = (async () => { throw new Error('nobody should be asked') }) as unknown as typeof fetch
    expect(await revenueCatPayments(dead).confirm({ ...buy(), from: 'plus', to: 'free', token: null })).toEqual({
      ok: true, provider: 'revenuecat',
    })
  })
})

describe('the subscriber JSON', () => {
  it('keeps the expiry, the product, the card problem and the refund', async () => {
    const expires = iso(5 * DAY_MS)
    const grace = iso(12 * DAY_MS)
    const state = toSubscriberState(subscriberJson(
      'family',
      expires,
      { billing_issues_detected_at: iso(-DAY_MS), refunded_at: iso(-2 * DAY_MS) },
      { grace_period_expires_date: grace },
    ))
    expect(state).toEqual({
      entitlements: {
        family: {
          expiresAt: new Date(expires),
          productId: 'daylie_family_monthly',
          graceUntil: new Date(grace),
          billingIssue: true,
          refunded: true,
          periodType: null,
        },
      },
    })
  })

  it('reads a subscription with no end, and ignores anything that is not a tier', async () => {
    const json = subscriberJson('basic', null)
    ;(json.subscriber.entitlements as Record<string, unknown>).pro_legacy = { expires_date: null, product_identifier: 'other' }
    const state = toSubscriberState(json)
    expect(Object.keys(state.entitlements)).toEqual(['basic'])
    expect(state.entitlements.basic).toEqual({
      expiresAt: null, productId: 'daylie_basic_monthly', graceUntil: null, billingIssue: false, refunded: false, periodType: null,
    })
    expect(entitlementActive(state.entitlements.basic!)).toBe(true)
  })

  it('reads the period type: trial, intro, normal, and nothing else', () => {
    for (const period of ['trial', 'intro', 'normal'] as const) {
      expect(toSubscriberState(subscriberJson('plus', iso(DAY_MS), { period_type: period })).entitlements.plus!.periodType).toBe(period)
    }
    expect(toSubscriberState(subscriberJson('plus', iso(DAY_MS), { period_type: 'prepaid' })).entitlements.plus!.periodType).toBeNull()
    expect(toSubscriberState(subscriberJson('plus', iso(DAY_MS))).entitlements.plus!.periodType).toBeNull()
  })

  it('finds the Play subscription when the entitlement names its base plan', () => {
    const json = subscriberJson('plus', iso(20 * DAY_MS), { refunded_at: iso(-DAY_MS), store: 'play_store' }, { product_identifier: 'daylie_plus_monthly:monthly' })
    const ent = toSubscriberState(json).entitlements.plus!
    expect(ent.productId).toBe('daylie_plus_monthly:monthly')
    expect(ent.refunded).toBe(true)
  })

  it('says nothing at all about a subscriber who never bought anything', async () => {
    expect(toSubscriberState({ subscriber: { entitlements: {}, subscriptions: {} } })).toEqual({ entitlements: {} })
    expect(toSubscriberState({})).toEqual({ entitlements: {} })
  })

  it('lives until the expiry passes', async () => {
    const ent = { productId: 'x', billingIssue: false, refunded: false }
    const now = new Date('2026-10-21T00:00:00Z')
    expect(entitlementActive({ ...ent, expiresAt: new Date('2026-10-22T00:00:00Z') }, now)).toBe(true)
    expect(entitlementActive({ ...ent, expiresAt: new Date('2026-10-20T00:00:00Z') }, now)).toBe(false)
    expect(entitlementActive({ ...ent, expiresAt: null }, now)).toBe(true)
  })

  it('a lookup is null when the store has nothing to say', async () => {
    expect(await lookupSubscriber('cg1', fakeFetch(404, {}))).toBeNull()
    delete process.env.REVENUECAT_SECRET_KEY
    expect(await lookupSubscriber('cg1', fakeFetch(200, subscriberJson('plus', null)))).toBeNull()
    process.env.REVENUECAT_SECRET_KEY = 'sk_test'
    const state = await lookupSubscriber('cg1', fakeFetch(200, subscriberJson('plus', null)))
    expect(state?.entitlements.plus?.productId).toBe('daylie_plus_monthly')
  })
})
