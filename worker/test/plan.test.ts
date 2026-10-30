// Plans: changing one, the family-member count, and the two notices that go
// with them. Firestore is the emulator; payments are the stand-in or a fake.
// Plan contents below are made up for the tests.

import { describe, it, expect, beforeEach } from 'vitest'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { acceptInvite, createInvite } from '../src/handlers/caregiver'
import { INVITE_PROMPT_MESSAGE, invitePrompt, nextTierWithRoom } from '../src/handlers/family'
import { changePlan } from '../src/handlers/plan'
import { HANDLERS, processRequest } from '../src/handlers/requests'
import { paymentProvider, stubPayments, type PaymentRequest, type PaymentResult } from '../src/payments/index'
import { getPlans, offeredTiers, resetPlansCache, type PlansDoc } from '../src/plans'
import { db, clearFirestore, seedMembership, count } from './setup'

const tier = (o: Record<string, unknown> = {}) => ({
  familyMembers: 1, retentionDays: null, messenger: false, weekly: false, checkin: false, recap: false,
  voiceReplies: false, voiceAlbum: false, aiPhotosPerDay: null, seniors: 1, ...o,
})
const PLANS = {
  free: tier(),
  basic: tier({ familyMembers: 2, voiceReplies: true }),
  plus: tier({ familyMembers: 2, voiceReplies: true }),
  family: tier({ familyMembers: 4, voiceReplies: true, voiceAlbum: true }),
  fairUse: { photosPerDay: null },
}
async function plans(flags: Record<string, boolean> = { planSheet: true, voiceReplies: true }) {
  await db.doc('admin_config/plans').set({ ...PLANS, flags })
  resetPlansCache()
}

const as = (uid: string, name = '민수') => ({ uid, email: `${uid}@example.com`, name })
const user = async (uid = 'p1') => (await db.doc(`users/${uid}`).get()).data()!
const notices = async (recipientUid: string) =>
  (await db.collection('notifications').where('recipientUid', '==', recipientUid).get()).docs.map((d) => d.data())
const voice = (id: string, extra: Record<string, unknown> = {}) => db.doc(`reactions/${id}`).set({
  memoId: 'm1', patientUid: 'p1', actorUid: 'p1', kind: 'voice', status: 'ready', notified: true, createdAt: Timestamp.now(), ...extra,
})
const fails = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected a refusal') }, (err) => err as { code: string; details?: Record<string, unknown> })

beforeEach(async () => {
  await clearFirestore()
  await plans()
  // A managed parent with the child who registered her.
  await db.doc('users/p1').set({ patientName: '어머니', accountType: 'managed' })
  await seedMembership('p1', 'cg1', { role: 'guardian' })
})

