// 운영실 매출 (D12): RevenueCat's answers on plain rows, the status of one
// purchase, the counts, and the handler against the emulators.

import { describe, it, expect, beforeEach } from 'vitest'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp } from 'firebase-admin/firestore'
import { overviewMetrics, priceFromLabel, storeDetail, subStatus, summarize, type StoreDetail, type SubRow } from '../src/revenue'
import { adminRevenue, resetRevenueCache, type RevenueDeps } from '../src/handlers/adminRevenue'
import { db, clearFirestore } from './setup'

const D = 86_400_000
const NOW = Date.parse('2026-10-27T03:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

const rcJson = (subs: Record<string, Record<string, unknown>>) => ({ subscriber: { subscriptions: subs, entitlements: {} } })

describe('storeDetail', () => {
  it('reads the subscription behind a product, also when Play keys it id:basePlan', () => {
    const json = rcJson({ 'daylie_plus_monthly:monthly': { store: 'play_store', is_sandbox: true, period_type: 'normal', purchase_date: iso(NOW - 2 * D), original_purchase_date: iso(NOW - 40 * D), expires_date: iso(NOW + 28 * D), unsubscribe_detected_at: null, billing_issues_detected_at: null, grace_period_expires_date: null, refunded_at: null } })
    const d = storeDetail(json, 'daylie_plus_monthly')!
    expect(d).toMatchObject({ store: 'play_store', sandbox: true, periodType: 'normal', originalPurchaseMs: NOW - 40 * D, expiresMs: NOW + 28 * D, unsubscribedMs: null, refundedMs: null })
    expect(storeDetail(json, 'daylie_family_monthly')).toBeNull()
    expect(storeDetail({}, 'daylie_plus_monthly')).toBeNull()
  })
  it('an unknown store reads as other', () => {
    expect(storeDetail(rcJson({ p: { store: 'promotional' } }), 'p')!.store).toBe('other')
  })
})

describe('subStatus', () => {
  const base: StoreDetail = { store: 'app_store', sandbox: false, periodType: 'normal', purchaseMs: NOW - D, originalPurchaseMs: NOW - D, expiresMs: NOW + 29 * D, unsubscribedMs: null, billingIssueMs: null, graceUntilMs: null, refundedMs: null }
  it('follows what the store said', () => {
    expect(subStatus(base, 'active', null, NOW)).toBe('active')
    expect(subStatus({ ...base, unsubscribedMs: NOW - 1 }, 'active', null, NOW)).toBe('cancelling')
    expect(subStatus({ ...base, billingIssueMs: NOW - 1 }, 'active', null, NOW)).toBe('grace')
    expect(subStatus({ ...base, expiresMs: NOW - 1, graceUntilMs: NOW + 5 * D }, 'active', null, NOW)).toBe('grace')
    expect(subStatus({ ...base, expiresMs: NOW - 1 }, 'active', null, NOW)).toBe('ended')
    expect(subStatus({ ...base, refundedMs: NOW - 1 }, 'active', null, NOW)).toBe('refunded')
    expect(subStatus({ ...base, expiresMs: null }, 'active', null, NOW)).toBe('active')
  })
  it('without the store, our own plan record decides', () => {
    expect(subStatus(null, 'active', NOW + D, NOW)).toBe('active')
    expect(subStatus(null, 'grace', NOW + D, NOW)).toBe('grace')
    expect(subStatus(null, 'active', NOW - D, NOW)).toBe('ended')
    expect(subStatus(null, undefined, null, NOW)).toBe('active')
  })
})

describe('summarize', () => {
  const row = (over: Partial<SubRow>): SubRow => ({ payerUid: 'k', patientUid: 'p', patientName: '엄마', tier: 'plus', productId: 'daylie_plus_monthly', since: NOW - 10 * D, expiresAt: NOW + 20 * D, status: 'active', store: 'app_store', sandbox: false, trial: false, priceKRW: 4400, ...over })
  it('counts what is paid for, leaves out store builds, and adds up list prices', () => {
    const s = summarize([
      row({}),
      row({ tier: 'family', priceKRW: 7700, status: 'grace', since: NOW - 40 * D }),
      row({ status: 'cancelling' }),
      row({ sandbox: true }),
      row({ status: 'ended' }),
      row({ status: 'refunded' }),
      row({ trial: true, store: null }),
    ], [{ atMs: NOW - 3 * D, refunded: true }, { atMs: NOW - 40 * D, refunded: false }], NOW)
    expect(s).toEqual({ paying: 4, byTier: { plus: 3, family: 1 }, grace: 1, cancelling: 1, sandbox: 1, trial: 1, new30d: 3, ended30d: 1, refunded30d: 2, mrrKRW: 4400 + 7700 + 4400, unverified: 1 })
  })
  it('no price on a paid row: MRR is unknown rather than short', () => {
    expect(summarize([row({ priceKRW: null })], [], NOW).mrrKRW).toBeNull()
    expect(summarize([], [], NOW).mrrKRW).toBe(0)
  })
})

describe('overviewMetrics', () => {
  it('keeps RevenueCat\'s figures as they come and refuses anything else', () => {
    const m = overviewMetrics({ object: 'overview_metrics', metrics: [
      { object: 'overview_metric', id: 'mrr', name: 'MRR', value: 12.5, unit: '$', period: 'P0D' },
      { object: 'overview_metric', id: 'active_subscriptions', name: 'Active Subscriptions', value: 3, unit: '#' },
      { id: 'broken' },
    ] })
    expect(m).toEqual([{ id: 'mrr', name: 'MRR', value: 12.5, unit: '$', period: 'P0D' }, { id: 'active_subscriptions', name: 'Active Subscriptions', value: 3, unit: '#', period: null }])
    expect(() => overviewMetrics({ error: 'x' })).toThrow(/not a RevenueCat overview/)
  })
  it('reads a price label', () => {
    expect(priceFromLabel('₩4,400/월')).toBe(4400)
    expect(priceFromLabel(undefined)).toBeNull()
  })
})

describe('adminRevenue handler', () => {
  const ADMIN = { uid: 'admin1', email: 'zymer4him@gmail.com', name: 'Shawn', emailVerified: true }
  const deps = (over: Partial<RevenueDeps> = {}): RevenueDeps => ({
    lookup: async () => 'missing-key',
    overview: async () => 'missing',
    now: () => NOW,
    ...over,
  })
  beforeEach(async () => {
    await clearFirestore()
    resetRevenueCache()
    for (const u of await getAuth().listUsers().then((r) => r.users)) await getAuth().deleteUser(u.uid)
    await db.doc('admin_config/plans').set({ flags: { payments: true }, plus: { familyMembers: 6, priceLabel: '₩4,400/월' }, family: { familyMembers: 10, priceLabel: '₩7,700/월' } })
    await db.doc('users/mom').set({ accountType: 'managed', patientName: '엄마', plan: { tier: 'plus', status: 'active', since: Timestamp.fromMillis(NOW - 5 * D), payment: { provider: 'revenuecat', reference: 'daylie_plus_monthly', payerUid: 'kid' } } })
    await db.doc('users/gran').set({ accountType: 'managed', patientName: '할머니', plan: { tier: 'family', status: 'grace', since: Timestamp.fromMillis(NOW - 50 * D) } })
    await db.doc('planPayments/kid').set({ patientUid: 'mom', tier: 'plus', productId: 'daylie_plus_monthly', expiresAt: Timestamp.fromMillis(NOW + 25 * D), updatedAt: Timestamp.fromMillis(NOW - 5 * D) })
    await db.doc('planPayments/aunt').set({ patientUid: 'gran', tier: 'family', productId: 'daylie_family_monthly:monthly', expiresAt: Timestamp.fromMillis(NOW + 2 * D), updatedAt: Timestamp.fromMillis(NOW - 50 * D) })
    await db.collection('auditLogs').add({ patientUid: 'x', actorUid: 'y', action: 'plan.change', details: { from: 'plus', to: 'free', provider: 'revenuecat', source: 'subscription', refunded: true }, timestamp: Timestamp.fromMillis(NOW - 2 * D) })
  })

  it('is for the admin only', async () => {
    await expect(adminRevenue({ uid: 'x', email: 'x@example.com', name: 'x' }, {}, deps())).rejects.toThrow(/admin only/)
  })

  it('without the RevenueCat key, our own records stand and the rows say they are unconfirmed', async () => {
    const r = await adminRevenue(ADMIN, {}, deps())
    expect(r.payments).toEqual({ live: true, provider: process.env.PAYMENT_PROVIDER || 'stub' })
    expect(r.store).toEqual({ state: 'unconfigured', missing: ['REVENUECAT_SECRET_KEY'], error: null })
    expect(r.rows.map((x) => [x.patientName, x.tier, x.status, x.store, x.priceKRW])).toEqual([['엄마', 'plus', 'active', null, 4400], ['할머니', 'family', 'grace', null, 7700]])
    expect(r.summary).toMatchObject({ paying: 2, grace: 1, new30d: 1, refunded30d: 1, ended30d: 0, mrrKRW: 12100, unverified: 2 })
    expect(r.prices).toEqual({ basic: null, plus: 4400, family: 7700 })
    expect(r.overview).toEqual({ state: 'unconfigured', missing: ['REVENUECAT_V2_KEY', 'REVENUECAT_PROJECT_ID'], error: null, metrics: [] })
  })

  it('with the store answering, its word wins: a sandbox purchase is not revenue, a refund is', async () => {
    const r = await adminRevenue(ADMIN, { refresh: true }, deps({
      lookup: async (uid) => ({ json: uid === 'kid'
        ? rcJson({ daylie_plus_monthly: { store: 'app_store', is_sandbox: true, period_type: 'normal', expires_date: iso(NOW + 25 * D), original_purchase_date: iso(NOW - 5 * D) } })
        : rcJson({ 'daylie_family_monthly:monthly': { store: 'play_store', is_sandbox: false, period_type: 'normal', expires_date: iso(NOW + 2 * D), original_purchase_date: iso(NOW - 50 * D), refunded_at: iso(NOW - D) } }) }),
      overview: async () => ({ json: { metrics: [{ id: 'mrr', name: 'MRR', value: 0, unit: '$', period: 'P0D' }] } }),
    }))
    expect(r.store.state).toBe('ok')
    expect(r.rows.map((x) => [x.patientName, x.status, x.store, x.sandbox])).toEqual([['엄마', 'active', 'app_store', true], ['할머니', 'refunded', 'play_store', false]])
    expect(r.summary).toMatchObject({ paying: 0, sandbox: 1, refunded30d: 2, mrrKRW: 0, unverified: 0 })
    expect(r.overview).toMatchObject({ state: 'ok', metrics: [{ id: 'mrr', value: 0 }] })
  })

  it('one payer RevenueCat never heard of makes the rows unconfirmed, the rest still count', async () => {
    const r = await adminRevenue(ADMIN, { refresh: true }, deps({ lookup: async (uid) => (uid === 'kid' ? 'unknown-subscriber' : 'unreachable') }))
    expect(r.store.state).toBe('error')
    expect(r.summary.paying).toBe(2)
    expect(r.summary.unverified).toBe(2)
  })
})
