// Invisible daily limits and nightly retention. Storage, geocoding and Ollama
// are injected fakes; Firestore is the emulator. The plan numbers below are
// made up for the tests; the real table lives in admin_config/plans.

import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { processMemo, type MemoDeps } from '../src/handlers/memo'
import { allowAi, dayKey } from '../src/handlers/usage'
import { expiringMessage, runRetention, type RetentionDeps } from '../src/handlers/retention'
import { LlmGenerationError } from '../src/llm/ollama'
import { resetPlansCache, type PlansDoc } from '../src/plans'
import { resetHomeCache } from '../src/travel'
import { db, clearFirestore, seedMembership, count } from './setup'

const DAY = 24 * 3600 * 1000
const tier = (retentionDays: number | null, aiPhotosPerDay: number | null) => ({
  familyMembers: 1, retentionDays, messenger: false, weekly: false, checkin: false, recap: false,
  voiceReplies: false, voiceAlbum: false, aiPhotosPerDay, seniors: 1,
})
const PLANS = {
  free: tier(10, 2),
  basic: tier(45, null),
  plus: tier(730, null),
  family: tier(null, null),
  fairUse: { photosPerDay: 5 },
} as unknown as PlansDoc

async function plans(flags: Record<string, boolean>, overrides: Record<string, unknown> = {}) {
  await db.doc('admin_config/plans').set({ ...PLANS, ...overrides, flags })
  resetPlansCache()
}
const patient = (uid: string, planTier?: string, sinceDaysAgo = 60) =>
  db.doc(`users/${uid}`).set({
    patientName: '어머니',
    ...(planTier ? { plan: { tier: planTier, status: 'active', since: Timestamp.fromMillis(Date.now() - sinceDaysAgo * DAY) } } : {}),
  })

function deps(overrides: Partial<MemoDeps> = {}): MemoDeps & { generateCalls: number } {
  const d = {
    generateCalls: 0,
    loadPhoto: async () => ({ photoUrl: 'https://example.test/p.jpg?token=t', base64: async () => 'aGk=' }),
    geocode: async () => ({ place: '서초동, 서초구', address: '서울특별시 서초구 서초대로 1' }),
    generate: async () => {
      d.generateCalls++
      return {
        activity: '산책', memo: '공원에서 산책 중이세요.', scene: '나무 사이를 걷고 계세요.',
        model: 'gemma4:e4b', cost: { promptTokens: 1200, outputTokens: 50, totalUSD: 0 },
      }
    },
    push: async () => {},
    ...overrides,
  }
  return d
}

async function seedPending(id: string, extra: Record<string, unknown> = {}) {
  await db.doc(`memos/${id}`).set({
    patientUid: 'p1', photoPath: `photos/p1/${id}.jpg`, photoUrl: '',
    takenAt: Timestamp.now(), lat: 37.48, lng: 127.01,
    place: '', activity: '기타', memo: '', scene: '', status: 'pending', createdAt: Timestamp.now(),
    ...extra,
  })
}
const memo = async (id: string) => (await db.doc(`memos/${id}`).get()).data()!
const counters = async (uid = 'p1') => (await db.doc(`users/${uid}`).get()).data()?.dayCounters ?? {}
const todayKst = () => dayKey(new Date(), 540)

/** Take `n` photos one after another, as the scheduler would. */
async function take(n: number, d: MemoDeps, prefix = 'm') {
  for (let i = 1; i <= n; i++) {
    await seedPending(`${prefix}${i}`)
    expect(await processMemo(`${prefix}${i}`, 1, d)).toBe('done')
  }
}
const sources = async (n: number, prefix = 'm') =>
  Promise.all(Array.from({ length: n }, async (_, i) => (await memo(`${prefix}${i + 1}`)).memoSource))

beforeEach(async () => {
  await clearFirestore()
  resetPlansCache()
  resetHomeCache()
})