describe('changePlan', () => {
  it('puts the parent on the plan, says who did it, and writes an audit entry', async () => {
    expect(await changePlan(as('cg1'), { patientUid: 'p1', tier: 'basic' })).toEqual({ tier: 'basic', changed: true, unlockedVoices: 0, trialEndsAt: null })
    const plan = (await user()).plan
    expect(plan).toMatchObject({ tier: 'basic', status: 'active', changedBy: 'cg1', payment: { provider: 'stub' } })
    expect(plan.since).toBeInstanceOf(Timestamp)
    const log = (await db.collection('auditLogs').where('action', '==', 'plan.change').get()).docs.map((d) => d.data())
    expect(log).toEqual([expect.objectContaining({ patientUid: 'p1', actorUid: 'cg1', details: { from: 'free', to: 'basic', provider: 'stub', source: 'unknown' } })])
  })

  it('notes which of the sheet\'s doors the change came through', async () => {
    await changePlan(as('cg1'), { patientUid: 'p1', tier: 'basic', source: 'voice' })
    await changePlan(as('cg1'), { patientUid: 'p1', tier: 'plus', source: 'somewhere else' })
    const sources = (await db.collection('auditLogs').where('action', '==', 'plan.change').get()).docs.map((d) => d.data().details).sort((a, b) => a.to.localeCompare(b.to)).map((d) => d.source)
    expect(sources).toEqual(['voice', 'unknown'])
  })

  it('never tells the parent', async () => {
    await voice('v1')
    await changePlan(as('cg1'), { patientUid: 'p1', tier: 'basic' })
    expect(await notices('p1')).toEqual([])
  })

  it('is refused for a viewer, a stranger, and the parent\'s own linked phone', async () => {
    await seedMembership('p1', 'viewer', { role: 'viewer' })
    for (const uid of ['viewer', 'stranger', 'p1']) {
      expect((await fails(changePlan(as(uid), { patientUid: 'p1', tier: 'basic' }))).code).toBe('permission-denied')
    }
    expect((await user()).plan).toBeUndefined()
  })

  it('lets someone change the plan of their own self-managed account', async () => {
    await db.doc('users/solo').set({ patientName: '승희' })
    expect((await changePlan(as('solo'), { patientUid: 'solo', tier: 'plus' })).changed).toBe(true)
    expect((await user('solo')).plan.tier).toBe('plus')
  })

  it('is closed until plan changes are switched on', async () => {
    await plans({ planSheet: false })
    expect((await fails(changePlan(as('cg1'), { patientUid: 'p1', tier: 'basic' }))).code).toBe('failed-precondition')
    expect((await user()).plan).toBeUndefined()
  })

  it('rejects a plan that does not exist', async () => {
    expect((await fails(changePlan(as('cg1'), { patientUid: 'p1', tier: 'gold' }))).code).toBe('invalid-argument')
    expect((await fails(changePlan(as('cg1'), { tier: 'basic' }))).code).toBe('invalid-argument')
  })

  it('does nothing when the parent is already on that plan', async () => {
    await changePlan(as('cg1'), { patientUid: 'p1', tier: 'basic' })
    expect(await changePlan(as('cg1'), { patientUid: 'p1', tier: 'basic' })).toEqual({ tier: 'basic', changed: false, unlockedVoices: 0, trialEndsAt: null })
    expect(await count('auditLogs', 'action', 'plan.change')).toBe(1)
  })

  it('changes nothing when the payment does not go through', async () => {
    const seen: PaymentRequest[] = []
    const payments = { name: 'fake', confirm: async (req: PaymentRequest) => { seen.push(req); return { ok: false, provider: 'fake', reason: 'card declined' } } }
    expect((await fails(changePlan(as('cg1'), { patientUid: 'p1', tier: 'basic', paymentToken: 'tok_1' }, { payments }))).code).toBe('payment-failed')
    expect(seen).toEqual([{ payerUid: 'cg1', patientUid: 'p1', from: 'free', to: 'basic', token: 'tok_1' }])
    expect((await user()).plan).toBeUndefined()
    expect(await count('auditLogs', 'action', 'plan.change')).toBe(0)
  })

  it('keeps the payment reference a real provider returns', async () => {
    const payments = { name: 'fake', confirm: async () => ({ ok: true, provider: 'fake', reference: 'pay_123' }) }
    await changePlan(as('cg1'), { patientUid: 'p1', tier: 'basic' }, { payments })
    expect((await user()).plan.payment).toEqual({ provider: 'fake', reference: 'pay_123' })
  })

  it('charges nothing by default, and refuses a provider that is not set up', async () => {
    expect(await stubPayments.confirm({ payerUid: 'a', patientUid: 'b', from: 'free', to: 'basic', token: null })).toEqual({ ok: true, provider: 'stub' })
    process.env.PAYMENT_PROVIDER = 'toss'
    try {
      expect((await paymentProvider().confirm({ payerUid: 'a', patientUid: 'b', from: 'free', to: 'basic', token: null })).ok).toBe(false)
    } finally {
      delete process.env.PAYMENT_PROVIDER
    }
    expect(paymentProvider().name).toBe('stub')
  })

  it('runs through the request queue and is on the allow-list', async () => {
    expect(HANDLERS.changePlan).toBeDefined()
    await db.doc('requests/r1').set({ type: 'changePlan', uid: 'cg1', email: null, name: '민수', payload: { patientUid: 'p1', tier: 'basic' }, status: 'pending' })
    await processRequest('r1')
    expect((await db.doc('requests/r1').get()).data()).toMatchObject({ status: 'done', result: { tier: 'basic', changed: true } })
  })
})

