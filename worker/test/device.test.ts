// The parent's phone reports its app version; family send it the update notice
// (worker/src/handlers/device.ts). FCM is an injected fake; Firestore is the emulator.

import { describe, it, expect, beforeEach } from 'vitest'
import { reportDevice, sendUpdateNudge, UPDATE_NUDGE_TEXT, type UpdateNudgeDeps } from '../src/handlers/device'
import { pushToElder, registerFcmToken, type PushMessage } from '../src/handlers/push'
import { APP_STORE_URL, PLAY_STORE_URL } from '../src/config'
import { resetPlansCache } from '../src/plans'
import { db, clearFirestore, seedMembership } from './setup'

const PHONE = { uid: 'p1', email: null, name: null }
const GUARDIAN = { uid: 'cg1', email: 'kid@example.com', name: '민수' }
const VIEWER = { uid: 'cg2', email: 'sib@example.com', name: '민지' }
const TOKEN = 'elder-token-' + 'x'.repeat(30)

function fakePush(): UpdateNudgeDeps & { sent: Array<{ tokens: string[]; message: PushMessage }> } {
  const sent: Array<{ tokens: string[]; message: PushMessage }> = []
  return {
    sent,
    pushElder: (p, m) => pushToElder(p, m, { send: async (tokens, message) => { sent.push({ tokens, message }); return { dead: [] } } }),
  }
}

const nudgeState = async () => (await db.doc('users/p1/private/updateNudge').get()).data()
const audits = async () => (await db.collection('auditLogs').where('action', '==', 'device.updateNudge').get()).docs.map((d) => d.data())

beforeEach(async () => {
  await clearFirestore()
  await db.doc('admin_config/plans').set({ flags: { pushFamily: true } })
  resetPlansCache()
  await db.doc('users/p1').set({ patientName: '어머니', accountType: 'managed' })
  await db.doc('users/p1/devices/d1').set({ name: 'iPhone', platform: 'ios', status: 'active' })
  await db.doc('users/p1/devices/old').set({ name: 'old', platform: 'ios', status: 'revoked' })
  await seedMembership('p1', 'cg1', { role: 'guardian' })
  await seedMembership('p1', 'cg2', { role: 'viewer' })
})

describe('reportDevice alert state', () => {
  const report = { deviceId: 'd1', version: '1.0.6', platform: 'ios' }
  const stored = async () => (await db.doc('users/p1/devices/d1').get()).data()

  it('keeps the state beside the version, and a phone that says nothing leaves it alone', async () => {
    await reportDevice(PHONE, { ...report, alerts: 'off' })
    expect((await stored())?.alerts?.state).toBe('off')
    await reportDevice(PHONE, report)
    expect((await stored())?.alerts?.state).toBe('off')
    expect((await stored())?.app?.version).toBe('1.0.6')
  })

  it('refuses a state it does not know', async () => {
    await expect(reportDevice(PHONE, { ...report, alerts: 'maybe' })).rejects.toMatchObject({ code: 'invalid-argument' })
  })
})

