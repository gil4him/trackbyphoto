// Admin dashboard handlers (worker/src/handlers/adminPeople.ts). Runs
// against the Firestore + Auth emulators (`npm test`).

import { describe, it, expect, beforeEach } from 'vitest'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp } from 'firebase-admin/firestore'
import {
  adminDeleteAccount,
  adminGetPerson,
  adminListPeople,
  adminSetDisabled,
  adminSetMembership,
  adminSetPlan,
  adminUnlinkDevice,
  adminUpdateSettings,
} from '../src/handlers/adminPeople'
import { createManagedElder, createPairingLink, pairDevice, resetPairingThrottle } from '../src/handlers/pairing'
import { db, clearFirestore, seedMembership } from './setup'

const ADMIN = { uid: 'admin1', email: 'zymer4him@gmail.com', name: 'Shawn', emailVerified: true }
// The same address on a token Google never verified (a password account).
const IMPOSTOR = { uid: 'admin2', email: 'zymer4him@gmail.com', name: 'Shawn', emailVerified: false }
const FAMILY = { uid: 'fam1', email: 'kid@example.com', name: '딸' }
const SIBLING = { uid: 'sib1', email: 'sib@example.com', name: '동생' }
const STRANGER = { uid: 'x1', email: 'x@example.com', name: 'x' }

async function seedFamily(uid: string, email: string) {
  await getAuth().createUser({ uid, email, displayName: email.split('@')[0] })
}

async function registerElder(by = FAMILY) {
  const { patientUid } = await createManagedElder(by, { patientName: '엄마' })
  return patientUid
}

beforeEach(async () => {
  await clearFirestore()
  resetPairingThrottle()
  const all = await getAuth().listUsers(1000)
  await Promise.all(all.users.map((u) => getAuth().deleteUser(u.uid).catch(() => {})))
})

describe('authorization', () => {
  it('refuses everyone but the admin', async () => {
    await expect(adminListPeople(FAMILY)).rejects.toThrow(/admin only/)
    await expect(adminGetPerson(FAMILY, { uid: 'a' })).rejects.toThrow(/admin only/)
    await expect(adminDeleteAccount(FAMILY, { uid: 'a' })).rejects.toThrow(/admin only/)
    await expect(adminUnlinkDevice(FAMILY, { patientUid: 'a', deviceId: 'd' })).rejects.toThrow(/admin only/)
    await expect(adminSetMembership(FAMILY, { patientUid: 'a', caregiverUid: 'b', role: 'viewer' })).rejects.toThrow(/admin only/)
    await expect(adminSetPlan(FAMILY, { patientUid: 'a', tier: 'plus' })).rejects.toThrow(/admin only/)
    await expect(adminUpdateSettings(FAMILY, { uid: 'a', patch: { patientName: 'x' } })).rejects.toThrow(/admin only/)
    await expect(adminSetDisabled(FAMILY, { uid: 'a', disabled: true })).rejects.toThrow(/admin only/)
  })

  it('refuses the admin address on a token Google never verified', async () => {
    await expect(adminListPeople(IMPOSTOR)).rejects.toThrow(/admin only/)
    await expect(adminDeleteAccount(IMPOSTOR, { uid: 'a' })).rejects.toThrow(/admin only/)
    await expect(adminSetDisabled(IMPOSTOR, { uid: 'a', disabled: true })).rejects.toThrow(/admin only/)
    await expect(adminListPeople({ ...ADMIN, emailVerified: undefined })).rejects.toThrow(/admin only/)
  })
})