// The store app buys a subscription; the worker believes RevenueCat, not the
// app. Here a fake provider stands in for RevenueCat's answer.
describe('paying for a plan through the store', () => {
  const PRODUCT = 'daylie_plus_monthly'
  const DAY = 24 * 3600 * 1000
  const future = () => new Date(Date.now() + 20 * DAY)
  const store = (res: Partial<PaymentResult> = {}, seen: PaymentRequest[] = []) => ({
    name: 'revenuecat',
    confirm: async (req: PaymentRequest): Promise<PaymentResult> => {
      seen.push(req)
      // Free is never a store product, as with the real provider.
      if (req.to === 'free') return { ok: true, provider: 'revenuecat' }
      return { ok: true, provider: 'revenuecat', reference: PRODUCT, productId: PRODUCT, expiresAt: future(), ...res }
    },
  })
  /** Charging switched on, as it is once the stores are live. */
  const live = () => plans({ planSheet: true, voiceReplies: true, payments: true })
  const refused = async (p: Promise<unknown>) => {
    const err = await fails(p) as { code: string; message: string }
    return [err.code, err.message]
  }
  const row = async (payerUid = 'cg1') => (await db.doc(`planPayments/${payerUid}`).get()).data()
  const secondParent = async () => {
    await db.doc('users/p2').set({ patientName: '아버지', accountType: 'managed' })
    await seedMembership('p2', 'cg1', { role: 'guardian' })
  }

  it('charges nothing and records no purchase until payments are switched on', async () => {
    expect((await changePlan(as('cg1'), { patientUid: 'p1', tier: 'plus' })).changed).toBe(true)
    expect((await user()).plan.payment).toEqual({ provider: 'stub' })
    expect((await db.collection('planPayments').get()).size).toBe(0)
  })

  it('writes what the store charges for, on the plan and on the payer\'s own row', async () => {
    await live()
    const seen: PaymentRequest[] = []
    expect(await changePlan(as('cg1'), { patientUid: 'p1', tier: 'plus', paymentToken: 'cg1' }, { payments: store({}, seen) }))
      .toEqual({ tier: 'plus', changed: true, unlockedVoices: 0, trialEndsAt: null })

    const plan = (await user()).plan
    expect(plan).toMatchObject({ tier: 'plus', status: 'active', changedBy: 'cg1' })
    expect(plan.payment).toMatchObject({ provider: 'revenuecat', reference: PRODUCT, payerUid: 'cg1' })
    expect(plan.payment.expiresAt).toBeInstanceOf(Timestamp)
    expect(await row()).toMatchObject({ patientUid: 'p1', tier: 'plus', productId: PRODUCT })
    expect((await row())!.expiresAt.toMillis()).toBe(plan.payment.expiresAt.toMillis())
    // The lookup goes by the caller's own uid; the token is only proof the
    // app really went to the store.
    expect(seen).toEqual([{ payerUid: 'cg1', patientUid: 'p1', from: 'free', to: 'plus', token: 'cg1' }])
  })

  it('refuses a plan the store does not back', async () => {
    await live()
    expect(await refused(changePlan(as('cg1'), { patientUid: 'p1', tier: 'plus', paymentToken: 'cg1' }, { payments: store({ ok: false, reason: 'not entitled' }) })))
      .toEqual(['payment-failed', 'not entitled'])
    expect((await user()).plan).toBeUndefined()
    expect(await row()).toBeUndefined()
  })

  it('refuses a paid plan the app never took to the store', async () => {
    await live()
    expect((await fails(changePlan(as('cg1'), { patientUid: 'p1', tier: 'plus' }, { payments: store() }))).code).toBe('invalid-argument')
    // Free needs no purchase.
    expect((await changePlan(as('cg1'), { patientUid: 'p1', tier: 'free' }, { payments: store() })).changed).toBe(true)
  })

  it('does not let one subscription pay for a second parent', async () => {
    await live()
    await secondParent()
    await changePlan(as('cg1'), { patientUid: 'p1', tier: 'plus', paymentToken: 'cg1' }, { payments: store() })
    expect(await refused(changePlan(as('cg1'), { patientUid: 'p2', tier: 'plus', paymentToken: 'cg1' }, { payments: store() })))
      .toEqual(['failed-precondition', 'subscription used for another parent'])
    expect((await user('p2')).plan).toBeUndefined()
    expect(await row()).toMatchObject({ patientUid: 'p1' })
  })

  it('does let them buy for another parent once the first is back on Free', async () => {
    await live()
    await secondParent()
    // What the poll leaves behind for a moment: a row whose parent is on Free.
    await db.doc('planPayments/cg1').set({ patientUid: 'p1', tier: 'plus', productId: PRODUCT, expiresAt: Timestamp.fromMillis(Date.now() - DAY) })
    expect((await changePlan(as('cg1'), { patientUid: 'p2', tier: 'plus', paymentToken: 'cg1' }, { payments: store() })).changed).toBe(true)
    expect(await row()).toMatchObject({ patientUid: 'p2', tier: 'plus' })
  })

  it('leaves a parent somebody else is paying for alone', async () => {
    await live()
    await seedMembership('p1', 'cg2', { role: 'admin' })
    await db.doc('users/p1').update({
      plan: { tier: 'plus', status: 'active', changedBy: 'cg2', payment: { provider: 'revenuecat', reference: PRODUCT, payerUid: 'cg2', expiresAt: Timestamp.fromDate(future()) } },
    })
    for (const tier of ['family', 'free']) {
      expect(await refused(changePlan(as('cg1'), { patientUid: 'p1', tier, paymentToken: 'cg1' }, { payments: store() })))
        .toEqual(['failed-precondition', 'parent paid by another'])
    }
    expect((await user()).plan.tier).toBe('plus')
  })

  it('sends a family who want to stop to the store, and waits for it', async () => {
    await live()
    await changePlan(as('cg1'), { patientUid: 'p1', tier: 'plus', paymentToken: 'cg1' }, { payments: store() })
    expect(await refused(changePlan(as('cg1'), { patientUid: 'p1', tier: 'free' }, { payments: store() })))
      .toEqual(['failed-precondition', 'cancel in store'])
    expect((await user()).plan.tier).toBe('plus')
    expect(await row()).toMatchObject({ patientUid: 'p1' })
  })

  it('takes Free once the subscription has run out, and clears the row', async () => {
    await live()
    await changePlan(as('cg1'), { patientUid: 'p1', tier: 'plus', paymentToken: 'cg1' }, { payments: store({ expiresAt: new Date(Date.now() - DAY) }) })
    expect((await changePlan(as('cg1'), { patientUid: 'p1', tier: 'free' }, { payments: store() })).changed).toBe(true)
    expect((await user()).plan).toMatchObject({ tier: 'free', payment: { provider: 'revenuecat' } })
    expect(await row()).toBeUndefined()
  })

  it('counts the same purchase once, however often the app asks', async () => {
    await live()
    await changePlan(as('cg1'), { patientUid: 'p1', tier: 'plus', paymentToken: 'cg1' }, { payments: store() })
    expect(await changePlan(as('cg1'), { patientUid: 'p1', tier: 'plus', paymentToken: 'cg1' }, { payments: store() }))
      .toEqual({ tier: 'plus', changed: false, unlockedVoices: 0, trialEndsAt: null })
    expect(await count('auditLogs', 'action', 'plan.change')).toBe(1)
  })

  it('opens the sheet to a listed family member while it is still closed to everyone else', async () => {
    await db.doc('admin_config/plans').set({ ...PLANS, flags: { planSheet: false, voiceReplies: true }, planSheetAllow: ['cg1'] })
    resetPlansCache()
    expect((await changePlan(as('cg1'), { patientUid: 'p1', tier: 'plus' })).changed).toBe(true)

    await db.doc('users/solo').set({ patientName: '승희' })
    expect(await refused(changePlan(as('solo'), { patientUid: 'solo', tier: 'plus' })))
      .toEqual(['failed-precondition', 'plan changes are not open yet'])
    expect((await user('solo')).plan).toBeUndefined()
  })
})

