// The simple edition's two automatic reminders: a parent's phone silent for a
// day (parent push + family notice, once per 24 h, daytime only) and a connect
// link or family invite nobody accepted after 12 h (the sender, once). Pushes
// are injected fakes; Firestore is the emulator.
import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import {
  NUDGE_TEXT, inDaytime, nameFor, presenceOf, runAbsenceNudges, runPendingReminders,
} from '../src/handlers/nudges'
import { hashCode } from '../src/handlers/pairing'
import type { PushMessage } from '../src/handlers/push'
import { resetPlansCache } from '../src/plans'
import { db, clearFirestore, seedMembership } from './setup'

const KST = (iso: string) => new Date(`${iso}+09:00`)
const NOON = KST('2026-10-03T12:05:00')
const H = 3600_000
const ago = (from: Date, hours: number) => Timestamp.fromMillis(from.getTime() - hours * H)

const flags = (on: Record<string, boolean>) => db.doc('admin_config/plans').set({ flags: on })
const parent = (uid = 'p1', extra: Record<string, unknown> = {}) =>
  db.doc(`users/${uid}`).set({ accountType: 'managed', patientName: '엄마', ...extra })
const phone = (reportedHoursAgo: number | null, version = '1.0.5', uid = 'p1', id = 'd1') =>
  db.doc(`users/${uid}/devices/${id}`).set({
    status: 'active', platform: 'android', name: 'Android phone',
    ...(reportedHoursAgo === null ? {} : { app: { version, platform: 'android', reportedAt: ago(NOON, reportedHoursAgo) } }),
  })
const notices = async (uid: string) =>
  (await db.collection('notifications').where('recipientUid', '==', uid).get()).docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown>)

function fakes() {
  const family: Array<{ uids: string[]; message: PushMessage }> = []
  const elder: Array<{ patientUid: string; message: PushMessage }> = []
  return {
    family, elder,
    deps: {
      pushFamily: async (uids: string[], message: PushMessage) => { family.push({ uids, message }); return uids.length },
      pushElder: async (patientUid: string, message: PushMessage) => { elder.push({ patientUid, message }); return 1 },
    },
  }
}

beforeEach(async () => {
  await clearFirestore()
  resetPlansCache()
  await flags({ absenceNudges: true, pendingLinkNudges: true })
})

describe('wording and gates', () => {
  it('addresses the parent as the family does; English drops 님', async () => {
    await parent('p1', { patientName: '영희님' })
    expect(await nameFor('ko', 'p1')).toBe('영희님')
    expect(await nameFor('en', 'p1')).toBe('영희')
    await parent('p2', { patientName: '엄마' })
    expect(await nameFor('ko', 'p2')).toBe('엄마')
    await parent('p3', { patientName: '' })
    expect(await nameFor('ko', 'p3')).toBe('부모님')
    expect(await nameFor('en', 'p3')).toBe('your parent')
    expect(NUDGE_TEXT.ko.absenceFamily('엄마')).toBe('엄마 휴대폰에서 하루 넘게 Daylie를 열지 않았어요. 전화 한 통 드려 보시는 건 어때요?')
    expect(NUDGE_TEXT.ko.pairingPending('영희님')).toBe('영희님 휴대폰이 아직 연결되지 않았어요. 전화로 도와드리거나 설정에서 링크를 다시 보내 주세요')
    expect(NUDGE_TEXT.en.absenceFamily('Mom')).toBe("Mom hasn't opened Daylie in over a day. How about a quick call?")
  })

  it('daytime is 09:00–21:00 in the given zone', () => {
    expect(inDaytime('Asia/Seoul', KST('2026-10-03T08:59:00'))).toBe(false)
    expect(inDaytime('Asia/Seoul', KST('2026-10-03T09:00:00'))).toBe(true)
    expect(inDaytime('Asia/Seoul', KST('2026-10-03T20:59:00'))).toBe(true)
    expect(inDaytime('Asia/Seoul', KST('2026-10-03T21:00:00'))).toBe(false)
    // 12:05 KST is 20:05 the day before in Los Angeles.
    expect(inDaytime('America/Los_Angeles', NOON)).toBe(true)
    expect(inDaytime('America/Los_Angeles', KST('2026-10-03T14:05:00'))).toBe(false)
  })

  it('reads presence from the phones: hourly reporters after 24 h, daily reporters after 48 h, none → unknown', () => {
    const dev = (h: number, version: string) => ({ app: { version, reportedAt: ago(NOON, h) } })
    expect(presenceOf([dev(23, '1.0.5')], NOON)).toBe('active')
    expect(presenceOf([dev(25, '1.0.5')], NOON)).toBe('absent')
    expect(presenceOf([dev(30, '1.0.4')], NOON)).toBe('active')
    expect(presenceOf([dev(49, '1.0.4')], NOON)).toBe('absent')
    expect(presenceOf([dev(25, '1.1.0')], NOON)).toBe('absent')
    expect(presenceOf([dev(49, '1.0.4'), dev(2, '1.0.5')], NOON)).toBe('active')
    expect(presenceOf([{}], NOON)).toBe('unknown')
    expect(presenceOf([], NOON)).toBe('unknown')
  })
})

