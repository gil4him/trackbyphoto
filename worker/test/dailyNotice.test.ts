// The simple edition's one notice a day: photo count or "none yet", at the
// parent's evening hour, once per family member. Push is an injected fake;
// Firestore is the emulator.
import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { dailyNoticeText, runDailyNotices } from '../src/handlers/dailyNotice'
import type { PushMessage } from '../src/handlers/push'
import { db, clearFirestore, seedMembership } from './setup'

const KST = (iso: string) => new Date(`${iso}+09:00`)
const EVENING = KST('2026-10-03T20:05:00')

const patient = (extra: Record<string, unknown> = {}) => db.doc('users/p1').set({ patientName: '엄마', ...extra })
const photo = (id: string, at: Date, extra: Record<string, unknown> = {}) =>
  db.doc(`memos/${id}`).set({ patientUid: 'p1', takenAt: Timestamp.fromDate(at), status: 'ready', ...extra })
const notices = async (uid: string) =>
  (await db.collection('notifications').where('recipientUid', '==', uid).get()).docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown>)

function fakes() {
  const pushes: Array<{ uids: string[]; message: PushMessage }> = []
  return { pushes, deps: { push: async (uids: string[], message: PushMessage) => { pushes.push({ uids, message }); return uids.length } } }
}

beforeEach(async () => { await clearFirestore() })

describe('dailyNoticeText', () => {
  it('counts the day\'s photos, or says there are none yet', () => {
    expect(dailyNoticeText('엄마', 3)).toBe('오늘 엄마님의 사진 3장')
    expect(dailyNoticeText('엄마', 0)).toBe('오늘 아직 엄마님의 사진이 없어요')
    expect(dailyNoticeText('부모님', 1)).toBe('오늘 부모님의 사진 1장')
  })
})

describe('runDailyNotices', () => {
  it('waits for the evening hour', async () => {
    await patient()
    await seedMembership('p1', 'cg1')
    const { pushes, deps } = fakes()
    expect(await runDailyNotices(KST('2026-10-03T19:55:00'), deps)).toBe(0)
    expect(await notices('cg1')).toHaveLength(0)
    expect(pushes).toHaveLength(0)
  })

  it('tells each family member today\'s count once, with one push', async () => {
    await patient()
    await seedMembership('p1', 'cg1')
    await seedMembership('p1', 'cg2')
    await photo('a', KST('2026-10-03T09:00:00'))
    await photo('b', KST('2026-10-03T13:00:00'))
    await photo('broken', KST('2026-10-03T14:00:00'), { status: 'error' })
    await photo('yesterday', KST('2026-10-02T21:00:00'))
    const { pushes, deps } = fakes()
    expect(await runDailyNotices(EVENING, deps)).toBe(1)
    for (const uid of ['cg1', 'cg2']) {
      const [n] = await notices(uid)
      expect(n).toMatchObject({ id: `daily_p1_20261003_${uid}`, type: 'daily.photos', message: '오늘 엄마님의 사진 2장', photoCount: 2, patientUid: 'p1' })
      expect(n.memoId).toBeUndefined()
    }
    expect(await notices('p1')).toHaveLength(0)
    expect(pushes).toHaveLength(1)
    expect(pushes[0].uids.sort()).toEqual(['cg1', 'cg2'])
    expect(pushes[0].message).toMatchObject({ body: '오늘 엄마님의 사진 2장', data: { type: 'daily.photos', patientUid: 'p1' } })

    // Later the same evening, even with another photo: nothing new.
    await photo('c', KST('2026-10-03T20:30:00'))
    expect(await runDailyNotices(KST('2026-10-03T22:00:00'), deps)).toBe(0)
    expect(pushes).toHaveLength(1)
    expect(await notices('cg1')).toHaveLength(1)
  })

  it('a day without photos says so', async () => {
    await patient()
    await seedMembership('p1', 'cg1')
    const { deps } = fakes()
    await runDailyNotices(EVENING, deps)
    expect((await notices('cg1'))[0]).toMatchObject({ type: 'daily.no_photo', message: '오늘 아직 엄마님의 사진이 없어요', photoCount: 0 })
  })

  it('needs no digest flag or plan, and follows the parent\'s own hour and zone', async () => {
    await db.doc('admin_config/plans').set({ flags: { digest: false } })
    await patient({ digest: { cadence: 'daily', hourLocal: 18, tz: 'America/Los_Angeles' } })
    await seedMembership('p1', 'cg1')
    await photo('la', new Date('2026-10-03T10:00:00-07:00'))
    const { deps } = fakes()
    expect(await runDailyNotices(new Date('2026-10-03T17:50:00-07:00'), deps)).toBe(0)
    expect(await runDailyNotices(new Date('2026-10-03T18:10:00-07:00'), deps)).toBe(1)
    expect((await notices('cg1'))[0]).toMatchObject({ id: 'daily_p1_20261003_cg1', message: '오늘 엄마님의 사진 1장' })
  })

  it('says 부모님 when the parent has no name', async () => {
    await db.doc('users/p1').set({})
    await seedMembership('p1', 'cg1')
    const { deps } = fakes()
    await runDailyNotices(EVENING, deps)
    expect((await notices('cg1'))[0].message).toBe('오늘 아직 부모님의 사진이 없어요')
  })
})
