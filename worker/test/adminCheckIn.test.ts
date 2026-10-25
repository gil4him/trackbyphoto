// 운영실 D10: 안부 알림 — the approved line to every linked family member,
// at most once per parent every 72 hours, only while the parent is quiet.

import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { addressed, adminSendCheckIn, checkInLine } from '../src/handlers/adminCheckIn'
import { db, clearFirestore, seedMembership } from './setup'

const ADMIN = { uid: 'admin1', email: 'zymer4him@gmail.com', name: 'Shawn', emailVerified: true }
const H = 3_600_000
const pushes: { uids: string[]; body: string }[] = []
const deps = { push: async (uids: string[], m: { body: string }) => { pushes.push({ uids, body: m.body }); return uids.length } }

async function parent(uid: string, name: string, lastPhotoHoursAgo: number | null) {
  await db.doc(`users/${uid}`).set({ accountType: 'managed', patientName: name })
  if (lastPhotoHoursAgo !== null) await db.collection('memos').add({ patientUid: uid, takenAt: Timestamp.fromMillis(Date.now() - lastPhotoHoursAgo * H), status: 'ready' })
}

beforeEach(async () => {
  await clearFirestore()
  pushes.length = 0
})

describe('the wording', () => {
  it('is the owner-approved line, with kin words never getting 님', () => {
    expect(checkInLine('영희')).toBe('요즘 영희님 사진이 뜸해요. 3일째 소식이 없는데, 전화 한 통 드려 보시는 건 어때요?')
    expect(addressed('엄마')).toBe('엄마')
    expect(addressed('엄마님')).toBe('엄마')
    expect(addressed('할머니')).toBe('할머니')
    expect(addressed('영희님')).toBe('영희님')
    expect(addressed('  ')).toBe('부모님')
  })
})

describe('adminSendCheckIn', () => {
  it('refuses everyone but the admin, and an empty or oversized list', async () => {
    await expect(adminSendCheckIn({ uid: 'x', email: 'x@example.com', name: 'x' }, { patientUids: ['p'] }, deps)).rejects.toThrow(/admin only/)
    await expect(adminSendCheckIn(ADMIN, { patientUids: [] }, deps)).rejects.toThrow(/required/)
    await expect(adminSendCheckIn(ADMIN, { patientUids: Array.from({ length: 51 }, (_, i) => `p${i}`) }, deps)).rejects.toThrow(/at most 50/)
  })

  it('tells every linked family member — in 알림 and by push — and logs it', async () => {
    await parent('mom', '엄마', 80)
    await seedMembership('mom', 'kid1', { role: 'guardian' })
    await seedMembership('mom', 'kid2', { role: 'viewer' })
    await seedMembership('mom', 'gone', { role: 'viewer', status: 'revoked' })

    const r = await adminSendCheckIn(ADMIN, { patientUids: ['mom'] }, deps)
    expect(r).toEqual({ sent: [{ patientUid: 'mom', recipients: 2 }], skipped: [] })
    const notes = (await db.collection('notifications').get()).docs.map((d) => d.data())
    expect(notes.map((n) => n.recipientUid).sort()).toEqual(['kid1', 'kid2'])
    expect(notes[0]).toMatchObject({ patientUid: 'mom', type: 'checkin.quiet', read: false, message: '요즘 엄마 사진이 뜸해요. 3일째 소식이 없는데, 전화 한 통 드려 보시는 건 어때요?' })
    expect(pushes).toEqual([{ uids: ['kid1', 'kid2'], body: notes[0].message }])
    const log = (await db.collection('admin_log').get()).docs.map((d) => d.data())
    expect(log).toEqual([expect.objectContaining({ action: 'checkin.send', targetUid: 'mom', targetName: '엄마', details: { recipients: 2 } })])
  })

  it('at most once every 72 hours per parent', async () => {
    await parent('mom', '엄마', 100)
    await seedMembership('mom', 'kid1')
    await adminSendCheckIn(ADMIN, { patientUids: ['mom'] }, deps)
    const again = await adminSendCheckIn(ADMIN, { patientUids: ['mom'] }, deps)
    expect(again).toEqual({ sent: [], skipped: [{ patientUid: 'mom', reason: 'recent' }] })
    expect((await db.collection('notifications').get()).size).toBe(1)
    // Three days later it may go again.
    await db.doc('users/mom/private/checkin').set({ lastSentAt: Timestamp.fromMillis(Date.now() - 73 * H) })
    expect((await adminSendCheckIn(ADMIN, { patientUids: ['mom'] }, deps)).sent).toHaveLength(1)
  })

  it('skips a parent who sent a photo again, has nobody linked, or is not a parent', async () => {
    await parent('back', '아빠', 5)
    await seedMembership('back', 'kid1')
    await parent('alone', '할머니', null)
    await db.doc('users/kid1').set({ patientName: '지민' })
    const r = await adminSendCheckIn(ADMIN, { patientUids: ['back', 'alone', 'kid1'] }, deps)
    expect(r.sent).toEqual([])
    expect(r.skipped).toEqual([
      { patientUid: 'back', reason: 'not-quiet' },
      { patientUid: 'alone', reason: 'no-family' },
      { patientUid: 'kid1', reason: 'not-a-parent' },
    ])
    expect((await db.collection('notifications').get()).size).toBe(0)
    expect((await db.collection('admin_log').get()).size).toBe(0)
  })
})