describe('daily limits', () => {
  it('counts the day on the given clock', () => {
    expect(dayKey(new Date('2026-10-04T16:30:00Z'), 540)).toBe('20261005')
    expect(dayKey(new Date('2026-10-04T16:30:00Z'), -420)).toBe('20261004')
  })

  it('applies no limit while the switch is off', () => {
    expect(allowAi({ ...PLANS, flags: {} } as PlansDoc, 'free', 99, 99)).toBe(true)
    expect(allowAi(null, 'free', 99, 99)).toBe(true)
    expect(allowAi({ ...PLANS, flags: { usageCaps: true } } as PlansDoc, 'free', 3, 2)).toBe(false)
    expect(allowAi({ ...PLANS, flags: { usageCaps: true } } as PlansDoc, 'plus', 5, 4)).toBe(true)
    expect(allowAi({ ...PLANS, flags: { usageCaps: true } } as PlansDoc, 'plus', 6, 5)).toBe(false)
  })

  it('Free: the allowance gets a memo from the model, the rest are kept without one, and nobody is told', async () => {
    await plans({ usageCaps: true })
    await patient('p1', 'free')
    await seedMembership('p1', 'cg1')
    const d = deps()
    await take(4, d)

    expect(await sources(4)).toEqual(['local-llm', 'local-llm', 'stored-only', 'stored-only'])
    expect(d.generateCalls).toBe(2)
    const kept = await memo('m3')
    expect(kept.status).toBe('ready')
    expect(kept.memo).toBe('사진을 남겼어요')
    expect(kept.scene).toBe('')
    expect(kept.place).toBe('서초동, 서초구')
    expect(kept.photoUrl).toContain('https://')
    expect(kept.usage).toEqual({ day: todayKst(), ai: false })
    // The family hears about every photo, and about nothing else.
    expect(await count('notifications', 'type', 'photo.new')).toBe(4)
    expect((await db.collection('notifications').get()).size).toBe(4)
    expect(await counters()).toEqual({ [todayKst()]: { photos: 4, aiPhotos: 2 } })
    expect((await db.doc('admin_totals/global').get()).data()!.bySource['stored-only']).toBe(2)
  })

  it('a patient nobody has put on a plan counts as Free', async () => {
    await plans({ usageCaps: true })
    await patient('p1')
    await take(3, deps())
    expect(await sources(3)).toEqual(['local-llm', 'local-llm', 'stored-only'])
  })

  it('any plan: photos past the fair-use ceiling are kept without a memo, never refused', async () => {
    await plans({ usageCaps: true })
    await patient('p1', 'plus')
    const d = deps()
    await take(7, d)
    expect(await sources(7)).toEqual([...Array(5).fill('local-llm'), 'stored-only', 'stored-only'])
    expect(d.generateCalls).toBe(5)
    expect(await counters()).toEqual({ [todayKst()]: { photos: 7, aiPhotos: 5 } })
  })

  it('switch off: every photo gets a memo, and the day is still counted', async () => {
    await plans({ usageCaps: false })
    await patient('p1', 'free')
    const d = deps()
    await take(4, d)
    expect(d.generateCalls).toBe(4)
    expect(await counters()).toEqual({ [todayKst()]: { photos: 4, aiPhotos: 4 } })
  })

  it('a retry does not count the photo twice', async () => {
    await plans({ usageCaps: true })
    await patient('p1', 'free')
    let fail = true
    const d = deps({
      generate: async () => {
        if (fail) { fail = false; throw new LlmGenerationError('bad json') }
        return { activity: '산책', memo: '공원에서 산책 중이세요.', scene: '', model: 'gemma4:e4b', cost: { promptTokens: 1, outputTokens: 1, totalUSD: 0 } }
      },
    })
    await seedPending('m1')
    expect(await processMemo('m1', 1, d)).toBe('failed')
    expect(await processMemo('m1', 2, d)).toBe('done')
    expect(await counters()).toEqual({ [todayKst()]: { photos: 1, aiPhotos: 1 } })
  })

  it('re-writing a kept photo after moving to a paid plan gives it a real memo', async () => {
    await plans({ usageCaps: true })
    await patient('p1', 'free')
    await seedMembership('p1', 'cg1')
    const d = deps()
    await take(3, d)
    expect((await memo('m3')).memoSource).toBe('stored-only')

    // Still on Free: asking again changes nothing and calls no model.
    await db.doc('memos/m3').update({ status: 'pending', humanEdited: false })
    await processMemo('m3', 1, d)
    expect((await memo('m3')).memoSource).toBe('stored-only')
    expect(d.generateCalls).toBe(2)

    await db.doc('users/p1').update({ 'plan.tier': 'basic' })
    await db.doc('memos/m3').update({ status: 'pending', humanEdited: false })
    await processMemo('m3', 1, d)
    const m = await memo('m3')
    expect(m.memoSource).toBe('local-llm')
    expect(m.memo).toBe('공원에서 산책 중이세요.')
    expect(await counters()).toEqual({ [todayKst()]: { photos: 3, aiPhotos: 3 } })
    // Re-writing is not a new photo for the family.
    expect(await count('notifications', 'type', 'photo.new')).toBe(3)
  })

  it('a photo taken offline counts on the day it was taken; old days are dropped', async () => {
    await plans({ usageCaps: true })
    await patient('p1', 'free')
    await db.doc('users/p1').update({ dayCounters: { '20200101': { photos: 9, aiPhotos: 2 } } })
    const yesterday = new Date(Date.now() - DAY)
    await seedPending('m1', { takenAt: Timestamp.fromDate(yesterday) })
    await seedPending('m2')
    const d = deps()
    await processMemo('m1', 1, d)
    await processMemo('m2', 1, d)
    expect(await counters()).toEqual({
      [dayKey(yesterday, 540)]: { photos: 1, aiPhotos: 1 },
      [todayKst()]: { photos: 1, aiPhotos: 1 },
    })
  })

  it('a memo from before the counters existed is re-written without being counted', async () => {
    await plans({ usageCaps: true })
    await patient('p1', 'free')
    await seedPending('old', { notifiedAt: Timestamp.now(), memo: '예전 메모', memoSource: 'local-llm' })
    const d = deps()
    await processMemo('old', 1, d)
    expect(d.generateCalls).toBe(1)
    expect(await counters()).toEqual({})
  })
})

