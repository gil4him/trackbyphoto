// Following store subscriptions: renewals, a card problem, an ending, and a
// store that says nothing. Firestore is the emulator; RevenueCat is a fake
// lookup.

import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { pollSubscriptions } from '../src/handlers/subscriptions'
import type { EntitlementState, SubscriberState } from '../src/payments/revenuecat'
import type { PushMessage } from '../src/handlers/push'
import type { PlansDoc } from '../src/plans'
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
      details: { from: 'plus', to: 'free', provider: 'revenuecat', source: 'subscription', refunded: false, trial: false },
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

// The store's free trial (owner decision, 2026-10-28): the poll follows it,
// reminds the payer once near its end, and tells them when it ran out.
describe('pollSubscriptions and the free trial', () => {
  const PLANS = {
    plus: { priceLabel: '₩4,400/월' },
    family: { priceLabel: '₩7,700/월' },
    fairUse: { photosPerDay: null },
  }
  const fakes = (flags: Record<string, boolean> = { planNudges: true, pushFamily: true }) => {
    const pushes: Array<{ uids: string[]; message: PushMessage }> = []
    return {
      pushes,
      deps: (state: SubscriberState | null, when = now) => ({
        lookup: async () => state,
        now: () => when,
        plans: async () => ({ ...PLANS, flags } as unknown as PlansDoc),
        push: async (uids: string[], message: PushMessage) => { pushes.push({ uids, message }); return uids.length },
      }),
    }
  }
  /** A parent in Plus's free trial, ending `days` from now. */
  async function seedTrial(days: number) {
    const ends = Timestamp.fromDate(at(days))
    await db.doc('users/p1').set({
      patientName: '어머니',
      plan: {
        tier: 'plus', status: 'active', changedBy: 'cg1', since: Timestamp.fromDate(at(days - 14)),
        payment: { provider: 'revenuecat', reference: PRODUCT, payerUid: 'cg1', expiresAt: ends, periodType: 'trial', trialEndsAt: ends },
      },
    })
    await db.doc('planPayments/cg1').set({ patientUid: 'p1', tier: 'plus', productId: PRODUCT, expiresAt: ends, periodType: 'trial', trialEndsAt: ends })
  }
  const notices = async (uid: string) =>
    (await db.collection('notifications').where('recipientUid', '==', uid).get()).docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>))
  const converted = async () => (await db.collection('auditLogs').where('action', '==', 'plan.trialConverted').get()).docs.map((d) => d.data())
  // 2026-10-23 09:00 in Seoul: two days left.
  const ENDING = 2

  it('clears the trial when the first paid month starts, with one audit entry and no notice', async () => {
    await seedTrial(ENDING)
    const { pushes, deps } = fakes()
    expect((await pollSubscriptions(deps(entitled({ periodType: 'normal' })))).renewed).toBe(1)
    const payment = (await plan()).payment
    expect(payment.periodType).toBe('normal')
    expect(payment.trialEndsAt).toBeNull()
    expect(payment.expiresAt.toMillis()).toBe(at(50).getTime())
    expect(await row()).toMatchObject({ periodType: 'normal', trialEndsAt: null })
    expect(await converted()).toEqual([expect.objectContaining({
      patientUid: 'p1', actorUid: 'cg1', action: 'plan.trialConverted',
      details: expect.objectContaining({ tier: 'plus', periodType: 'normal' }),
    })])

    // Polling again converts nothing twice.
    await pollSubscriptions(deps(entitled({ periodType: 'normal' })))
    expect(await converted()).toHaveLength(1)
    expect(await notices('cg1')).toEqual([])
    expect(pushes).toEqual([])
  })

  it('reminds the payer once in the last three days, with a push, never the parent', async () => {
    await seedTrial(ENDING)
    const { pushes, deps } = fakes()
    const trial = entitled({ periodType: 'trial', expiresAt: at(ENDING) })
    await pollSubscriptions(deps(trial))
    await pollSubscriptions(deps(trial, new Date(now.getTime() + 6 * 3600_000)))
    const sent = await notices('cg1')
    expect(sent).toEqual([expect.objectContaining({
      id: 'plan_trial_ending_cg1_p1_20261023',
      patientUid: 'p1',
      type: 'plan.trialEnding',
      message: '어머니 Plus 무료 체험이 10월 23일에 끝나요. 그대로 두시면 그날부터 매월 ₩4,400이 결제돼요. 계속하지 않으시려면 스토어에서 해지해 주세요.',
    })])
    expect(pushes).toHaveLength(1)
    expect(pushes[0]).toMatchObject({ uids: ['cg1'], message: { body: sent[0].message, data: { type: 'plan.trialEnding', patientUid: 'p1' } } })
    expect(await notices('p1')).toEqual([])
    // Still on the trial: nothing converted.
    expect(await converted()).toEqual([])
    expect((await plan()).payment.periodType).toBe('trial')
  })

  it('says nothing while more than three days are left', async () => {
    await seedTrial(10)
    const { pushes, deps } = fakes()
    await pollSubscriptions(deps(entitled({ periodType: 'trial', expiresAt: at(10) })))
    expect(await notices('cg1')).toEqual([])
    expect(pushes).toEqual([])
  })

  it('sends no reminder once the trial has turned into a paid month', async () => {
    await seedTrial(ENDING)
    const { pushes, deps } = fakes()
    await pollSubscriptions(deps(entitled({ periodType: 'normal', expiresAt: at(ENDING + 30) })))
    expect(await notices('cg1')).toEqual([])
    expect(pushes).toEqual([])
  })

  it('records the trial but reminds nobody while planNudges is off', async () => {
    await seedTrial(ENDING)
    const { pushes, deps } = fakes({ pushFamily: true })
    await pollSubscriptions(deps(entitled({ periodType: 'trial', expiresAt: at(ENDING) })))
    expect(await notices('cg1')).toEqual([])
    expect(pushes).toEqual([])
    expect((await plan()).payment.trialEndsAt.toMillis()).toBe(at(ENDING).getTime())
  })

  it('tells the payer when the trial ran out unpaid, and marks the audit entry', async () => {
    await seedTrial(-1)
    const { pushes, deps } = fakes()
    expect((await pollSubscriptions(deps(entitled({ periodType: 'trial', expiresAt: at(-1) })))).ended).toBe(1)
    expect((await plan()).tier).toBe('free')
    expect(await notices('cg1')).toEqual([expect.objectContaining({
      id: 'plan_trial_ended_cg1_p1_20261020',
      type: 'plan.trialEnded',
      patientUid: 'p1',
      message: '어머니 Plus 체험이 끝나 Free로 돌아왔어요. 다시 시작하시려면 설정 › 부모님께 드리는 선물에서 고르실 수 있어요.',
    })])
    expect(pushes).toEqual([])
    expect(await notices('p1')).toEqual([])
    expect(await planChanges()).toEqual([expect.objectContaining({ details: expect.objectContaining({ refunded: false, trial: true }) })])
  })

  it('says nothing when a paid month ends, or a trial is refunded', async () => {
    await seedPaid()
    const { deps } = fakes()
    await pollSubscriptions(deps(entitled({ periodType: 'normal', expiresAt: at(-1) })))
    expect((await plan()).tier).toBe('free')
    expect(await planChanges()).toEqual([expect.objectContaining({ details: expect.objectContaining({ trial: false }) })])

    await seedTrial(5)
    await pollSubscriptions(deps(entitled({ periodType: 'trial', expiresAt: at(5), refunded: true })))
    expect((await plan()).tier).toBe('free')
    expect(await notices('cg1')).toEqual([])
  })
})