describe('adminListPeople', () => {
  it('lists parents and family members with their links, phones and photos', async () => {
    await seedFamily(FAMILY.uid, FAMILY.email)
    const patientUid = await registerElder()
    const { code } = await createPairingLink(FAMILY, { patientUid, mode: 'qr' })
    await pairDevice({ uid: 'anon1', email: null, name: null }, { code, device: { name: 'iPhone', platform: 'ios' } })
    await db.collection('memos').add({ patientUid, status: 'ready', takenAt: Timestamp.fromDate(new Date('2026-10-10T09:00:00Z')) })
    await db.collection('memos').add({ patientUid, status: 'ready', takenAt: Timestamp.fromDate(new Date('2026-10-11T09:00:00Z')) })

    const { people } = await adminListPeople(ADMIN)
    const parent = people.find((p) => p.uid === patientUid)!
    const child = people.find((p) => p.uid === FAMILY.uid)!
    expect(parent).toMatchObject({
      kind: 'parent', name: '엄마', email: null, providers: [],
      links: { active: 1, guardians: 1 }, devices: { active: 1, total: 1, platforms: ['ios'] },
      linkUids: [FAMILY.uid],
      memos: { count: 2, lastAt: '2026-10-11T09:00:00.000Z' },
      plan: { tier: 'free', explicit: false },
    })
    expect(child).toMatchObject({ kind: 'child', email: FAMILY.email, links: { active: 1, guardians: 1 }, linkUids: [patientUid], hasSettings: false })
    expect(child.createdAt).toBeTruthy()
  })

  it('lists a parent\'s family with the 대표 first', async () => {
    await seedFamily(FAMILY.uid, FAMILY.email)
    await seedFamily(SIBLING.uid, SIBLING.email)
    const patientUid = await registerElder()
    await seedMembership(patientUid, SIBLING.uid, { role: 'viewer' })
    // A revoked link is not family any more.
    await seedMembership(patientUid, STRANGER.uid, { role: 'viewer', status: 'revoked' })
    const { people } = await adminListPeople(ADMIN)
    expect(people.find((p) => p.uid === patientUid)!.linkUids).toEqual([FAMILY.uid, SIBLING.uid])
  })

  it('treats an Auth user with no email and no provider as a parent even without settings', async () => {
    const { uid } = await getAuth().createUser({ displayName: '아빠' })
    const { people } = await adminListPeople(ADMIN)
    expect(people.find((p) => p.uid === uid)).toMatchObject({ kind: 'parent', name: '아빠' })
  })
})

describe('adminGetPerson', () => {
  it('returns links both ways, devices, consents, the audit trail and plan history', async () => {
    await seedFamily(FAMILY.uid, FAMILY.email)
    const patientUid = await registerElder()
    await adminSetPlan(ADMIN, { patientUid, tier: 'plus' })

    const parent = await adminGetPerson(ADMIN, { uid: patientUid })
    expect(parent.settings).toMatchObject({ patientName: '엄마', accountType: 'managed' })
    expect(parent.linkList).toHaveLength(1)
    expect(parent.linkList[0]).toMatchObject({ caregiverUid: FAMILY.uid, role: 'guardian', otherName: 'kid', otherEmail: FAMILY.email })
    expect(parent.consents).toHaveLength(2)
    expect(parent.audit.map((a) => a.action).sort()).toEqual(['elder.create', 'plan.change'])
    expect(parent.planHistory[0].details).toMatchObject({ from: 'free', to: 'plus', provider: 'admin' })
    expect(parent.plan).toMatchObject({ tier: 'plus', explicit: true })

    const child = await adminGetPerson(ADMIN, { uid: FAMILY.uid })
    expect(child.linkList[0]).toMatchObject({ patientUid, otherName: '엄마', otherEmail: null })
    // What this person did on the parent's record shows up on their own page.
    expect(child.audit.map((a) => a.action)).toContain('elder.create')
  })

  it('says so for an account that does not exist', async () => {
    await expect(adminGetPerson(ADMIN, { uid: 'nobody' })).rejects.toThrow(/no such account/)
  })
})

