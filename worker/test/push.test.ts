// Family push: who gets one, token upkeep, and the on/off setting.
// FCM is an injected fake; Firestore is the emulator.

import { history, pushHealth, resetSystemHistory } from '../src/systemHistory'
import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { deadTokens, elderBadge, fcmMessage, openPath, otherFailures, pushToElder, pushToUsers, registerFcmToken, setChannels, STALE_TOKEN_DAYS, type PushDeps, type PushMessage } from '../src/handlers/push'
import { revokeDevice } from '../src/handlers/pairing'
import { processMemo, type MemoDeps } from '../src/handlers/memo'
import { processReaction, type ReactionDeps } from '../src/handlers/reactions'
import { processSettingsChange } from '../src/handlers/audit'
import { resetPlansCache } from '../src/plans'
import { resetHomeCache, setTravelGeocoder } from '../src/travel'
import { db, clearFirestore, seedMembership, count } from './setup'

const MSG: PushMessage = { title: 'Daylie', body: '어머니님이 새 사진을 올렸어요', data: { type: 'photo.new' } }
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
  resetSystemHistory()
  resetPlansCache()
  resetHomeCache()
  setTravelGeocoder(async () => ({ place: '', address: '' }))
  await flag(true)
})

describe('the message sent to FCM', () => {
  it('carries the words, what the installed apps need to open the right place, and a link for browsers', () => {
    const m = fcmMessage([TOKEN(1)], { title: 'Daylie', body: '요약이 도착했어요', data: { type: 'digest.ready', patientUid: 'p1', digestId: 'd1' }, path: 'digest/d1' })
    expect(m.tokens).toEqual([TOKEN(1)])
    expect(m.notification).toEqual({ title: 'Daylie', body: '요약이 도착했어요' })
    expect(m.data).toEqual({ type: 'digest.ready', patientUid: 'p1', digestId: 'd1' })
    expect(m.webpush?.fcmOptions?.link).toMatch(/\/digest\/d1$/)
    expect(fcmMessage([TOKEN(1)], { ...MSG, path: openPath.memo('p1', 'm1') }).webpush?.fcmOptions?.link).toMatch(/\/\?open=memo&p=p1&m=m1$/)
    // iPhone app: the banner makes a sound.
    expect(m.apns?.payload?.aps?.sound).toBe('default')
  })

  it('puts the unread count on the store apps\' icon, and leaves it alone when there is none', () => {
    const m = fcmMessage([TOKEN(1)], { ...MSG, data: { ...MSG.data, badge: '3' } })
    expect(m.apns?.payload?.aps?.badge).toBe(3)
    expect(m.android?.notification?.notificationCount).toBe(3)
    const none = fcmMessage([TOKEN(1)], MSG)
    expect(none.apns?.payload?.aps?.badge).toBeUndefined()
    expect(none.android).toBeUndefined()
  })
})