// The store's 2-week free trial on Plus and Family (owner decision,
// 2026-10-28): recorded on the plan, and only the payer is told.
describe('a purchase that starts the free trial', () => {
  const PRODUCT = 'daylie_plus_monthly'
  // 2026-11-11 09:00 in Seoul.
  const ENDS = new Date('2026-11-11T00:00:00Z')
  const store = (res: Partial<PaymentResult> = {}) => ({
    name: 'revenuecat',
    confirm: async (req: PaymentRequest): Promise<PaymentResult> => {
      if (req.to === 'free') return { ok: true, provider: 'revenuecat' }
      return { ok: true, provider: 'revenuecat', reference: PRODUCT, productId: PRODUCT, expiresAt: ENDS, periodType: 'trial', ...res }
    },
  })
  async function priced(flags: Record<string, boolean> = { planSheet: true, payments: true, planNudges: true }) {
    await db.doc('admin_config/plans').set({
      ...PLANS,
      plus: { ...PLANS.plus, priceLabel: '₩4,400/월' },
      family: { ...PLANS.family, priceLabel: '₩7,700/월' },
      flags,
    })
    resetPlansCache()
  }
  const buy = (payments = store()) => changePlan(as('cg1'), { patientUid: 'p1', tier: 'plus', paymentToken: 'cg1' }, { payments })
  const row = async () => (await db.doc('planPayments/cg1').get()).data()!

  it('records the trial and when it ends on the plan and the payer\'s row, and returns it', async () => {
    await priced()
    expect(await buy()).toEqual({ tier: 'plus', changed: true, unlockedVoices: 0, trialEndsAt: ENDS.getTime() })
    const payment = (await user()).plan.payment
    expect(payment.periodType).toBe('trial')
    expect(payment.trialEndsAt.toMillis()).toBe(ENDS.getTime())
    expect(payment.expiresAt.toMillis()).toBe(ENDS.getTime())
    expect((await row()).periodType).toBe('trial')
    expect((await row()).trialEndsAt.toMillis()).toBe(ENDS.getTime())
  })

  it('tells the payer once that the trial started, and never the parent', async () => {
    await priced()
    await seedMembership('p1', 'cg2', { role: 'viewer' })
    await buy()
    expect(await notices('cg1')).toEqual([expect.objectContaining({
      recipientUid: 'cg1',
      patientUid: 'p1',
      type: 'plan.trialStarted',
      message: '어머니 Plus 무료 체험을 시작했어요. 11월 11일부터 매월 ₩4,400이 결제돼요. 체험 중 그만두시려면 스토어에서 해지해 주세요.',
      read: false,
    })])
    expect((await db.doc('notifications/plan_trial_start_cg1_p1').get()).exists).toBe(true)
    expect(await notices('p1')).toEqual([])
    expect(await notices('cg2')).toEqual([])

    // Back to Free once it ended, then the trial again: still the one notice.
    await db.doc('planPayments/cg1').delete()
    await db.doc('users/p1').update({ plan: { tier: 'free', status: 'active' } })
    await buy()
    expect(await notices('cg1')).toHaveLength(1)
  })

  it('addresses the parent as the app does, and in English for an English account', async () => {
    await priced()
    await db.doc('users/p1').update({ patientName: '영희' })
    await buy()
    expect((await notices('cg1'))[0].message).toMatch(/^영희님 Plus 무료 체험을 시작했어요\./)

    await clearFirestore()
    await priced()
    await db.doc('users/p1').set({ patientName: '영희님', accountType: 'managed' })
    await db.doc('users/cg1').set({ geoLang: 'en' })
    await seedMembership('p1', 'cg1', { role: 'guardian' })
    await buy()
    expect((await notices('cg1'))[0].message).toBe("Your Plus free trial for 영희 has started. From November 11 you'll be billed ₩4,400 a month. To stop during the trial, cancel in the store.")

    // No name on file: 부모님 in Korean, "your parent" in English (never "부모").
    await clearFirestore()
    await priced()
    await db.doc('users/p1').set({ accountType: 'managed' })
    await db.doc('users/cg1').set({ geoLang: 'en' })
    await seedMembership('p1', 'cg1', { role: 'guardian' })
    await buy()
    expect((await notices('cg1'))[0].message).toMatch(/^Your Plus free trial for your parent has started\./)
  })

  it('records the trial but tells nobody while planNudges is off', async () => {
    await priced({ planSheet: true, payments: true })
    expect((await buy()).trialEndsAt).toBe(ENDS.getTime())
    expect((await user()).plan.payment.periodType).toBe('trial')
    expect(await notices('cg1')).toEqual([])
  })

  it('records a paid purchase as normal, with no trial and no notice', async () => {
    await priced()
    expect((await buy(store({ periodType: 'normal' }))).trialEndsAt).toBeNull()
    const payment = (await user()).plan.payment
    expect(payment.periodType).toBe('normal')
    expect(payment.trialEndsAt).toBeNull()
    expect((await row()).trialEndsAt).toBeNull()
    expect(await notices('cg1')).toEqual([])
  })
})