describe('adminDeleteAccount', () => {
  it('erases a parent and keeps the admin_log row', async () => {
    await seedFamily(FAMILY.uid, FAMILY.email)
    const patientUid = await registerElder()
    await db.collection('memos').add({ patientUid, status: 'ready' })

    const res = await adminDeleteAccount(ADMIN, { uid: patientUid })
    expect(res.kind).toBe('parent')
    await expect(getAuth().getUser(patientUid)).rejects.toThrow()
    expect((await db.doc(`users/${patientUid}`).get()).exists).toBe(false)
    expect((await db.collection('memos').where('patientUid', '==', patientUid).get()).size).toBe(0)
    expect((await db.doc(`memberships/${patientUid}_${FAMILY.uid}`).get()).exists).toBe(false)
    const log = await db.collection('admin_log').where('targetUid', '==', patientUid).get()
    expect(log.size).toBe(1)
    expect(log.docs[0].data()).toMatchObject({ action: 'account.delete', actorUid: ADMIN.uid, targetName: '엄마', details: { kind: 'parent' } })
  })

  it('erases a family member and leaves their parent alone', async () => {
    await seedFamily(FAMILY.uid, FAMILY.email)
    const patientUid = await registerElder()
    await db.doc(`users/${FAMILY.uid}`).set({ patientName: '엄마', recipients: [] })

    const res = await adminDeleteAccount(ADMIN, { uid: FAMILY.uid })
    expect(res.kind).toBe('child')
    await expect(getAuth().getUser(FAMILY.uid)).rejects.toThrow()
    expect((await db.doc(`users/${FAMILY.uid}`).get()).exists).toBe(false)
    expect((await db.doc(`users/${patientUid}`).get()).exists).toBe(true)
    expect((await db.doc(`memberships/${patientUid}_${FAMILY.uid}`).get()).exists).toBe(false)
  })

  it('never deletes the admin itself', async () => {
    await expect(adminDeleteAccount(ADMIN, { uid: ADMIN.uid })).rejects.toThrow(/itself/)
  })
})

describe('adminUnlinkDevice', () => {
  it('revokes the phone', async () => {
    await seedFamily(FAMILY.uid, FAMILY.email)
    const patientUid = await registerElder()
    const { code } = await createPairingLink(FAMILY, { patientUid, mode: 'qr' })
    const paired = await pairDevice({ uid: 'anon1', email: null, name: null }, { code, device: { name: 'iPhone', platform: 'ios' } })
    await adminUnlinkDevice(ADMIN, { patientUid, deviceId: paired.deviceId })
    expect((await db.doc(`users/${patientUid}/devices/${paired.deviceId}`).get()).data()).toMatchObject({ status: 'revoked', revokedBy: ADMIN.uid })
    expect((await db.collection('admin_log').where('action', '==', 'device.unlink').get()).size).toBe(1)
  })
})

describe('adminSetMembership', () => {
  it('changes a role and revokes a link', async () => {
    await seedFamily(FAMILY.uid, FAMILY.email)
    const patientUid = await registerElder()
    await seedMembership(patientUid, SIBLING.uid, { role: 'viewer' })

    await adminSetMembership(ADMIN, { patientUid, caregiverUid: SIBLING.uid, role: 'admin' })
    expect((await db.doc(`memberships/${patientUid}_${SIBLING.uid}`).get()).get('role')).toBe('admin')

    await adminSetMembership(ADMIN, { patientUid, caregiverUid: SIBLING.uid, revoke: true })
    expect((await db.doc(`memberships/${patientUid}_${SIBLING.uid}`).get()).data()).toMatchObject({ status: 'revoked', revokedBy: ADMIN.uid })
    const audit = await db.collection('auditLogs').where('patientUid', '==', patientUid).get()
    expect(audit.docs.map((d) => d.get('action')).sort()).toEqual(['elder.create', 'membership.revoke', 'membership.role'])
  })

  it('keeps the only guardian unless forced', async () => {
    await seedFamily(FAMILY.uid, FAMILY.email)
    const patientUid = await registerElder()
    await expect(adminSetMembership(ADMIN, { patientUid, caregiverUid: FAMILY.uid, role: 'viewer' })).rejects.toThrow(/only guardian/)
    await expect(adminSetMembership(ADMIN, { patientUid, caregiverUid: FAMILY.uid, revoke: true })).rejects.toThrow(/only guardian/)
    await adminSetMembership(ADMIN, { patientUid, caregiverUid: FAMILY.uid, role: 'viewer', force: true })
    expect((await db.doc(`memberships/${patientUid}_${FAMILY.uid}`).get()).get('role')).toBe('viewer')
  })

  it('rejects a bad role', async () => {
    await expect(adminSetMembership(ADMIN, { patientUid: 'p', caregiverUid: 'c', role: 'owner' })).rejects.toThrow(/role must be/)
  })
})

