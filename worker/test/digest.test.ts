// The evening digest, check-in, messenger providers and their settings.
// The model, FCM, SMTP and messenger accounts are injected fakes; Firestore is
// the emulator. Plan contents below are made up for the tests.

import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { digestSettings, repliesLine, resetDigestState, runDigests, setDigest, type DigestDeps } from '../src/handlers/digest'
import { setChannels, type PushMessage } from '../src/handlers/push'
import { LlmGenerationError, LlmUnavailableError } from '../src/llm/ollama'
import { buildDigestPrompt, DIGEST_MAX_LINES, parseSummary, type DigestPromptArgs } from '../src/llm/prompt'
import { maskPhone, normalizePhone, providerFor, renderText, type MessengerProvider } from '../src/messenger/index'
import { resetPlansCache } from '../src/plans'
import { localClock, localDayStart, tzOffsetMin, validTz } from '../src/zoned'
import { db, clearFirestore, seedMembership } from './setup'

const tier = (o: Record<string, unknown> = {}) => ({
  familyMembers: 1, retentionDays: null, messenger: false, weekly: false, checkin: false, recap: false,
  voiceReplies: false, voiceAlbum: false, aiPhotosPerDay: null, seniors: 1, ...o,
})
const PLANS = {
  free: tier(),
  basic: tier({ messenger: true, voiceReplies: true }),
  plus: tier({ messenger: true, voiceReplies: true, weekly: true, checkin: true }),
  family: tier({ messenger: true, voiceReplies: true, weekly: true, checkin: true, recap: true }),
  fairUse: { photosPerDay: null },
}
async function plans(flags: Record<string, boolean>) {
  await db.doc('admin_config/plans').set({ ...PLANS, flags })
  resetPlansCache()
}

const SUMMARY = '오전에 공원을 산책하셨어요. 점심은 된장찌개를 드셨어요.'
const KST = (iso: string) => new Date(`${iso}+09:00`)
/** Saturday evening in Seoul, after the default digest hour (20:00). */
const SAT_EVENING = KST('2026-10-03T20:05:00')

function fakes(overrides: Partial<DigestDeps> = {}) {
  const f = {
    prompts: [] as DigestPromptArgs[],
    pushes: [] as Array<{ uids: string[]; message: PushMessage }>,
    mails: [] as Array<{ to: string; subject: string; text: string }>,
    texts: [] as Array<{ to: string; template: string; vars: Record<string, string> }>,
  }
  const provider: MessengerProvider = {
    name: 'alimtalk',
    send: async (to, template, vars) => {
      f.texts.push({ to, template, vars })
      return { ok: true, provider: 'alimtalk', cost: { amount: 8, currency: 'KRW' } }
    },
  }
  const deps: DigestDeps = {
    summarize: async (args) => { f.prompts.push(args); return SUMMARY },
    push: async (uids, message) => { f.pushes.push({ uids, message }); return uids.length },
    mail: { send: async (mail) => { f.mails.push(mail); return true } },
    messenger: () => provider,
    emailOf: async (uid) => `${uid}@example.com`,
    ...overrides,
  }
  return { f, deps }
}

const patient = (planTier?: string, extra: Record<string, unknown> = {}) =>
  db.doc('users/p1').set({ patientName: '어머니', ...(planTier ? { plan: { tier: planTier, status: 'active' } } : {}), ...extra })
const photo = (id: string, at: Date, extra: Record<string, unknown> = {}) =>
  db.doc(`memos/${id}`).set({
    patientUid: 'p1', photoPath: `photos/p1/${id}.jpg`, status: 'ready', takenAt: Timestamp.fromDate(at),
    activity: '산책', memo: '나무가 우거진 공원 산책길', place: '서초동, 서초구', memoSource: 'local-llm', ...extra,
  })
