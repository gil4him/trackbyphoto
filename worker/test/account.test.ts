// 계정 삭제 — a family member erases their own account
// (worker/src/handlers/account.ts). Runs against the Firestore + Auth
// emulators (`npm test`).

import { describe, it, expect, beforeEach } from 'vitest'
import { getAuth } from 'firebase-admin/auth'
import { deleteMyAccount } from '../src/handlers/account'
import { createManagedElder } from '../src/handlers/pairing'
import { db, clearFirestore, seedMembership } from './setup'

const ME = { uid: 'me1', email: 'me@example.com', name: '지은' }
const SIBLING = { uid: 'sib1', email: 'sib@example.com', name: '동생' }

/** Everything the app writes for a signed-in family member: their own
 *  record, the settings doc with its subcollections, and what they left on a
 *  parent's record. */
async function seedMyAccount(uid: string) {
  await getAuth().createUser({ uid, email: `${uid}@example.com` })
  await db.doc(`users/${uid}`).set({ patientName: '지은', recipients: [], retention: '90' })
  await db.doc(`users/${uid}/private/push`).set({ fcmTokens: ['t1'] })
  await db.doc(`users/${uid}/private/contact`).set({ phone: '01012345678' })
  await db.doc(`users/${uid}/devices/d1`).set({ name: 'iPhone', status: 'active' })
  await db.collection('memos').add({ patientUid: uid, status: 'ready', photoPath: `photos/${uid}/p1.jpg` })
  await db.doc(`digests/${uid}_daily_20260101`).set({ patientUid: uid, memoIds: [] })
  await db.collection('consents').add({ patientUid: uid, type: 'sensitive_data', guardianUid: null })
  await db.collection('auditLogs').add({ patientUid: uid, actorUid: uid, action: 'settings.update' })
  await db.collection('notifications').add({ recipientUid: uid, patientUid: uid, type: 'memo.ready' })
  await db.collection('invites').doc('123456').set({ patientUid: uid, createdBy: uid })
  await db.collection('requests').add({ uid, type: 'setChannels', status: 'done' })
}

beforeEach(async () => {
  await clearFirestore()
  for (const uid of ['me1', 'sib1']) await getAuth().deleteUser(uid).catch(() => {})
})

describe('deleteMyAccount', () => {
  it('erases the records, settings, subcollections and the sign-in', async () => {
    await seedMyAccount(ME.uid)
    await seedMembership(ME.uid, SIBLING.uid, { role: 'viewer' }) // family on my own record

    await deleteMyAccount(ME)

    await expect(getAuth().getUser(ME.uid)).rejects.toThrow()
    expect((await db.doc(`users/${ME.uid}`).get()).exists).toBe(false)
    expect((await db.collection(`users/${ME.uid}/private`).get()).size).toBe(0)
    expect((await db.collection(`users/${ME.uid}/devices`).get()).size).toBe(0)
    for (const c of ['memos', 'digests', 'consents', 'auditLogs', 'notifications', 'invites', 'memberships']) {
      expect((await db.collection(c).where('patientUid', '==', ME.uid).get()).size, c).toBe(0)
    }
    expect((await db.collection('requests').where('uid', '==', ME.uid).get()).size).toBe(0)
  })

  it('unlinks the parents it looked after and leaves their records alone', async () => {
    await seedMyAccount(ME.uid)
    const { patientUid } = await createManagedElder(ME, { patientName: '엄마' })
    await db.collection('memos').add({ patientUid, status: 'ready' })
    await db.collection('reactions').add({ patientUid, actorUid: ME.uid, kind: 'heart' })
    await db.collection('familyPhotos').add({ patientUid, senderUid: ME.uid, photoPath: `familyPhotos/${patientUid}/f1.jpg` })
    await seedMembership(patientUid, SIBLING.uid, { role: 'viewer' })

    await deleteMyAccount(ME)

    // The parent's account and photos stay; only this person's links go.
    expect((await db.doc(`users/${patientUid}`).get()).exists).toBe(true)
    expect((await db.collection('memos').where('patientUid', '==', patientUid).get()).size).toBe(1)
    expect((await db.doc(`memberships/${patientUid}_${ME.uid}`).get()).exists).toBe(false)
    expect((await db.doc(`memberships/${patientUid}_${SIBLING.uid}`).get()).exists).toBe(true)
    // What this person left on the parent's record goes with them.
    expect((await db.collection('reactions').where('actorUid', '==', ME.uid).get()).size).toBe(0)
    expect((await db.collection('familyPhotos').where('senderUid', '==', ME.uid).get()).size).toBe(0)
    // The parent's own consents and audit trail are untouched.
    expect((await db.collection('consents').where('patientUid', '==', patientUid).get()).size).toBe(2)
    expect((await db.collection('auditLogs').where('patientUid', '==', patientUid).get()).size).toBe(1)
  })

  it('can be run again after it finished', async () => {
    await seedMyAccount(ME.uid)
    await deleteMyAccount(ME)
    await expect(deleteMyAccount(ME)).resolves.toEqual({ ok: true })
  })

  it("refuses an elder's phone", async () => {
    await getAuth().createUser({ uid: ME.uid, email: ME.email })
    await getAuth().setCustomUserClaims(ME.uid, { elder: true, deviceId: 'd1' })
    await expect(deleteMyAccount(ME)).rejects.toThrow(/elder/)
  })

  it('refuses a family-managed account (the guardian deletes that one)', async () => {
    const { patientUid } = await createManagedElder(ME, { patientName: '엄마' })
    await expect(deleteMyAccount({ uid: patientUid, email: 'mom@example.com', name: '엄마' }))
      .rejects.toThrow(/family-managed/)
    expect((await db.doc(`users/${patientUid}`).get()).exists).toBe(true)
  })

  it('refuses a caller without a signed-in family account', async () => {
    await expect(deleteMyAccount({ uid: 'anon1', email: null, name: null })).rejects.toThrow(/family account/)
    await expect(deleteMyAccount({ uid: '', email: null, name: null })).rejects.toThrow(/sign in/)
  })
})