describe('voice replies opening with the plan', () => {
  it('tells each family member once how many earlier replies opened', async () => {
    await seedMembership('p1', 'cg2', { role: 'viewer' })
    await seedMembership('p1', 'gone', { status: 'revoked' })
    await voice('v1'); await voice('v2'); await voice('v3')
    await voice('stillPending', { status: 'pending' })
    await db.doc('reactions/heart').set({ memoId: 'm1', patientUid: 'p1', actorUid: 'p1', kind: 'heart', status: 'ready', createdAt: Timestamp.now() })

    expect((await changePlan(as('cg1'), { patientUid: 'p1', tier: 'basic' })).unlockedVoices).toBe(3)
    for (const uid of ['cg1', 'cg2']) {
      expect(await notices(uid)).toEqual([expect.objectContaining({ type: 'voice.unlocked', message: '어머니님의 지난 음성 답장 3개가 열렸어요', patientUid: 'p1', read: false })])
    }
    expect(await notices('gone')).toEqual([])
  })

  it('is said once, however often the plan changes afterwards', async () => {
    await voice('v1')
    await changePlan(as('cg1'), { patientUid: 'p1', tier: 'basic' })
    await changePlan(as('cg1'), { patientUid: 'p1', tier: 'free' })
    await voice('v2')
    await changePlan(as('cg1'), { patientUid: 'p1', tier: 'family' })
    expect((await notices('cg1')).filter((n) => n.type === 'voice.unlocked')).toHaveLength(1)
  })

  it('says nothing when there were no replies, or when both plans include voice', async () => {
    await changePlan(as('cg1'), { patientUid: 'p1', tier: 'basic' })
    await voice('v1')
    await changePlan(as('cg1'), { patientUid: 'p1', tier: 'family' })
    expect(await notices('cg1')).toEqual([])
  })
})