/** A Saturday with three photos, a heart and a voice reply from the parent. */
async function saturday() {
  await photo('m1', KST('2026-10-03T09:40:00'))
  await photo('m2', KST('2026-10-03T12:40:00'), { activity: '식사', memo: '된장찌개로 점심 식사' })
  await photo('m3', KST('2026-10-03T15:30:00'), { activity: '기타', memo: '사진을 남겼어요', memoSource: 'stored-only', place: '방배동, 서초구' })
  await photo('yesterday', KST('2026-10-02T15:00:00'))
  const reply = (id: string, data: Record<string, unknown>) => db.doc(`reactions/${id}`).set({
    memoId: 'm2', patientUid: 'p1', actorUid: 'p1', status: 'ready', notified: true, createdAt: Timestamp.fromDate(KST('2026-10-03T15:41:00')), ...data,
  })
  await reply('h1', { kind: 'heart' })
  await reply('v1', { kind: 'voice', transcript: '괜찮아, 오늘 많이 걸었어' })
  await reply('fromFamily', { kind: 'heart', actorUid: 'cg1' })
  await reply('t1', { kind: 'comment', text: '밥 먹었어' })
  await reply('familyComment', { kind: 'comment', actorUid: 'cg1', text: '엄마 날씨 좋네요' })
}
const digest = async (id = 'p1_daily_20261003') => (await db.doc(`digests/${id}`).get()).data()
const notices = async (recipientUid: string, type: string) =>
  (await db.collection('notifications').where('recipientUid', '==', recipientUid).get()).docs.map((n) => n.data()).filter((n) => n.type === type)

beforeEach(async () => {
  await clearFirestore()
  resetPlansCache()
  resetDigestState()
})

describe('clock in the parent\'s time zone', () => {
  it('reads the local day and hour', () => {
    expect(localClock('Asia/Seoul', new Date('2026-10-03T16:30:00Z'))).toMatchObject({ year: 2026, month: 10, day: 4, hour: 1, weekday: 0, dayKey: '20261004' })
    expect(localClock('America/Los_Angeles', new Date('2026-10-03T16:30:00Z'))).toMatchObject({ day: 3, hour: 9, weekday: 6 })
    expect(tzOffsetMin('Asia/Seoul', new Date())).toBe(540)
  })

  it('finds where a day starts, across a clock change and a month end', () => {
    expect(localDayStart('Asia/Seoul', 2026, 10, 3).toISOString()).toBe('2026-10-02T15:00:00.000Z')
    // US clocks go back on 2026-11-01.
    expect(localDayStart('America/Los_Angeles', 2026, 11, 1).toISOString()).toBe('2026-11-01T07:00:00.000Z')
    expect(localDayStart('America/Los_Angeles', 2026, 11, 2).toISOString()).toBe('2026-11-02T08:00:00.000Z')
    expect(localDayStart('Asia/Seoul', 2026, 10, 0).toISOString()).toBe('2026-09-29T15:00:00.000Z')
  })

  it('knows a real zone from a typo', () => {
    expect(validTz('Asia/Seoul')).toBe(true)
    expect(validTz('Seoul')).toBe(false)
    expect(validTz(9)).toBe(false)
  })
})