describe('adminSetPlan', () => {
  it('sets the tier without the planSheet flag or a payment', async () => {
    await seedFamily(FAMILY.uid, FAMILY.email)
    const patientUid = await registerElder()
    const first = await adminSetPlan(ADMIN, { patientUid, tier: 'family' })
    expect(first).toMatchObject({ tier: 'family', changed: true })
    expect((await db.doc(`users/${patientUid}`).get()).get('plan')).toMatchObject({ tier: 'family', status: 'active', changedBy: ADMIN.uid, payment: { provider: 'admin' } })
    const again = await adminSetPlan(ADMIN, { patientUid, tier: 'family' })
    expect(again.changed).toBe(false)
    await expect(adminSetPlan(ADMIN, { patientUid, tier: 'gold' })).rejects.toThrow(/tier must be/)
    await expect(adminSetPlan(ADMIN, { patientUid: 'nobody', tier: 'plus' })).rejects.toThrow(/no such account/)
  })
})

describe('adminUpdateSettings', () => {
  it('edits allow-listed fields only', async () => {
    await seedFamily(FAMILY.uid, FAMILY.email)
    const patientUid = await registerElder()
    await adminUpdateSettings(ADMIN, { uid: patientUid, patch: { patientName: '어머니', bigText: false } })
    expect((await db.doc(`users/${patientUid}`).get()).data()).toMatchObject({ patientName: '어머니', bigText: false, lastModifiedBy: ADMIN.uid })
    await expect(adminUpdateSettings(ADMIN, { uid: patientUid, patch: { plan: { tier: 'plus' } } })).rejects.toThrow(/cannot edit: plan/)
    await expect(adminUpdateSettings(ADMIN, { uid: patientUid, patch: { patientName: '  ' } })).rejects.toThrow(/patientName/)
    await expect(adminUpdateSettings(ADMIN, { uid: patientUid, patch: {} })).rejects.toThrow(/nothing/)
  })
})

describe('adminSetDisabled', () => {
  it('blocks and unblocks a sign-in', async () => {
    await seedFamily(FAMILY.uid, FAMILY.email)
    await adminSetDisabled(ADMIN, { uid: FAMILY.uid, disabled: true })
    expect((await getAuth().getUser(FAMILY.uid)).disabled).toBe(true)
    const { people } = await adminListPeople(ADMIN)
    expect(people.find((p) => p.uid === FAMILY.uid)?.disabled).toBe(true)
    await adminSetDisabled(ADMIN, { uid: FAMILY.uid, disabled: false })
    expect((await getAuth().getUser(FAMILY.uid)).disabled).toBe(false)
    expect((await db.collection('admin_log').get()).docs.map((d) => d.get('action')).sort()).toEqual(['account.disable', 'account.enable'])
  })

  it('never disables the admin, and names a missing account', async () => {
    await expect(adminSetDisabled(ADMIN, { uid: ADMIN.uid, disabled: true })).rejects.toThrow(/itself/)
    await expect(adminSetDisabled(ADMIN, { uid: STRANGER.uid, disabled: true })).rejects.toThrow(/no such account/)
  })
})