describe('family members and the plan', () => {
  it('refuses an invite past the plan\'s count and names the plan that has room', async () => {
    const err = await fails(createInvite(as('cg1'), { patientUid: 'p1', role: 'admin' }))
    expect(err.code).toBe('plan-limit')
    expect(err.details).toEqual({ limit: 1, tier: 'free', nextTier: 'basic' })
    expect((await db.collection('invites').get()).size).toBe(0)
    expect((await db.collection('consents').get()).size).toBe(0)
  })

  it('carries the details back to the app through the request queue', async () => {
    await db.doc('requests/r1').set({ type: 'createInvite', uid: 'cg1', email: null, name: '민수', payload: { patientUid: 'p1', role: 'admin' }, status: 'pending' })
    await processRequest('r1')
    expect((await db.doc('requests/r1').get()).data()).toMatchObject({ status: 'error', code: 'plan-limit', details: { limit: 1, tier: 'free', nextTier: 'basic' } })
  })

  it('lets the invite through once the plan has room', async () => {
    await changePlan(as('cg1'), { patientUid: 'p1', tier: 'basic' })
    const res = await createInvite(as('cg1'), { patientUid: 'p1', role: 'admin' })
    expect(res.code).toMatch(/^\d{6}$/)
  })

  it('skips to the plan that really has room, and says so when none has', async () => {
    const table = (await getPlans()) as PlansDoc
    expect(nextTierWithRoom(table, 'free', 1)).toBe('basic')
    expect(nextTierWithRoom(table, 'basic', 2)).toBe('family') // plus has no more room than basic here
    expect(nextTierWithRoom(table, 'family', 4)).toBeNull()
  })

  describe('when the table offers three plans (no Basic)', () => {
    const threePlans = async () => {
      await db.doc('admin_config/plans').update({ basic: FieldValue.delete(), plus: tier({ familyMembers: 3 }) })
      resetPlansCache()
    }

    it('lists only the plans in the table', async () => {
      await threePlans()
      expect(offeredTiers((await getPlans()) as PlansDoc)).toEqual(['free', 'plus', 'family'])
    })

    it('an invite past Free\'s count points at Plus', async () => {
      await threePlans()
      const err = await fails(createInvite(as('cg1'), { patientUid: 'p1', role: 'admin' }))
      expect(err.details).toEqual({ limit: 1, tier: 'free', nextTier: 'plus' })
    })

    it('nobody can be put on the plan that is gone', async () => {
      await threePlans()
      expect((await fails(changePlan(as('cg1'), { patientUid: 'p1', tier: 'basic' }))).code).toBe('failed-precondition')
      expect((await changePlan(as('cg1'), { patientUid: 'p1', tier: 'plus' })).changed).toBe(true)
    })

    it('an account still on it is not held to any family count', async () => {
      await db.doc('users/p1').update({ plan: { tier: 'basic', status: 'active' } })
      await threePlans()
      const res = await createInvite(as('cg1'), { patientUid: 'p1', role: 'admin' })
      expect(res.code).toMatch(/^\d{6}$/)
    })
  })

  it('does not count family who left, and never removes family who already joined', async () => {
    await seedMembership('p1', 'left', { status: 'revoked' })
    await seedMembership('p1', 'cg2')
    await seedMembership('p1', 'cg3')
    // Three on a plan for one: all stay, but nobody new can be invited.
    expect((await fails(createInvite(as('cg1'), { patientUid: 'p1' }))).details).toMatchObject({ limit: 1, nextTier: 'family' })
    expect((await db.collection('memberships').where('patientUid', '==', 'p1').where('status', '==', 'active').get()).size).toBe(3)
  })

  it('checks again when the invite is accepted', async () => {
    await changePlan(as('cg1'), { patientUid: 'p1', tier: 'basic' })
    const first = await createInvite(as('cg1'), { patientUid: 'p1', role: 'admin' })
    const second = await createInvite(as('cg1'), { patientUid: 'p1', role: 'admin' })
    await acceptInvite(as('sis', '지은'), { code: first.code })
    const err = await fails(acceptInvite(as('bro', '지훈'), { code: second.code }))
    expect(err.code).toBe('plan-limit')
    expect((await db.doc('memberships/p1_bro').get()).exists).toBe(false)
    expect((await db.doc(`invites/${second.code}`).get()).data()!.used).toBe(false)
  })

  it('has no limit until plan limits are switched on', async () => {
    await plans({ planSheet: false })
    await seedMembership('p1', 'cg2')
    expect((await createInvite(as('cg1'), { patientUid: 'p1' })).code).toMatch(/^\d{6}$/)
  })
})

