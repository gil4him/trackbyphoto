// Plans: changing one, the family-member count, and the two notices that go
// with them. Firestore is the emulator; payments are the stand-in or a fake.
// Plan contents below are made up for the tests.

import { describe, it, expect, beforeEach } from 'vitest'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { acceptInvite, createInvite } from '../src/handlers/caregiver'
import { INVITE_PROMPT_MESSAGE, invitePrompt, nextTierWithRoom } from '../src/handlers/family'
import { changePlan } from '../src/handlers/plan'
import { HANDLERS, processRequest } from '../src/handlers/requests'
import { paymentProvider, stubPayments, type PaymentRequest } from '../src/payments/index'
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
    expect(await changePlan(as('cg1'), { patientUid: 'p1', tier: 'basic' })).toEqual({ tier: 'basic', changed: true, unlockedVoices: 0 })
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
    expect(await changePlan(as('cg1'), { patientUid: 'p1', tier: 'basic' })).toEqual({ tier: 'basic', changed: false, unlockedVoices: 0 })
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