describe('reportDevice', () => {
  it('keeps the version on the phone\'s own active device record', async () => {
    expect(await reportDevice(PHONE, { deviceId: 'd1', version: '1.0.3', build: '30', platform: 'ios' })).toEqual({ ok: true })
    const app = (await db.doc('users/p1/devices/d1').get()).data()?.app
    expect(app).toMatchObject({ version: '1.0.3', build: '30', platform: 'ios' })
    expect(app.reportedAt).toBeTruthy()
  })

  it('refuses a revoked phone, a family account and a bad version or platform', async () => {
    await expect(reportDevice(PHONE, { deviceId: 'old', version: '1.0.3', platform: 'ios' })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(reportDevice(GUARDIAN, { deviceId: 'd1', version: '1.0.3', platform: 'ios' })).rejects.toMatchObject({ code: 'permission-denied' })
    for (const version of ['1', '1.0.3-beta', 'x.y.z', '1.0.3.4', '1'.repeat(19) + '.0', 103]) {
      await expect(reportDevice(PHONE, { deviceId: 'd1', version, platform: 'ios' })).rejects.toMatchObject({ code: 'invalid-argument' })
    }
    await expect(reportDevice(PHONE, { deviceId: 'd1', version: '1.0.3', platform: 'web' })).rejects.toMatchObject({ code: 'invalid-argument' })
    await expect(reportDevice(PHONE, { deviceId: 'd1', version: '1.0.3', build: 'b'.repeat(33), platform: 'ios' })).rejects.toMatchObject({ code: 'invalid-argument' })
    expect((await db.doc('users/p1/devices/d1').get()).data()?.app).toBeUndefined()
  })
})

describe('sendUpdateNudge', () => {
  beforeEach(async () => {
    await registerFcmToken(PHONE, { token: TOKEN, deviceId: 'd1' })
    await db.doc('system/app').set({ ios: { version: '1.0.4', source: 'itunes' }, android: { version: '1.0.4', source: 'play' } })
  })

  it('only a guardian or admin may send it', async () => {
    await expect(sendUpdateNudge(VIEWER, { patientUid: 'p1' }, fakePush())).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(sendUpdateNudge(PHONE, { patientUid: 'p1' }, fakePush())).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('tells a phone that reported its version to tap, opening its store, and records it', async () => {
    await reportDevice(PHONE, { deviceId: 'd1', version: '1.0.3', build: '30', platform: 'ios' })
    const push = fakePush()
    const before = Date.now()
    const res = await sendUpdateNudge(GUARDIAN, { patientUid: 'p1' }, push)
    expect(res.reached).toBe(1)
    expect(res.nextAt).toBeGreaterThanOrEqual(before + 24 * 3600_000)
    expect(push.sent).toHaveLength(1)
    expect(push.sent[0].tokens).toEqual([TOKEN])
    expect(push.sent[0].message).toMatchObject({
      title: 'Daylie',
      body: '새 버전이 나왔어요. 눌러서 업데이트해 주세요',
      data: { type: 'app.update', patientUid: 'p1', storeUrl: APP_STORE_URL },
    })
    const state = await nudgeState()
    expect(state).toMatchObject({ lastBy: 'cg1', lastDeviceId: 'd1' })
    expect(state?.lastSentAt).toBeTruthy()
    const rows = await audits()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      patientUid: 'p1', actorUid: 'cg1',
      details: { deviceId: 'd1', appVersion: '1.0.3', latest: '1.0.4', platform: 'ios', reached: 1 },
    })
    expect(rows[0].timestamp).toBeTruthy()
  })

  it('tells an old phone (no version reported) which store to update in, in the parent\'s language', async () => {
    await db.doc('users/p1/devices/d1').update({ platform: 'android' })
    const push = fakePush()
    await sendUpdateNudge(GUARDIAN, { patientUid: 'p1' }, push)
    expect(push.sent[0].message.body).toBe('새 버전이 나왔어요. Play 스토어에서 업데이트해 주세요')
    expect(push.sent[0].message.data?.storeUrl).toBe(PLAY_STORE_URL)

    await db.doc('users/p1/private/updateNudge').delete()
    await db.doc('users/p1/devices/d1').update({ platform: 'ios' })
    await db.doc('users/p1').set({ geoLang: 'en' }, { merge: true })
    const en = fakePush()
    await sendUpdateNudge(GUARDIAN, { patientUid: 'p1' }, en)
    expect(en.sent[0].message.body).toBe(UPDATE_NUDGE_TEXT.en.ios)
    expect(en.sent[0].message.data?.storeUrl).toBe(APP_STORE_URL)
  })

  it('goes out at most once a day per parent', async () => {
    const first = await sendUpdateNudge(GUARDIAN, { patientUid: 'p1' }, fakePush())
    const push = fakePush()
    const err = await sendUpdateNudge(GUARDIAN, { patientUid: 'p1' }, push).catch((e) => e)
    expect(err).toMatchObject({ code: 'resource-exhausted' })
    expect(Math.abs(err.details.nextAt - first.nextAt)).toBeLessThan(5_000)
    expect(push.sent).toHaveLength(0)
    expect(await audits()).toHaveLength(1)
  })

  it('a phone that can\'t get pushes is refused and nothing is recorded', async () => {
    await db.doc('users/p1/private/push').delete()
    await expect(sendUpdateNudge(GUARDIAN, { patientUid: 'p1' }, fakePush())).rejects.toMatchObject({ code: 'failed-precondition', message: 'no phone can get pushes' })
    expect(await nudgeState()).toBeUndefined()
    expect(await audits()).toHaveLength(0)
  })

  it('refuses a phone already on the latest version, and a parent with no linked phone', async () => {
    await reportDevice(PHONE, { deviceId: 'd1', version: '1.0.4', platform: 'ios' })
    await expect(sendUpdateNudge(GUARDIAN, { patientUid: 'p1' }, fakePush())).rejects.toMatchObject({ code: 'failed-precondition', message: 'already up to date' })
    await db.doc('users/p1/devices/d1').update({ status: 'revoked' })
    await expect(sendUpdateNudge(GUARDIAN, { patientUid: 'p1' }, fakePush())).rejects.toMatchObject({ code: 'failed-precondition', message: 'no linked phone' })
    expect(await nudgeState()).toBeUndefined()
  })
})