describe('retention', () => {
  const NOW = new Date()
  const at = (days: number) => new Date(NOW.getTime() + days * DAY)

  function storage(): RetentionDeps & { removed: string[] } {
    const d = { removed: [] as string[], deletePhoto: async (p: string) => { d.removed.push(p) } }
    return d
  }
  const photo = (id: string, daysOld: number, uid = 'p1') =>
    db.doc(`memos/${id}`).set({
      patientUid: uid, photoPath: `photos/${uid}/${id}.jpg`, status: 'ready', memo: '산책',
      takenAt: Timestamp.fromMillis(NOW.getTime() - daysOld * DAY),
    })
  /** The job has been running nightly for a long time. */
  const established = () => db.doc('admin_config/retention').set({
    startedAt: Timestamp.fromMillis(NOW.getTime() - 60 * DAY),
    lastRunAt: Timestamp.fromMillis(NOW.getTime() - DAY),
  })
  const exists = async (id: string) => (await db.doc(`memos/${id}`).get()).exists
  const expiring = async (recipientUid: string) =>
    (await db.collection('notifications').where('recipientUid', '==', recipientUid).get())
      .docs.map((n) => n.data()).filter((n) => n.type === 'retention.expiring')

  it('does nothing while the switch is off', async () => {
    await plans({ retentionJob: false })
    await patient('p1', 'basic')
    await photo('ancient', 400)
    const s = storage()
    expect(await runRetention(NOW, s)).toBeNull()
    expect(await exists('ancient')).toBe(true)
    expect(s.removed).toEqual([])
  })

  it('Basic: the family is told a week ahead, once, and the photo goes when its time is up', async () => {
    await plans({ retentionJob: true })
    await established()
    await patient('p1', 'basic')
    await seedMembership('p1', 'cg1')
    await seedMembership('p1', 'cg2', { role: 'viewer' })
    await seedMembership('p1', 'gone', { status: 'revoked' })
    await photo('soon', 39)
    await photo('recent', 3)
    await db.doc('reactions/r1').set({ memoId: 'soon', patientUid: 'p1', kind: 'voice', transcript: '괜찮아' })
    const s = storage()

    expect(await runRetention(NOW, s)).toEqual({ patients: 1, deleted: 0, notices: 2 })
    expect(await exists('soon')).toBe(true)
    const told = await expiring('cg1')
    expect(told).toHaveLength(1)
    expect(told[0].message).toBe('이번 주에 사진 1장이 지워져요. Plus로 바꾸면 2년 동안 보관해요.')
    expect(await expiring('cg2')).toHaveLength(1)
    expect(await expiring('gone')).toHaveLength(0)
    expect(await expiring('p1')).toHaveLength(0)

    // The next night: no second notice that week.
    expect(await runRetention(at(1), s)).toEqual({ patients: 1, deleted: 0, notices: 0 })

    // A week on, the photo is a day past its 45.
    const later = await runRetention(at(7), s)
    expect(later!.deleted).toBe(1)
    expect(await exists('soon')).toBe(false)
    expect(await exists('recent')).toBe(true)
    expect(s.removed).toEqual(['photos/p1/soon.jpg'])
    // Replies and their transcripts stay.
    expect((await db.doc('reactions/r1').get()).data()!.transcript).toBe('괜찮아')
    const audit = await db.collection('auditLogs').where('action', '==', 'retention.delete').get()
    expect(audit.docs.map((a) => a.data().details)).toEqual([{ count: 1, tier: 'basic', retentionDays: 45 }])
    expect((await db.doc('admin_config/retention').get()).data()!.lastRun.deleted).toBe(1)
  })

  it('Free: the notice names Basic and how long it keeps photos', async () => {
    await plans({ retentionJob: true })
    await established()
    await patient('p1', 'free')
    await seedMembership('p1', 'cg1')
    await photo('a', 4)
    await photo('b', 5)
    await runRetention(NOW, storage())
    expect((await expiring('cg1'))[0].message).toBe('이번 주에 사진 2장이 지워져요. Basic으로 바꾸면 45일 동안 보관해요.')
  })

  it('the first week after the job starts only warns; nothing is deleted yet', async () => {
    await plans({ retentionJob: true })
    await patient('p1', 'basic')
    await seedMembership('p1', 'cg1')
    await photo('old1', 120)
    await photo('old2', 90)
    const s = storage()

    expect(await runRetention(NOW, s)).toEqual({ patients: 1, deleted: 0, notices: 1 })
    expect((await expiring('cg1'))[0].message).toContain('사진 2장이')
    for (let day = 1; day <= 6; day++) expect((await runRetention(at(day), s))!.deleted).toBe(0)
    expect((await runRetention(at(7), s))!.deleted).toBe(2)
    expect(s.removed.sort()).toEqual(['photos/p1/old1.jpg', 'photos/p1/old2.jpg'])
  })

  it('a plan set this week also waits a week before anything is deleted', async () => {
    await plans({ retentionJob: true })
    await established()
    await patient('p1', 'free', 2)
    await photo('old', 20)
    const s = storage()
    expect((await runRetention(NOW, s))!.deleted).toBe(0)
    expect((await runRetention(at(6), s))!.deleted).toBe(1)
  })

  it('never touches a patient nobody put on a plan, or a plan that keeps everything', async () => {
    await plans({ retentionJob: true })
    await established()
    await patient('p1')
    await patient('p2', 'family')
    await photo('mine', 400)
    await photo('theirs', 400, 'p2')
    const s = storage()
    expect(await runRetention(NOW, s)).toEqual({ patients: 0, deleted: 0, notices: 0 })
    expect(await exists('mine')).toBe(true)
    expect(await exists('theirs')).toBe(true)
  })

  it('Plus sends no notice', async () => {
    await plans({ retentionJob: true })
    await established()
    await patient('p1', 'plus')
    await seedMembership('p1', 'cg1')
    await photo('expired', 735)
    await photo('almost', 725)
    const s = storage()
    expect(await runRetention(NOW, s)).toEqual({ patients: 1, deleted: 1, notices: 0 })
    expect(await exists('almost')).toBe(true)
  })

  it('skips a tier whose retention period looks like a mistake', async () => {
    await plans({ retentionJob: true }, { free: tier(0, 2) })
    await established()
    await patient('p1', 'free')
    await photo('today', 1)
    const s = storage()
    expect(await runRetention(NOW, s)).toEqual({ patients: 0, deleted: 0, notices: 0 })
    expect(await exists('today')).toBe(true)
  })

  it('starts the week of warning again when the job was off for a while', async () => {
    await plans({ retentionJob: true })
    await db.doc('admin_config/retention').set({
      startedAt: Timestamp.fromMillis(NOW.getTime() - 90 * DAY),
      lastRunAt: Timestamp.fromMillis(NOW.getTime() - 30 * DAY),
    })
    await patient('p1', 'basic')
    await photo('old', 50)
    const s = storage()
    expect((await runRetention(NOW, s))!.deleted).toBe(0)
    expect((await runRetention(at(7), s))!.deleted).toBe(1)
  })

  it('words the notice from the plans doc', () => {
    expect(expiringMessage(PLANS, 'free', 24)).toBe('이번 주에 사진 24장이 지워져요. Basic으로 바꾸면 45일 동안 보관해요.')
    expect(expiringMessage({ ...PLANS, plus: tier(null, null) } as unknown as PlansDoc, 'basic', 3))
      .toBe('이번 주에 사진 3장이 지워져요. Plus로 바꾸면 평생 보관해요.')
  })
})
