// Following store subscriptions: renewals, a card problem, an ending, and a
// store that says nothing. Firestore is the emulator; RevenueCat is a fake
// lookup.

import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { pollSubscriptions } from '../src/handlers/subscriptions'
import type { EntitlementState, SubscriberState } from '../src/payments/revenuecat'
import { db, clearFirestore } from './setup'

const DAY = 24 * 3600 * 1000
const PRODUCT = 'daylie_plus_monthly'
const now = new Date('2026-10-21T09:00:00Z')
const at = (days: number) => new Date(now.getTime() + days * DAY)

/** A parent on Plus, paid for by cg1, with a month left. */
async function seedPaid(extra: Record<string, unknown> = {}) {
  await db.doc('users/p1').set({
    patientName: '어머니',
    plan: {
      tier: 'plus',
      status: 'active',
      changedBy: 'cg1',
      since: Timestamp.fromDate(at(-10)),
      payment: { provider: 'revenuecat', reference: PRODUCT, payerUid: 'cg1', expiresAt: Timestamp.fromDate(at(20)) },
    },
  })
  await db.doc('planPayments/cg1').set({
    patientUid: 'p1', tier: 'plus', productId: PRODUCT, expiresAt: Timestamp.fromDate(at(20)), updatedAt: Timestamp.fromDate(at(-10)), ...extra,
  })
}

const entitled = (o: Partial<EntitlementState> = {}): SubscriberState => ({
  entitlements: { plus: { expiresAt: at(50), productId: PRODUCT, graceUntil: null, billingIssue: false, refunded: false, ...o } },
})
const answers = (state: SubscriberState | null) => ({ lookup: async () => state, now: () => now })

const plan = async (uid = 'p1') => (await db.doc(`users/${uid}`).get()).get('plan')
const row = async (payerUid = 'cg1') => (await db.doc(`planPayments/${payerUid}`).get()).data()
const planChanges = async () => (await db.collection('auditLogs').where('action', '==', 'plan.change').get()).docs.map((d) => d.data())

beforeEach(async () => {
  await clearFirestore()
})

describe('pollSubscriptions', () => {
  it('pushes the expiry out when the store renewed', async () => {
    await seedPaid()
    expect(await pollSubscriptions(answers(entitled()))).toEqual({ checked: 1, renewed: 1, graced: 0, ended: 0 })
    expect((await plan()).payment.expiresAt.toMillis()).toBe(at(50).getTime())
    expect((await plan()).status).toBe('active')
    expect((await plan()).tier).toBe('plus')
    // The row mirrors it, so the plan sheet and the next poll agree.
    expect((await row())!.expiresAt.toMillis()).toBe(at(50).getTime())
  })

  it('keeps a plan whose expiry never comes', async () => {
    await seedPaid()
    expect((await pollSubscriptions(answers(entitled({ expiresAt: null })))).renewed).toBe(1)
    expect((await plan()).payment.expiresAt).toBeNull()
    expect((await row())!.expiresAt).toBeNull()
  })

  it('puts a card problem in grace and keeps everything the family has', async () => {
    await seedPaid()
    expect(await pollSubscriptions(answers(entitled({ billingIssue: true, graceUntil: at(16) }))))
      .toEqual({ checked: 1, renewed: 0, graced: 1, ended: 0 })
    expect(await plan()).toMatchObject({ tier: 'plus', status: 'grace' })
    expect(await row()).toMatchObject({ patientUid: 'p1', tier: 'plus' })
    expect(await planChanges()).toEqual([])
  })

  it('puts the parent back on Free when the subscription ended, and says so in the log', async () => {
    await seedPaid()
    expect(await pollSubscriptions(answers(entitled({ expiresAt: at(-1) }))))
      .toEqual({ checked: 1, renewed: 0, graced: 0, ended: 1 })
    const after = await plan()
    expect(after).toMatchObject({ tier: 'free', status: 'active', changedBy: 'subscription', payment: { provider: 'revenuecat', endedFrom: 'plus' } })
    expect(after.since).toBeInstanceOf(Timestamp)
    expect(await row()).toBeUndefined()
    expect(await planChanges()).toEqual([expect.objectContaining({
      patientUid: 'p1',
      actorUid: 'cg1',
      details: { from: 'plus', to: 'free', provider: 'revenuecat', source: 'subscription' },
    })])
  })

  it('does the same for a refund, and for an entitlement the store dropped', async () => {
    await seedPaid()
    expect((await pollSubscriptions(answers(entitled({ refunded: true })))).ended).toBe(1)
    expect((await plan()).tier).toBe('free')

    await seedPaid()
    expect((await pollSubscriptions(answers({ entitlements: {} }))).ended).toBe(1)
    expect((await plan()).tier).toBe('free')
    expect(await row()).toBeUndefined()
  })

  it('changes nothing when the store gives no answer', async () => {
    await seedPaid()
    expect(await pollSubscriptions(answers(null))).toEqual({ checked: 1, renewed: 0, graced: 0, ended: 0 })
    expect(await plan()).toMatchObject({ tier: 'plus', status: 'active' })
    expect((await plan()).payment.expiresAt.toMillis()).toBe(at(20).getTime())
    expect(await row()).toMatchObject({ patientUid: 'p1', tier: 'plus' })
    expect(await planChanges()).toEqual([])
  })

  it('clears a purchase whose parent account is gone', async () => {
    await seedPaid()
    await db.doc('users/p1').delete()
    expect(await pollSubscriptions(answers(entitled()))).toEqual({ checked: 1, renewed: 0, graced: 0, ended: 0 })
    expect(await row()).toBeUndefined()
    expect(await planChanges()).toEqual([])
  })

  it('clears a purchase that says nothing about what it pays for', async () => {
    await db.doc('planPayments/cg1').set({ productId: PRODUCT })
    expect(await pollSubscriptions(answers(entitled()))).toEqual({ checked: 1, renewed: 0, graced: 0, ended: 0 })
    expect(await row()).toBeUndefined()
  })

  it('carries on past a payer that failed', async () => {
    await seedPaid()
    await db.doc('users/p2').set({ patientName: '아버지', plan: { tier: 'plus', status: 'active', payment: { provider: 'revenuecat', payerUid: 'cg2', expiresAt: Timestamp.fromDate(at(20)) } } })
    await db.doc('planPayments/cg2').set({ patientUid: 'p2', tier: 'plus', productId: PRODUCT, expiresAt: Timestamp.fromDate(at(20)) })
    const result = await pollSubscriptions({
      now: () => now,
      lookup: async (payerUid) => { if (payerUid === 'cg1') throw new Error('rate limited'); return entitled() },
    })
    expect(result).toEqual({ checked: 2, renewed: 1, graced: 0, ended: 0 })
    expect((await plan('p1')).payment.expiresAt.toMillis()).toBe(at(20).getTime())
    expect((await plan('p2')).payment.expiresAt.toMillis()).toBe(at(50).getTime())
  })

  it('has nothing to do when nobody is paying', async () => {
    expect(await pollSubscriptions(answers(entitled()))).toEqual({ checked: 0, renewed: 0, graced: 0, ended: 0 })
  })
})