describe('daily digest', () => {
  it('does nothing while the switch is off', async () => {
    await plans({ digest: false })
    await patient('basic')
    await seedMembership('p1', 'cg1')
    await saturday()
    const { deps } = fakes()
    expect(await runDigests(SAT_EVENING, deps)).toBeNull()
    expect(await digest()).toBeUndefined()
  })

  it('waits for the parent\'s digest hour', async () => {
    await plans({ digest: true })
    await patient('basic')
    await seedMembership('p1', 'cg1')
    await saturday()
    const { deps } = fakes()
    expect(await runDigests(KST('2026-10-03T19:55:00'), deps)).toEqual({ digests: 0, deliveries: 0, checkins: 0 })
    await db.doc('users/p1').update({ digest: { cadence: 'daily', hourLocal: 19, tz: 'Asia/Seoul' } })
    expect((await runDigests(KST('2026-10-03T19:55:00'), deps))!.digests).toBe(1)
  })

  it('summarises the day from its memos and includes the parent\'s replies', async () => {
    await plans({ digest: true })
    await patient('basic')
    await seedMembership('p1', 'cg1')
    await saturday()
    const { f, deps } = fakes()
    expect(await runDigests(SAT_EVENING, deps)).toEqual({ digests: 1, deliveries: 1, checkins: 0 })

    expect(f.prompts).toEqual([{
      span: 'daily',
      lines: ['09:40 산책 · 나무가 우거진 공원 산책길 · 서초동, 서초구', '12:40 식사 · 된장찌개로 점심 식사 · 서초동, 서초구', '15:30 기타 · 방배동, 서초구'],
    }])
    const d = (await digest())!
    expect(d).toMatchObject({
      patientUid: 'p1', kind: 'daily', label: '10월 3일 토요일', summary: SUMMARY, summarySource: 'local-llm',
      memoIds: ['m1', 'm2', 'm3'], photoCount: 3, status: 'ready',
      replies: { hearts: 1, voices: 1, texts: ['밥 먹었어'], transcripts: ['괜찮아, 오늘 많이 걸었어'] },
    })
    expect(d.periodStart.toDate().toISOString()).toBe('2026-10-02T15:00:00.000Z')
    expect(repliesLine('어머니', 1, 1)).toBe('어머니님이 하트 1개, 음성 답장 1개를 남기셨어요')
    expect(repliesLine('어머니', 0, 0)).toBe('')
    expect(repliesLine('어머니', 1, 0, 2)).toBe('어머니님이 하트 1개, 글 답장 2개를 남기셨어요')
  })

  it('reaches each family member by in-app notice and push, e-mail unless switched off, messenger only when switched on', async () => {
    await plans({ digest: true })
    await patient('basic')
    await seedMembership('p1', 'cg1')
    await seedMembership('p1', 'cg2', { role: 'viewer' })
    await seedMembership('p1', 'gone', { status: 'revoked' })
    await db.doc('users/cg1').set({ channels: { push: true, email: true, messenger: true } })
    await db.doc('users/cg1/private/contact').set({ phone: '+821012345678' })
    await db.doc('users/cg2').set({ channels: { push: true, email: false, messenger: false } })
    await saturday()
    const { f, deps } = fakes()
    await runDigests(SAT_EVENING, deps)

    for (const uid of ['cg1', 'cg2']) {
      const [n] = await notices(uid, 'digest.ready')
      expect(n).toMatchObject({ message: '어머니님의 오늘 하루 요약이 도착했어요', digestId: 'p1_daily_20261003', patientUid: 'p1', read: false })
    }
    expect(await notices('gone', 'digest.ready')).toHaveLength(0)
    expect(await notices('p1', 'digest.ready')).toHaveLength(0)
    expect(f.pushes.map((p) => p.uids)).toEqual([['cg1'], ['cg2']])
    expect(f.pushes[0].message).toMatchObject({ body: '어머니님의 오늘 하루 요약이 도착했어요', path: 'digest/p1_daily_20261003' })

    expect(f.mails).toHaveLength(1)
    expect(f.mails[0]).toMatchObject({ to: 'cg1@example.com', subject: '[오늘하루] 어머니님의 10월 3일 토요일' })
    expect(f.mails[0].text).toContain(SUMMARY)
    expect(f.mails[0].text).toContain('사진 3장 · 어머니님이 하트 1개, 글 답장 1개, 음성 답장 1개를 남기셨어요')
    expect(f.mails[0].text).toContain('/digest/p1_daily_20261003')
    // One line and a link; never a photo.
    expect(f.mails[0].text).not.toContain('photos/')
    expect(f.texts).toEqual([{ to: '+821012345678', template: 'digest', vars: { name: '어머니', date: '10월 3일 토요일', link: expect.stringContaining('/digest/p1_daily_20261003') } }])

    const d = (await digest())!
    expect(d.delivered).toEqual({ cg1: ['inapp', 'push', 'email', 'alimtalk'], cg2: ['inapp', 'push'] })
    expect([...d.sentVia].sort()).toEqual(['alimtalk', 'email', 'inapp', 'push'])
    const day = (await db.collection('admin_daily').get()).docs[0].data()
    expect(day.digests).toBe(1)
    expect(day.sends).toEqual({ email: { count: 1 }, alimtalk: { count: 1, costKRW: 8 } })
  })

  it('goes out once: a later pass sends nothing again, but reaches someone who joined since', async () => {
    await plans({ digest: true })
    await patient('basic')
    await seedMembership('p1', 'cg1')
    await saturday()
    const { f, deps } = fakes()
    await runDigests(SAT_EVENING, deps)
    expect(await runDigests(KST('2026-10-03T20:15:00'), deps)).toEqual({ digests: 0, deliveries: 0, checkins: 0 })
    expect(f.mails).toHaveLength(1)
    expect(await notices('cg1', 'digest.ready')).toHaveLength(1)

    await seedMembership('p1', 'late')
    expect(await runDigests(KST('2026-10-03T20:25:00'), deps)).toEqual({ digests: 0, deliveries: 1, checkins: 0 })
    expect(f.prompts).toHaveLength(1)
    expect(await notices('late', 'digest.ready')).toHaveLength(1)
    expect((await db.collection('digests').get()).size).toBe(1)
  })

  it('Free: no messenger and no transcripts, even with the switch on and a number on file', async () => {
    await plans({ digest: true })
    await patient()
    await seedMembership('p1', 'cg1')
    await db.doc('users/cg1').set({ channels: { messenger: true } })
    await db.doc('users/cg1/private/contact').set({ phone: '+821012345678' })
    await saturday()
    const { f, deps } = fakes()
    await runDigests(SAT_EVENING, deps)
    expect(f.texts).toEqual([])
    expect(f.mails).toHaveLength(1)
    // What the parent wrote is free on every plan; what they said is not.
    expect((await digest())!.replies).toEqual({ hearts: 1, voices: 1, texts: ['밥 먹었어'], transcripts: [] })

    // The rollout switch that opens messenger to everyone.
    await db.doc('digests/p1_daily_20261003').delete()
    await db.doc('notifications/digest_p1_daily_20261003_cg1').delete()
    await plans({ digest: true, messengerFree: true })
    await runDigests(SAT_EVENING, deps)
    expect(f.texts).toHaveLength(1)
  })

  it('sends nothing on a day without photos', async () => {
    await plans({ digest: true })
    await patient('basic')
    await seedMembership('p1', 'cg1')
    await photo('yesterday', KST('2026-10-02T15:00:00'))
    const { f, deps } = fakes()
    expect(await runDigests(SAT_EVENING, deps)).toEqual({ digests: 0, deliveries: 0, checkins: 0 })
    expect(f.prompts).toEqual([])
    expect((await db.collection('notifications').get()).size).toBe(0)
  })

  it('without e-mail set up, the digest still arrives in the app', async () => {
    await plans({ digest: true })
    await patient('basic')
    await seedMembership('p1', 'cg1')
    await saturday()
    const { deps } = fakes({ mail: null, push: async () => 0 })
    await runDigests(SAT_EVENING, deps)
    expect((await digest())!.delivered).toEqual({ cg1: ['inapp'] })
  })

  it('waits while the model is down, then sends a plain sentence', async () => {
    await plans({ digest: true })
    await patient('basic')
    await seedMembership('p1', 'cg1')
    await saturday()
    const { deps } = fakes({ summarize: async () => { throw new LlmUnavailableError('down') } })
    expect((await runDigests(SAT_EVENING, deps))!.digests).toBe(0)
    expect((await runDigests(KST('2026-10-03T21:50:00'), deps))!.digests).toBe(0)
    expect((await runDigests(KST('2026-10-03T22:00:00'), deps))!.digests).toBe(1)
    expect(await digest()).toMatchObject({ summary: '오늘 사진 3장을 남기셨어요.', summarySource: 'plain' })
  })

  it('gives up on a summary the model keeps getting wrong', async () => {
    await plans({ digest: true })
    await patient('basic')
    await seedMembership('p1', 'cg1')
    await saturday()
    const { deps } = fakes({ summarize: async () => { throw new LlmGenerationError('bad json') } })
    expect((await runDigests(SAT_EVENING, deps))!.digests).toBe(0)
    expect((await runDigests(SAT_EVENING, deps))!.digests).toBe(0)
    expect((await runDigests(SAT_EVENING, deps))!.digests).toBe(1)
    expect((await digest())!.summarySource).toBe('plain')
  })
})