describe('pushToUsers', () => {
  it('sends to every device of each recipient', async () => {
    await registerFcmToken(KID, { token: TOKEN(1) })
    await registerFcmToken(KID, { token: TOKEN(2) })
    const f = fcm()
    await pushToUsers(['cg1', 'cg1', 'nobody'], MSG, f)
    expect(f.sent).toEqual([{ tokens: [TOKEN(1), TOKEN(2)], message: { ...MSG, data: { ...MSG.data, badge: '0' } } }])
  })

  it('tells each device how many notices its person has not seen, for the icon badge', async () => {
    await registerFcmToken(KID, { token: TOKEN(1) })
    const notice = (id: string, recipientUid: string, read: boolean) => db.doc(`notifications/${id}`).set({ recipientUid, read, type: 'photo.new' })
    await notice('n1', 'cg1', false)
    await notice('n2', 'cg1', false)
    await notice('n3', 'cg1', true)
    await notice('n4', 'someone-else', false)
    const f = fcm()
    await pushToUsers(['cg1'], MSG, f)
    expect(f.sent[0].message.data?.badge).toBe('2')
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
    await expect(pushToUsers(['cg1'], MSG, { retryMs: 0, send: async () => { throw new Error('fcm down') } })).resolves.toBe(0)
  })

  it('does not count a push FCM could not pass on (a bad APNs key) as reaching anyone', async () => {
    await registerFcmToken(KID, { token: TOKEN(1) })
    const badKey: PushDeps = { send: async () => ({ dead: [], failed: { 'messaging/third-party-auth-error': 1 } }) }
    expect(await pushToUsers(['cg1'], MSG, badKey)).toBe(0)
    expect(await tokensOf('cg1')).toEqual([TOKEN(1)]) // the token is fine; the key is not
  })

  it('tries a brief FCM failure once more, for the tokens that failed', async () => {
    await registerFcmToken(KID, { token: TOKEN(1) })
    await registerFcmToken(KID, { token: TOKEN(2) })
    const batches: string[][] = []
    const flaky: PushDeps = {
      retryMs: 0,
      send: async (tokens) => {
        batches.push(tokens)
        return batches.length === 1 ? { dead: [], brief: [TOKEN(2)] } : { dead: [] }
      },
    }
    expect(await pushToUsers(['cg1'], MSG, flaky)).toBe(1)
    expect(batches).toEqual([[TOKEN(1), TOKEN(2)], [TOKEN(2)]])
    expect(pushHealth().failAt).toBeNull()
  })

  it('tries a batch that threw once more, and no more than that', async () => {
    await registerFcmToken(KID, { token: TOKEN(1) })
    let calls = 0
    const once: PushDeps = { retryMs: 0, send: async () => { if (++calls === 1) throw new Error('fcm down'); return { dead: [] } } }
    expect(await pushToUsers(['cg1'], MSG, once)).toBe(1)
    calls = 0
    const down: PushDeps = { retryMs: 0, send: async () => { calls++; throw new Error('fcm down') } }
    expect(await pushToUsers(['cg1'], MSG, down)).toBe(0)
    expect(calls).toBe(2)
  })

  it('one person failing does not stop the others', async () => {
    await registerFcmToken(KID, { token: TOKEN('kid') })
    await registerFcmToken({ uid: 'cg2', email: 'b@example.com', name: '수진' }, { token: TOKEN('other') })
    const got: string[] = []
    const deps: PushDeps = { retryMs: 0, send: async (tokens) => {
      if (tokens[0] === TOKEN('kid')) throw new Error('bad batch')
      got.push(tokens[0]); return { dead: [] }
    } }
    expect(await pushToUsers(['cg1', 'cg2'], MSG, deps)).toBe(1)
    expect(got).toEqual([TOKEN('other')])
  })

  it('a send FCM accepts shows the phone is still there, so another device registering keeps it', async () => {
    await registerFcmToken(KID, { token: TOKEN('phone') })
    const old = Timestamp.fromMillis(Date.now() - 90 * 86_400_000)
    await db.doc('users/cg1/private/push').set({ fcmSeen: { [TOKEN('phone')]: old } }, { merge: true })
    await pushToUsers(['cg1'], MSG, fcm())
    await registerFcmToken(KID, { token: TOKEN('tablet') })
    expect(await tokensOf('cg1')).toEqual([TOKEN('phone'), TOKEN('tablet')])
  })

  it('remembers how pushes have been going, for the heartbeat', async () => {
    await registerFcmToken(KID, { token: TOKEN(1) })
    await pushToUsers(['cg1'], MSG, fcm())
    expect(pushHealth().okAt).toEqual(expect.any(Number))
    expect(pushHealth().failAt).toBeNull()
    await pushToUsers(['cg1'], MSG, { send: async () => ({ dead: [], failed: { 'messaging/third-party-auth-error': 1 } }) })
    expect(pushHealth()).toMatchObject({ failCode: 'messaging/third-party-auth-error', failAt: expect.any(Number) })
  })

  it('forgets when a pruned token was last seen', async () => {
    await registerFcmToken(KID, { token: TOKEN('gone') })
    await pushToUsers(['cg1'], MSG, fcm([TOKEN('gone')]))
    expect((await db.doc('users/cg1/private/push').get()).data()?.fcmSeen).toEqual({})
  })
})