describe('suggesting a sibling', () => {
  const DAY = 24 * 3600 * 1000
  const t0 = new Date('2026-10-03T11:05:00Z')
  const after = (days: number) => new Date(t0.getTime() + days * DAY)
  const prompt = async (now: Date, tierName: 'free' | 'basic' = 'free') =>
    invitePrompt({ patientUid: 'p1', plans: (await getPlans()) as PlansDoc, tier: tierName, now })

  it('comes two weeks after the first digest, once', async () => {
    expect(await prompt(t0)).toBe(0)          // the first digest: start counting
    expect(await prompt(after(13))).toBe(0)
    expect(await prompt(after(14))).toBe(1)
    expect(await prompt(after(15))).toBe(0)
    expect(await prompt(after(40))).toBe(0)
    expect(await notices('cg1')).toEqual([expect.objectContaining({ type: 'family.invite_prompt', message: INVITE_PROMPT_MESSAGE, patientUid: 'p1' })])
    expect(await notices('p1')).toEqual([])
  })

  it('is not sent on a paid plan, or when a sibling already joined', async () => {
    await prompt(t0)
    expect(await prompt(after(14), 'basic')).toBe(0)
    await seedMembership('p1', 'cg2')
    expect(await prompt(after(15))).toBe(0)
    expect((await db.collection('notifications').get()).size).toBe(0)
    // Asked and answered: it does not come later either.
    await db.doc('memberships/p1_cg2').delete()
    expect(await prompt(after(30))).toBe(0)
  })

  it('is not sent to someone who cannot invite, or while the plan sheet is off', async () => {
    await db.doc('memberships/p1_cg1').update({ role: 'viewer' })
    await prompt(t0)
    expect(await prompt(after(14))).toBe(0)

    await clearFirestore()
    await plans({ planSheet: false })
    await seedMembership('p1', 'cg1', { role: 'guardian' })
    await prompt(t0)
    expect(await prompt(after(14))).toBe(0)
    expect((await db.collection('notifications').get()).size).toBe(0)
  })
})