describe('weekly highlight, monthly recap, check-in', () => {
  const SUN_EVENING = KST('2026-10-04T20:05:00')

  it('Plus gets a weekly highlight on Sunday as well as the day', async () => {
    await plans({ digest: true })
    await patient('plus')
    await seedMembership('p1', 'cg1')
    await photo('mon', KST('2026-09-28T10:00:00'))
    await photo('sun', KST('2026-10-04T11:00:00'))
    await photo('tooOld', KST('2026-09-27T23:00:00'))
    const { f, deps } = fakes()
    expect((await runDigests(SUN_EVENING, deps))!.digests).toBe(2)
    const weekly = (await digest('p1_weekly_20261004'))!
    expect(weekly).toMatchObject({ kind: 'weekly', label: '9월 28일~10월 4일', memoIds: ['mon', 'sun'] })
    expect(f.prompts.find((p) => p.span === 'weekly')!.lines[0]).toBe('9월 28일 10:00 산책 · 나무가 우거진 공원 산책길 · 서초동, 서초구')
    expect((await notices('cg1', 'digest.ready')).map((n) => n.message).sort())
      .toEqual(['어머니님의 오늘 하루 요약이 도착했어요', '어머니님의 이번 주 하이라이트가 도착했어요'])
    // Basic has no weekly highlight.
    await db.doc('users/p1').update({ 'plan.tier': 'basic' })
    await db.doc('digests/p1_weekly_20261004').delete()
    await runDigests(SUN_EVENING, deps)
    expect(await digest('p1_weekly_20261004')).toBeUndefined()
  })

  it('a family that chose weekly gets no daily digest', async () => {
    await plans({ digest: true })
    await patient('plus', { digest: { cadence: 'weekly', hourLocal: 20, tz: 'Asia/Seoul' } })
    await seedMembership('p1', 'cg1')
    await saturday()
    const { deps } = fakes()
    expect((await runDigests(SAT_EVENING, deps))!.digests).toBe(0)
    await photo('sun', KST('2026-10-04T11:00:00'))
    expect((await runDigests(SUN_EVENING, deps))!.digests).toBe(1)
    expect(await digest('p1_weekly_20261004')).toBeDefined()
    expect(await digest('p1_daily_20261004')).toBeUndefined()
  })

  it('the Family plan gets last month\'s recap on the 1st', async () => {
    await plans({ digest: true })
    await patient('family')
    await seedMembership('p1', 'cg1')
    await photo('sep1', KST('2026-09-01T00:30:00'))
    await photo('sep30', KST('2026-09-30T23:30:00'))
    await photo('oct1', KST('2026-10-01T09:00:00'))
    const { deps } = fakes()
    await runDigests(KST('2026-10-01T20:05:00'), deps)
    expect(await digest('p1_monthly_202609')).toMatchObject({ kind: 'monthly', label: '9월', memoIds: ['sep1', 'sep30'] })
    expect((await notices('cg1', 'digest.ready')).map((n) => n.message)).toContain('어머니님의 9월 앨범이 도착했어요')
  })

  it('check-in: a day without photos is told to the family once, on plans that include it', async () => {
    await plans({ digest: true })
    await patient('plus')
    await seedMembership('p1', 'cg1')
    await seedMembership('p1', 'cg2')
    await photo('yesterday', KST('2026-10-02T15:00:00'))
    const { f, deps } = fakes()
    expect(await runDigests(SAT_EVENING, deps)).toEqual({ digests: 0, deliveries: 0, checkins: 1 })
    expect(await runDigests(KST('2026-10-03T20:15:00'), deps)).toEqual({ digests: 0, deliveries: 0, checkins: 0 })
    for (const uid of ['cg1', 'cg2']) {
      expect((await notices(uid, 'checkin.no_photo')).map((n) => n.message)).toEqual(['오늘 아직 어머니님의 사진이 없어요'])
    }
    expect(await notices('p1', 'checkin.no_photo')).toHaveLength(0)
    expect(f.pushes).toHaveLength(1)
    expect(f.pushes[0].uids.sort()).toEqual(['cg1', 'cg2'])

    // A day with a photo: no check-in.
    await photo('sunday', KST('2026-10-04T10:00:00'))
    expect((await runDigests(KST('2026-10-04T20:05:00'), deps))!.checkins).toBe(0)
  })

  it('check-in is not part of Basic', async () => {
    await plans({ digest: true })
    await patient('basic')
    await seedMembership('p1', 'cg1')
    const { deps } = fakes()
    expect((await runDigests(SAT_EVENING, deps))!.checkins).toBe(0)
    expect((await db.collection('notifications').get()).size).toBe(0)
  })
})