describe('otherFailures', () => {
  it('counts failed sends by code, leaving out dead tokens', () => {
    expect(otherFailures([
      { success: true },
      { success: false, error: { code: 'messaging/third-party-auth-error' } },
      { success: false, error: { code: 'messaging/third-party-auth-error' } },
      { success: false, error: { code: 'messaging/registration-token-not-registered' } },
    ])).toEqual({ 'messaging/third-party-auth-error': 2 })
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

  it('drops the token a device names as the one it replaces', async () => {
    await registerFcmToken(KID, { token: TOKEN('laptop') })
    await registerFcmToken(KID, { token: TOKEN('old') })
    await registerFcmToken(KID, { token: TOKEN('new'), replaces: TOKEN('old') })
    expect(await tokensOf('cg1')).toEqual([TOKEN('laptop'), TOKEN('new')])
    await registerFcmToken(KID, { token: TOKEN('new'), replaces: TOKEN('new') }) // itself: kept
    await registerFcmToken(KID, { token: TOKEN('new'), replaces: TOKEN('unknown') })
    expect(await tokensOf('cg1')).toEqual([TOKEN('laptop'), TOKEN('new')])
  })

  it('drops a token not registered for 60 days when another device registers, never on its own', async () => {
    const old = Timestamp.fromMillis(Date.now() - (STALE_TOKEN_DAYS + 1) * 24 * 60 * 60 * 1000)
    const recent = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000)
    await db.doc('users/cg1/private/push').set({
      fcmTokens: [TOKEN('deleted-app'), TOKEN('tablet'), TOKEN('from-before')],
      fcmSeen: { [TOKEN('deleted-app')]: old, [TOKEN('tablet')]: recent },
    })
    await registerFcmToken(KID, { token: TOKEN('tablet'), remove: true })
    expect(await tokensOf('cg1')).toEqual([TOKEN('deleted-app'), TOKEN('from-before')]) // a remove never sweeps
    await registerFcmToken(KID, { token: TOKEN('phone') })
    expect(await tokensOf('cg1')).toEqual([TOKEN('from-before'), TOKEN('phone')]) // unstamped ones age from now
    const seen = (await db.doc('users/cg1/private/push').get()).data()?.fcmSeen
    expect(Object.keys(seen).sort()).toEqual([TOKEN('from-before'), TOKEN('phone')].sort())
  })

  it('leaves a parent phone\'s token on the same doc alone', async () => {
    await db.doc('users/cg1/private/push').set({ elderTokens: { d1: TOKEN('e1') } })
    await registerFcmToken(KID, { token: TOKEN(1) })
    expect((await db.doc('users/cg1/private/push').get()).data()?.elderTokens).toEqual({ d1: TOKEN('e1') })
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
    resetSystemHistory()
    await processMemo('m1', 1, deps)
    await db.doc('memos/m1').update({ status: 'pending' }) // a re-write
    await processMemo('m1', 1, deps)
    // 운영실 시스템 remembers how long the family waited — the first time only.
    expect(history().memoTimes).toHaveLength(1)
    expect(pushes).toEqual([{ uids: ['cg1'], message: { title: 'Daylie', body: '어머니님이 새 사진을 올렸어요', data: { type: 'photo.new', patientUid: 'p1', memoId: 'm1' }, path: '?open=memo&p=p1&m=m1' } }])
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
    expect(pushes[0]).toMatchObject({ uids: ['cg1'], message: { body: '어머니님이 음성 답장을 남기셨어요', data: { type: 'reaction.voice', reactionId: 'v1' }, path: '?open=memo&p=p1&m=m1' } })
  })
})

describe("a parent's paired phone", () => {
  const PHONE = { uid: 'p1', email: null, name: null }
  const elderTokens = async () => (await db.doc('users/p1/private/push').get()).data()?.elderTokens ?? {}
  beforeEach(async () => {
    await db.doc('users/p1').set({ patientName: '어머니', accountType: 'managed' })
    await db.doc('users/p1/devices/d1').set({ name: 'iPhone', platform: 'ios', status: 'active' })
    await db.doc('users/p1/devices/old').set({ name: 'old', platform: 'ios', status: 'revoked' })
    await seedMembership('p1', 'cg1')
  })

  it('registers its token against its device, and only an active one', async () => {
    await registerFcmToken(PHONE, { token: TOKEN('e1'), deviceId: 'd1' })
    expect(await elderTokens()).toEqual({ d1: TOKEN('e1') })
    await expect(registerFcmToken(PHONE, { token: TOKEN('e2'), deviceId: 'old' })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(registerFcmToken(PHONE, { token: TOKEN('e2') })).rejects.toThrow(/family account/)
    await expect(registerFcmToken({ uid: 'cg9', email: null, name: null }, { token: TOKEN('e2'), deviceId: 'd1' })).rejects.toMatchObject({ code: 'permission-denied' })
    expect(await tokensOf('p1')).toEqual([])
  })

  it('is pushed with the number of photos not looked at and news not read', async () => {
    await registerFcmToken(PHONE, { token: TOKEN('e1'), deviceId: 'd1' })
    const fp = (id: string, extra: Record<string, unknown> = {}) => db.doc(`familyPhotos/${id}`).set({ patientUid: 'p1', senderUid: 'cg1', status: 'ready', createdAtMs: 1, ...extra })
    await fp('a'); await fp('b'); await fp('c', { seenAtMs: 5 }); await fp('d', { status: 'pending' })
    const rx = (id: string, extra: Record<string, unknown> = {}) => db.doc(`reactions/${id}`).set({ patientUid: 'p1', memoId: 'm1', status: 'ready', actorUid: 'cg1', kind: 'heart', ...extra })
    await rx('r1'); await rx('r2', { readByElderAt: Timestamp.now() }); await rx('r3', { actorUid: 'p1' })
    expect(await elderBadge('p1')).toBe(3)
    const f = fcm()
    expect(await pushToElder('p1', MSG, f)).toBe(1)
    expect(f.sent).toEqual([{ tokens: [TOKEN('e1')], message: { ...MSG, data: { ...MSG.data, badge: '3' } } }])
    expect(await pushToElder('p9', MSG, fcm())).toBe(0)
  })

  it('loses the token when the phone is unlinked, or when FCM says it is dead', async () => {
    await registerFcmToken(PHONE, { token: TOKEN('e1'), deviceId: 'd1' })
    await db.doc('users/p1/devices/d2').set({ name: 'Galaxy', platform: 'android', status: 'active' })
    await registerFcmToken(PHONE, { token: TOKEN('e2'), deviceId: 'd2' })
    await revokeDevice('p1', 'd2', 'cg1')
    expect(await elderTokens()).toEqual({ d1: TOKEN('e1') })
    await pushToElder('p1', MSG, fcm([TOKEN('e1')]))
    expect(await elderTokens()).toEqual({})
  })
})