describe('runAbsenceNudges', () => {
  it('nudges the parent and tells the family once, then again only after 24 h', async () => {
    await parent()
    await seedMembership('p1', 'cg1')
    await seedMembership('p1', 'cg2')
    await phone(25)
    const { family, elder, deps } = fakes()

    expect(await runAbsenceNudges(NOON, deps)).toBe(1)
    expect(elder).toEqual([{ patientUid: 'p1', message: { title: 'Daylie', body: NUDGE_TEXT.ko.absenceParent, data: { type: 'absence.parent', patientUid: 'p1' } } }])
    for (const uid of ['cg1', 'cg2']) {
      const [n] = await notices(uid)
      expect(n).toMatchObject({ id: `absence_p1_20261003_${uid}`, type: 'absence.family', patientUid: 'p1', actorUid: 'worker', read: false, message: NUDGE_TEXT.ko.absenceFamily('엄마') })
    }
    expect(await notices('p1')).toHaveLength(0)
    expect(family).toHaveLength(1)
    expect([...family[0].uids].sort()).toEqual(['cg1', 'cg2'])
    expect(family[0].message).toMatchObject({ data: { type: 'absence.family', patientUid: 'p1' }, path: '?open=home&p=p1' })

    // An hour later, still absent: nothing new.
    expect(await runAbsenceNudges(new Date(NOON.getTime() + H), deps)).toBe(0)
    expect(elder).toHaveLength(1)
    // The next day at the same hour, still silent: a second round.
    expect(await runAbsenceNudges(new Date(NOON.getTime() + 24 * H), deps)).toBe(1)
    expect(elder).toHaveLength(2)
    expect(await notices('cg1')).toHaveLength(2)
  })

  it('leaves alone a phone that reported, an older phone under 48 h, an unknown phone, a photo taken today, and a parent without family', async () => {
    const { elder, deps } = fakes()
    await parent('p1'); await seedMembership('p1', 'cg1'); await phone(23, '1.0.5', 'p1')
    await parent('p2'); await seedMembership('p2', 'cg1'); await phone(30, '1.0.4', 'p2')
    await parent('p3'); await seedMembership('p3', 'cg1'); await phone(null, '1.0.5', 'p3')
    await parent('p4'); await seedMembership('p4', 'cg1'); await phone(40, '1.0.5', 'p4')
    await db.doc('memos/m1').set({ patientUid: 'p4', takenAt: ago(NOON, 3), status: 'ready' })
    await parent('p5'); await phone(40, '1.0.5', 'p5')
    await parent('p6'); await seedMembership('p6', 'cg1')
    await db.doc('users/p6/devices/old').set({ status: 'revoked', app: { version: '1.0.5', reportedAt: ago(NOON, 40) } })
    expect(await runAbsenceNudges(NOON, deps)).toBe(0)
    expect(elder).toHaveLength(0)
    expect(await notices('cg1')).toHaveLength(0)
  })

  it('waits for the parent\'s daytime, in the parent\'s zone', async () => {
    await parent('p1', { digest: { tz: 'Asia/Seoul' } }); await seedMembership('p1', 'cg1'); await phone(30, '1.0.5', 'p1')
    await parent('p2', { digest: { tz: 'America/Los_Angeles' } }); await seedMembership('p2', 'cg2'); await phone(30, '1.0.5', 'p2')
    const { elder, deps } = fakes()
    // 08:30 KST: Seoul waits; it is 16:30 the day before in LA.
    expect(await runAbsenceNudges(KST('2026-10-03T08:30:00'), deps)).toBe(1)
    expect(elder.map((e) => e.patientUid)).toEqual(['p2'])
    // 21:10 KST: Seoul is past the window, LA (05:10) not yet in it.
    const late = KST('2026-10-03T21:10:00')
    await phone(30, '1.0.5', 'p1'); await phone(30, '1.0.5', 'p2')
    expect(await runAbsenceNudges(late, deps)).toBe(0)
  })

  it('speaks each person\'s language', async () => {
    await parent('p1', { patientName: '영희님', geoLang: 'en' })
    await seedMembership('p1', 'cg_ko'); await seedMembership('p1', 'cg_en')
    await db.doc('users/cg_en').set({ geoLang: 'en' })
    await phone(25)
    const { family, elder, deps } = fakes()
    expect(await runAbsenceNudges(NOON, deps)).toBe(1)
    expect(elder[0].message.body).toBe(NUDGE_TEXT.en.absenceParent)
    expect((await notices('cg_ko'))[0].message).toBe(NUDGE_TEXT.ko.absenceFamily('영희님'))
    expect((await notices('cg_en'))[0].message).toBe(NUDGE_TEXT.en.absenceFamily('영희'))
    expect(family).toHaveLength(2)
  })

  it('does nothing while the switch is off', async () => {
    await flags({ absenceNudges: false }); resetPlansCache()
    await parent(); await seedMembership('p1', 'cg1'); await phone(25)
    const { elder, deps } = fakes()
    expect(await runAbsenceNudges(NOON, deps)).toBe(0)
    expect(elder).toHaveLength(0)
  })
})

