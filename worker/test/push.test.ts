// Family push: who gets one, token upkeep, and the on/off setting.
// FCM is an injected fake; Firestore is the emulator.

import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { deadTokens, fcmMessage, pushToUsers, registerFcmToken, setChannels, type PushDeps, type PushMessage } from '../src/handlers/push'
import { processMemo, type MemoDeps } from '../src/handlers/memo'
import { processReaction, type ReactionDeps } from '../src/handlers/reactions'
import { processSettingsChange } from '../src/handlers/audit'
import { resetPlansCache } from '../src/plans'
import { resetHomeCache, setTravelGeocoder } from '../src/travel'
import { db, clearFirestore, seedMembership, count } from './setup'

const MSG: PushMessage = { title: '오늘하루', body: '어머니님이 새 사진을 올렸어요', data: { type: 'photo.new' } }
const KID = { uid: 'cg1', email: 'kid@example.com', name: '민수' }

function fcm(dead: string[] = []): PushDeps & { sent: Array<{ tokens: string[]; message: PushMessage }> } {
  const d = {
    sent: [] as Array<{ tokens: string[]; message: PushMessage }>,
    send: async (tokens: string[], message: PushMessage) => {
      d.sent.push({ tokens, message })
      return { dead: tokens.filter((t) => dead.includes(t)) }
    },
  }
  return d
}

const flag = async (on: boolean) => {
  await db.doc('admin_config/plans').set({ flags: { pushFamily: on } })
  resetPlansCache()
}
const tokensOf = async (uid: string) => (await db.doc(`users/${uid}/private/push`).get()).data()?.fcmTokens ?? []
const TOKEN = (n: number | string) => `token-${n}-${'x'.repeat(30)}`

beforeEach(async () => {
  await clearFirestore()
  resetPlansCache()
  resetHomeCache()
  setTravelGeocoder(async () => ({ place: '', address: '' }))
  await flag(true)
})

describe('the message sent to FCM', () => {
  it('carries the words, what the installed apps need to open the right place, and a link for browsers', () => {
    const m = fcmMessage([TOKEN(1)], { title: '오늘하루', body: '요약이 도착했어요', data: { type: 'digest.ready', patientUid: 'p1', digestId: 'd1' }, path: 'digest/d1' })
    expect(m.tokens).toEqual([TOKEN(1)])
    expect(m.notification).toEqual({ title: '오늘하루', body: '요약이 도착했어요' })
    expect(m.data).toEqual({ type: 'digest.ready', patientUid: 'p1', digestId: 'd1' })
    expect(m.webpush?.fcmOptions?.link).toMatch(/\/digest\/d1$/)
    // iPhone app: the banner makes a sound.
    expect(m.apns?.payload?.aps?.sound).toBe('default')
  })
})

describe('pushToUsers', () => {
  it('sends to every device of each recipient', async () => {
    await registerFcmToken(KID, { token: TOKEN(1) })
    await registerFcmToken(KID, { token: TOKEN(2) })
    const f = fcm()
    await pushToUsers(['cg1', 'cg1', 'nobody'], MSG, f)
    expect(f.sent).toEqual([{ tokens: [TOKEN(1), TOKEN(2)], message: MSG }])
  })

  it('sends nothing while the rollout flag is off', async () => {
    await registerFcmToken(KID, { token: TOKEN(1) })
    await flag(false)
    const f = fcm()
    await pushToUsers(['cg1'], MSG, f)
    expect(f.sent).toEqual([])
  })

  it('respects 앱 알림 switched off', async () => {
    await registerFcmToken(KID, { token: TOKEN(1) })
    await setChannels(KID, { push: false })
    const f = fcm()
    await pushToUsers(['cg1'], MSG, f)
    expect(f.sent).toEqual([])
    await setChannels(KID, { push: true })
    await pushToUsers(['cg1'], MSG, f)
    expect(f.sent.length).toBe(1)
  })

  it('prunes tokens FCM reports as no longer registered', async () => {
    await registerFcmToken(KID, { token: TOKEN('gone') })
    await registerFcmToken(KID, { token: TOKEN('live') })
    await pushToUsers(['cg1'], MSG, fcm([TOKEN('gone')]))
    expect(await tokensOf('cg1')).toEqual([TOKEN('live')])
  })

  it('never throws, even when FCM does', async () => {
    await registerFcmToken(KID, { token: TOKEN(1) })
    await expect(pushToUsers(['cg1'], MSG, { send: async () => { throw new Error('fcm down') } })).resolves.toBe(0)
  })
})