describe('summary prompt', () => {
  it('thins a long month and keeps the rules', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`)
    const prompt = buildDigestPrompt({ span: 'monthly', lines })
    expect(prompt.split('\n').filter((l) => l.startsWith('- line'))).toHaveLength(DIGEST_MAX_LINES)
    expect(prompt).toContain('- line 0')
    expect(prompt).toContain('지어내지 마세요')
    expect(prompt).toContain('건강·약·진단명은 추측하지 마세요')
  })

  it('takes at most three sentences out of the model\'s answer', () => {
    expect(parseSummary('{"summary":"하나예요. 둘이에요.\\n셋이에요. 넷이에요."}')).toBe('하나예요. 둘이에요. 셋이에요.')
    expect(parseSummary('```json\n{"summary":"산책하셨어요"}\n```')).toBe('산책하셨어요')
    expect(parseSummary('{"summary":""}')).toBeNull()
    expect(parseSummary('not json')).toBeNull()
  })
})

describe('messenger providers', () => {
  const VARS = { name: '어머니', date: '10월 3일 토요일', link: 'https://example.test/digest/d1' }
  function http(status = 200) {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response('{}', { status })
    }) as unknown as typeof fetch
    return { calls, fetchFn }
  }

  it('with no account configured, the no-op provider sends nothing', async () => {
    const { calls, fetchFn } = http()
    const p = providerFor('+821012345678', {}, fetchFn)
    expect(p.name).toBe('noop')
    expect(await p.send('+821012345678', 'digest', VARS)).toEqual({ ok: false, provider: 'noop' })
    expect(calls).toEqual([])
  })

  it('Korean numbers go by 알림톡, others by WhatsApp, with SMS as the fallback', () => {
    const kakao = { KAKAO_ALIMTALK_API_KEY: 'k', KAKAO_ALIMTALK_API_SECRET: 's', KAKAO_ALIMTALK_PFID: 'pf', KAKAO_ALIMTALK_SENDER: '0212345678', KAKAO_ALIMTALK_TEMPLATE_DIGEST: 'T1' }
    const twilio = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+15550001111' }
    const wa = { WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: '123', WHATSAPP_TEMPLATE_DIGEST: 'daily_digest' }
    const all = { ...kakao, ...twilio, ...wa }
    expect(providerFor('+821012345678', all).name).toBe('alimtalk')
    expect(providerFor('+14155550100', all).name).toBe('whatsapp')
    expect(providerFor('+821012345678', twilio).name).toBe('sms')
    expect(providerFor('+14155550100', twilio).name).toBe('sms')
    expect(providerFor('+14155550100', kakao).name).toBe('noop')
  })

  it('알림톡 sends the template variables and never falls back to a paid text', async () => {
    const { calls, fetchFn } = http()
    const env = { KAKAO_ALIMTALK_API_KEY: 'k', KAKAO_ALIMTALK_API_SECRET: 's', KAKAO_ALIMTALK_PFID: 'pf', KAKAO_ALIMTALK_SENDER: '0212345678', KAKAO_ALIMTALK_TEMPLATE_DIGEST: 'T1' }
    const res = await providerFor('+821012345678', env, fetchFn).send('+821012345678', 'digest', VARS)
    expect(res).toEqual({ ok: true, provider: 'alimtalk', cost: { amount: 8, currency: 'KRW' } })
    expect((calls[0].init.headers as Record<string, string>).Authorization).toMatch(/^HMAC-SHA256 apiKey=k, date=.+, salt=[0-9a-f]{32}, signature=[0-9a-f]{64}$/)
    expect(JSON.parse(calls[0].init.body as string).message).toEqual({
      to: '01012345678',
      from: '0212345678',
      kakaoOptions: { pfId: 'pf', templateId: 'T1', disableSms: true, variables: { '#{name}': '어머니', '#{date}': '10월 3일 토요일', '#{link}': VARS.link } },
    })
  })

  it('SMS carries one line and the link', async () => {
    const { calls, fetchFn } = http()
    const env = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+15550001111' }
    expect((await providerFor('+14155550100', env, fetchFn).send('+14155550100', 'digest', VARS)).ok).toBe(true)
    expect(calls[0].url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json')
    const body = calls[0].init.body as URLSearchParams
    expect(body.get('To')).toBe('+14155550100')
    expect(body.get('Body')).toBe(renderText('digest', VARS))
    expect(renderText('digest', VARS)).toBe('[오늘하루] 어머니님의 10월 3일 토요일 요약이 도착했어요.\nhttps://example.test/digest/d1')
  })

  it('WhatsApp sends the approved template with its variables in order', async () => {
    const { calls, fetchFn } = http()
    const env = { WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: '123', WHATSAPP_TEMPLATE_DIGEST: 'daily_digest' }
    await providerFor('+14155550100', env, fetchFn).send('+14155550100', 'digest', VARS)
    expect(calls[0].url).toBe('https://graph.facebook.com/v20.0/123/messages')
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({
      to: '14155550100',
      template: { name: 'daily_digest', language: { code: 'ko' }, components: [{ type: 'body', parameters: [{ type: 'text', text: '어머니' }, { type: 'text', text: '10월 3일 토요일' }, { type: 'text', text: VARS.link }] }] },
    })
  })

  it('a provider that fails reports it instead of throwing', async () => {
    const { fetchFn } = http(500)
    const env = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+15550001111' }
    const res = await providerFor('+14155550100', env, fetchFn).send('+14155550100', 'digest', VARS)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('HTTP 500')
  })

  it('reads and masks phone numbers', () => {
    expect(normalizePhone('010-1234-5678')).toBe('+821012345678')
    expect(normalizePhone('+82 10 1234 5678')).toBe('+821012345678')
    expect(normalizePhone('+1 (415) 555-0100')).toBe('+14155550100')
    expect(normalizePhone('1234')).toBeNull()
    expect(normalizePhone('hello')).toBeNull()
    expect(maskPhone('+821012345678')).toBe('010-****-5678')
  })
})

describe('settings', () => {
  const KID = { uid: 'cg1', email: 'kid@example.com', name: '민수' }

  it('카카오톡 요약 needs a phone number, which no client can read back', async () => {
    await expect(setChannels(KID, { messenger: true })).rejects.toMatchObject({ code: 'failed-precondition' })
    await expect(setChannels(KID, { messenger: true, phone: '12' })).rejects.toMatchObject({ code: 'invalid-argument' })
    const { channels } = await setChannels(KID, { messenger: true, phone: '010-1234-5678' })
    expect(channels).toMatchObject({ messenger: true, messengerTo: '010-****-5678' })
    expect((await db.doc('users/cg1/private/contact').get()).data()!.phone).toBe('+821012345678')
    expect(JSON.stringify((await db.doc('users/cg1').get()).data())).not.toContain('12345678')
    const log = (await db.collection('auditLogs').where('action', '==', 'channels.update').get()).docs[0].data()
    expect(log.details).toEqual({ messenger: true, phone: 'set' })
    // The number stays on file: switching off and on again needs nothing more.
    await setChannels(KID, { messenger: false })
    expect((await setChannels(KID, { messenger: true })).channels.messenger).toBe(true)
    expect((await setChannels(KID, { email: false })).channels).toMatchObject({ email: false, messenger: true })
  })

  it('setDigest: family managers choose the hour; weekly needs a plan that has it', async () => {
    await plans({ digest: true })
    await patient('basic')
    await seedMembership('p1', 'cg1')
    await seedMembership('p1', 'viewer', { role: 'viewer' })
    expect(digestSettings(undefined)).toEqual({ cadence: 'daily', hourLocal: 20, tz: 'Asia/Seoul' })

    await expect(setDigest({ uid: 'viewer', email: 'v@example.com', name: null }, { patientUid: 'p1', hourLocal: 18 })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(setDigest({ uid: 'stranger', email: 's@example.com', name: null }, { patientUid: 'p1', hourLocal: 18 })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(setDigest(KID, { patientUid: 'p1', hourLocal: 24 })).rejects.toMatchObject({ code: 'invalid-argument' })
    await expect(setDigest(KID, { patientUid: 'p1', tz: 'Seoul' })).rejects.toMatchObject({ code: 'invalid-argument' })
    await expect(setDigest(KID, { patientUid: 'p1', cadence: 'weekly' })).rejects.toMatchObject({ code: 'failed-precondition' })

    expect((await setDigest(KID, { patientUid: 'p1', hourLocal: 18, tz: 'America/Los_Angeles' })).digest)
      .toEqual({ cadence: 'daily', hourLocal: 18, tz: 'America/Los_Angeles' })
    expect((await db.doc('users/p1').get()).data()!.digest.hourLocal).toBe(18)
    const log = (await db.collection('auditLogs').where('action', '==', 'digest.update').get()).docs[0].data()
    expect(log).toMatchObject({ patientUid: 'p1', actorUid: 'cg1', details: { hourLocal: 18, tz: 'America/Los_Angeles' } })

    await db.doc('users/p1').update({ 'plan.tier': 'plus' })
    expect((await setDigest(KID, { patientUid: 'p1', cadence: 'weekly' })).digest.cadence).toBe('weekly')
  })
})