describe('runPendingReminders', () => {
  const pairing = (id: string, hoursAgo: number, extra: Record<string, unknown> = {}) =>
    db.doc(`pairings/${id}`).set({
      patientUid: 'p1', codeHash: 'x', purpose: 'onboard', mode: 'remote', status: 'pending', createdBy: 'cg1',
      createdAt: ago(NOON, hoursAgo), expiresAt: Timestamp.fromMillis(NOON.getTime() - hoursAgo * H + 24 * H), claimedBy: null, deviceInfo: null, ...extra,
    })
  const invite = (code: string, hoursAgo: number, extra: Record<string, unknown> = {}) =>
    db.doc(`invites/${code}`).set({
      patientUid: 'p1', patientName: '엄마', role: 'viewer', createdBy: 'cg1', used: false,
      createdAt: ago(NOON, hoursAgo), expiresAt: Timestamp.fromMillis(NOON.getTime() - hoursAgo * H + 24 * H), ...extra,
    })

  it('reminds the sender once about a link still pending after 12 h, remote or QR', async () => {
    await parent()
    await pairing('a', 13)
    await pairing('b', 14, { mode: 'qr', createdBy: 'cg2' })
    const { family, deps } = fakes()
    expect(await runPendingReminders(NOON, deps)).toEqual({ pairings: 2, invites: 0 })
    const [n] = await notices('cg1')
    expect(n).toMatchObject({ id: 'pairing_pending_a', type: 'pairing.pending', patientUid: 'p1', message: NUDGE_TEXT.ko.pairingPending('엄마') })
    expect((await notices('cg2'))[0].id).toBe('pairing_pending_b')
    expect(family).toHaveLength(2)
    expect(family[0].message).toMatchObject({ data: { type: 'pairing.pending', patientUid: 'p1' }, path: '?open=home&p=p1' })
    // Ten minutes later: nothing new.
    expect(await runPendingReminders(new Date(NOON.getTime() + 10 * 60_000), deps)).toEqual({ pairings: 0, invites: 0 })
    expect(family).toHaveLength(2)
  })

  it('skips young, used, replaced, re-link and expired links', async () => {
    await parent()
    await pairing('young', 11)
    await pairing('used', 13, { status: 'used' })
    await pairing('replaced', 13, { status: 'expired' })
    await pairing('repair', 13, { purpose: 'repair', expiresAt: ago(NOON, 12) })
    await pairing('ran-out', 13, { expiresAt: ago(NOON, 1) })
    const { family, deps } = fakes()
    expect(await runPendingReminders(NOON, deps)).toEqual({ pairings: 0, invites: 0 })
    expect(family).toHaveLength(0)
    expect(await notices('cg1')).toHaveLength(0)
  })

  it('waits for daytime, then sends', async () => {
    await parent()
    await pairing('a', 13)
    const { family, deps } = fakes()
    expect(await runPendingReminders(KST('2026-10-03T22:00:00'), deps)).toEqual({ pairings: 0, invites: 0 })
    expect(family).toHaveLength(0)
    expect(await runPendingReminders(NOON, deps)).toEqual({ pairings: 1, invites: 0 })
  })

  it('reminds the inviter once about a family invite nobody took, without the code in the notice id', async () => {
    await parent()
    await invite('123456', 13)
    await invite('222222', 13, { used: true })
    await invite('333333', 13, { createdBy: 'p1' })
    await invite('444444', 5)
    const { family, deps } = fakes()
    expect(await runPendingReminders(NOON, deps)).toEqual({ pairings: 0, invites: 1 })
    const [n] = await notices('cg1')
    expect(n).toMatchObject({ id: `invite_pending_${hashCode('123456').slice(0, 20)}`, type: 'invite.pending', message: NUDGE_TEXT.ko.invitePending })
    expect(n.id).not.toContain('123456')
    expect(family).toHaveLength(1)
    expect(await runPendingReminders(NOON, deps)).toEqual({ pairings: 0, invites: 0 })
  })

  it('does nothing while the switch is off', async () => {
    await flags({ pendingLinkNudges: false }); resetPlansCache()
    await parent(); await pairing('a', 13); await invite('123456', 13)
    const { family, deps } = fakes()
    expect(await runPendingReminders(NOON, deps)).toEqual({ pairings: 0, invites: 0 })
    expect(family).toHaveLength(0)
  })
})