describe('deadTokens', () => {
  it('picks out not-registered and invalid tokens, keeps ones that merely failed', () => {
    expect(deadTokens(['a', 'b', 'c', 'd'], [
      { success: true },
      { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      { success: false, error: { code: 'messaging/internal-error' } },
      { success: false, error: { code: 'messaging/invalid-registration-token' } },
    ])).toEqual(['b', 'd'])
  })
})

describe('registerFcmToken', () => {
  it('stores each device once and keeps the newest ten', async () => {
    for (let i = 0; i < 12; i++) await registerFcmToken(KID, { token: TOKEN(i) })
    await registerFcmToken(KID, { token: TOKEN(5) })
    const tokens = await tokensOf('cg1')
    expect(tokens.length).toBe(10)
    expect(tokens[9]).toBe(TOKEN(5))
    expect(tokens).not.toContain(TOKEN(0))
    expect(tokens.filter((t: string) => t === TOKEN(5)).length).toBe(1)
  })

  it('forgets a device on request', async () => {
    await registerFcmToken(KID, { token: TOKEN(1) })
    await registerFcmToken(KID, { token: TOKEN(1), remove: true })
    expect(await tokensOf('cg1')).toEqual([])
  })

  it('refuses a pairing-only session and a missing token', async () => {
    await expect(registerFcmToken({ uid: 'anon', email: null, name: null }, { token: TOKEN(1) })).rejects.toThrow(/family account/)
    await expect(registerFcmToken(KID, { token: '' })).rejects.toThrow(/token required/)
  })
})

describe('setChannels', () => {
  it('changes only what was asked, logs it, and is not mistaken for a settings change by family', async () => {
    await db.doc('users/cg1').set({ patientName: '민수', lastModifiedBy: 'someone-else' })
    expect((await setChannels(KID, { email: false, bogus: true })).channels).toEqual({ push: true, email: false, messenger: false })
    expect((await setChannels(KID, { push: false })).channels).toEqual({ push: false, email: false, messenger: false })
    expect(await count('auditLogs', 'action', 'channels.update')).toBe(2)
    await expect(setChannels(KID, { bogus: true })).rejects.toThrow(/nothing to change/)

    // The settings-audit watcher sees the users doc change and must stay quiet.
    await processSettingsChange('cg1',
      { patientName: '민수', lastModifiedBy: 'someone-else' },
      { patientName: '민수', lastModifiedBy: 'someone-else', channels: { push: false } })
    expect(await count('auditLogs', 'action', 'settings.update')).toBe(0)
  })
})

describe('what gets pushed', () => {
  it('a new photo is pushed to the family, once', async () => {
    await seedMembership('p1', 'cg1')
    await db.doc('users/p1').set({ patientName: '어머니' })
    await db.doc('memos/m1').set({
      patientUid: 'p1', photoPath: 'photos/p1/m1.jpg', photoUrl: '', takenAt: Timestamp.now(), lat: null, lng: null,
      place: '', activity: '기타', memo: '', scene: '', status: 'pending', createdAt: Timestamp.now(),
    })
    const pushes: Array<{ uids: string[]; message: PushMessage }> = []
    const deps: MemoDeps = {
      loadPhoto: async () => ({ photoUrl: 'https://example.test/p.jpg', base64: async () => 'aGk=' }),
      geocode: async () => ({ place: '', address: '' }),
      generate: async () => ({ activity: '산책', memo: '공원 산책', scene: '', model: 'gemma4:e4b', cost: { promptTokens: 1, outputTokens: 1, totalUSD: 0 } }),
      push: async (uids, message) => { pushes.push({ uids, message }) },
    }
    await processMemo('m1', 1, deps)
    await db.doc('memos/m1').update({ status: 'pending' }) // a re-write
    await processMemo('m1', 1, deps)
    expect(pushes).toEqual([{ uids: ['cg1'], message: { title: '오늘하루', body: '어머니님이 새 사진을 올렸어요', data: { type: 'photo.new', patientUid: 'p1', memoId: 'm1' } } }])
  })

  it('a voice reply is pushed; hearts and comments are not', async () => {
    await seedMembership('p1', 'cg1')
    await db.doc('users/p1').set({ patientName: '어머니' })
    const pushes: Array<{ uids: string[]; message: PushMessage }> = []
    const deps: ReactionDeps = {
      loadClip: async () => ({ audioUrl: 'https://example.test/v.webm', bytes: async () => Buffer.from('a') }),
      transcribe: async () => '괜찮아',
      push: async (uids, message) => { pushes.push({ uids, message }) },
    }
    const base = { memoId: 'm1', patientUid: 'p1', notified: false, createdAt: Timestamp.now() }
    await db.doc('reactions/v1').set({ ...base, actorUid: 'p1', actorName: '어머니', kind: 'voice', status: 'pending', audioPath: 'voice/p1/m1/v1.webm' })
    await db.doc('reactions/h1').set({ ...base, actorUid: 'p1', actorName: '어머니', kind: 'heart', status: 'ready' })
    await db.doc('reactions/c1').set({ ...base, actorUid: 'cg1', actorName: '민수', kind: 'comment', text: '안녕', status: 'ready' })
    for (const id of ['v1', 'h1', 'c1']) await processReaction(id, 1, deps)
    expect(pushes.length).toBe(1)
    expect(pushes[0]).toMatchObject({ uids: ['cg1'], message: { body: '어머니님이 음성 답장을 남기셨어요', data: { type: 'reaction.voice', reactionId: 'v1' } } })
  })
})
