// Family-managed elders + device pairing (worker/src/handlers/pairing.ts).
// Runs against the Firestore + Auth emulators (`npm test`).

import { describe, it, expect, beforeEach } from 'vitest'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp } from 'firebase-admin/firestore'
import {
  approvePairing,
  completePairing,
  createManagedElder,
  createPairingLink,
  deleteManagedElder,
  pairDevice,
  resetPairingThrottle,
  unlinkDevice,
} from '../src/handlers/pairing'
import { createInvite, setMembershipRole } from '../src/handlers/caregiver'
import { revokeLinksToDeletedAccounts } from '../src/handlers/housekeeping'
import { db, clearFirestore, seedMembership, count } from './setup'

const FAMILY = { uid: 'fam1', email: 'kid@example.com', name: '딸' }
const ANON = (uid: string) => ({ uid, email: null, name: null })
const DEVICE = { name: 'iPhone', platform: 'ios' }

async function registerElder() {
  const { patientUid } = await createManagedElder(FAMILY, {
    patientName: '엄마',
    settings: { cadence: 'realtime', autoMode: true, bigText: true, geoLang: 'en' },
  })
  return patientUid
}

function claimsOf(customToken: string) {
  const payload = JSON.parse(Buffer.from(customToken.split('.')[1], 'base64url').toString())
  return { uid: payload.uid as string, claims: payload.claims as Record<string, unknown> }
}

beforeEach(async () => {
  await clearFirestore()
  resetPairingThrottle()
})

describe('createManagedElder', () => {
  it('creates the elder account, settings, guardian membership and guardian consents', async () => {
    const patientUid = await registerElder()
    expect((await getAuth().getUser(patientUid)).displayName).toBe('엄마')

    const user = (await db.doc(`users/${patientUid}`).get()).data()!
    expect(user).toMatchObject({ patientName: '엄마', accountType: 'managed', createdBy: 'fam1', cadence: 'realtime', geoLang: 'en', lastModifiedBy: 'fam1' })

    const m = (await db.doc(`memberships/${patientUid}_fam1`).get()).data()!
    expect(m).toMatchObject({ role: 'guardian', status: 'active', caregiverName: '딸' })

    const consents = await db.collection('consents').where('patientUid', '==', patientUid).get()
    expect(consents.size).toBe(2)
    consents.forEach((c) => expect(c.data()).toMatchObject({ grantedBy: 'guardian', guardianUid: 'fam1' }))
    expect(await count('auditLogs', 'action', 'elder.create')).toBe(1)
  })

  it('can make the first phone link in the same call', async () => {
    const res = await createManagedElder(FAMILY, { patientName: '엄마', link: 'qr' })
    expect(res.link).toMatchObject({ purpose: 'onboard' })
    expect(res.link!.code).toHaveLength(8)
    const pairing = await db.collection('pairings').where('patientUid', '==', res.patientUid).get()
    expect(pairing.size).toBe(1)
    expect(pairing.docs[0].data()).toMatchObject({ mode: 'qr', status: 'pending', purpose: 'onboard' })
    expect((await createManagedElder(FAMILY, { patientName: '아빠' })).link).toBeUndefined()
  })

  it('refuses callers without a family (Google) account', async () => {
    await expect(createManagedElder(ANON('anon1'), { patientName: '엄마' })).rejects.toThrow(/family account/)
  })

  it('requires a name', async () => {
    await expect(createManagedElder(FAMILY, { patientName: '  ' })).rejects.toThrow(/patientName/)
  })

  it('records a voice-reply consent only when the guardian agreed to it', async () => {
    const plain = await registerElder()
    expect((await db.doc(`users/${plain}`).get()).data()?.voiceEnabled).toBe(false)
    expect((await db.collection('consents').where('patientUid', '==', plain).where('type', '==', 'voice_reply').get()).size).toBe(0)

    const { patientUid } = await createManagedElder(FAMILY, { patientName: '아버지', voiceConsent: true, consentTextVersion: 'managed-v2' })
    expect((await db.doc(`users/${patientUid}`).get()).data()?.voiceEnabled).toBe(true)
    const consent = (await db.collection('consents').where('patientUid', '==', patientUid).where('type', '==', 'voice_reply').get()).docs[0].data()
    expect(consent).toMatchObject({ grantedBy: 'guardian', guardianUid: FAMILY.uid, consentTextVersion: 'managed-v2' })
  })
})

describe('first-time pairing', () => {
  it('links the phone immediately and returns an elder custom token', async () => {
    const patientUid = await registerElder()
    const link = await createPairingLink(FAMILY, { patientUid })
    expect(link.purpose).toBe('onboard')
    expect(link.code).toMatch(/^[2-9A-HJKMNP-TV-Z]{8}$/)
    expect(link.url).toBe(`https://trackbyphoto.web.app/pair?c=${link.code}`)

    // Raw code is never stored.
    const pairing = (await db.collection('pairings').where('patientUid', '==', patientUid).get()).docs[0].data()
    expect(JSON.stringify(pairing)).not.toContain(link.code)

    const res = await pairDevice(ANON('anon1'), { code: link.code.toLowerCase().replace(/(....)/, '$1-'), device: DEVICE })
    expect(res.status).toBe('paired')
    if (res.status !== 'paired') return
    const { uid, claims } = claimsOf(res.customToken)
    expect(uid).toBe(patientUid)
    expect(claims).toEqual({ elder: true, deviceId: res.deviceId })

    const device = (await db.doc(`users/${patientUid}/devices/${res.deviceId}`).get()).data()!
    expect(device).toMatchObject({ name: 'iPhone', platform: 'ios', status: 'active' })
    expect(await count('notifications', 'type', 'device.pair')).toBe(1)
    expect(await count('auditLogs', 'action', 'device.pair')).toBe(1)
  })

  it('codes are single use', async () => {
    const patientUid = await registerElder()
    const { code } = await createPairingLink(FAMILY, { patientUid })
    await pairDevice(ANON('anon1'), { code, device: DEVICE })
    await expect(pairDevice(ANON('anon2'), { code, device: DEVICE })).rejects.toThrow(/already used/)
  })

  it('expired codes are rejected', async () => {
    const patientUid = await registerElder()
    const { code } = await createPairingLink(FAMILY, { patientUid })
    const snap = await db.collection('pairings').where('patientUid', '==', patientUid).get()
    await snap.docs[0].ref.update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) })
    await expect(pairDevice(ANON('anon1'), { code, device: DEVICE })).rejects.toThrow(/expired/)
  })

  it('a new link cancels the previous one', async () => {
    const patientUid = await registerElder()
    const first = await createPairingLink(FAMILY, { patientUid })
    await createPairingLink(FAMILY, { patientUid })
    await expect(pairDevice(ANON('anon1'), { code: first.code, device: DEVICE })).rejects.toThrow(/already used/)
  })

  it('throttles repeated wrong codes', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(pairDevice(ANON('anon1'), { code: 'ZZZZZZZZ' })).rejects.toThrow(/not found/)
    }
    await expect(pairDevice(ANON('anon1'), { code: 'ZZZZZZZZ' })).rejects.toThrow(/too many/)
  })
})

describe('createPairingLink authz', () => {
  it('rejects people who do not manage the elder', async () => {
    const patientUid = await registerElder()
    await expect(createPairingLink({ uid: 'stranger', email: 's@x.com', name: 's' }, { patientUid })).rejects.toThrow(/guardian or admin/)
    await seedMembership(patientUid, 'viewer1', { role: 'viewer' })
    await expect(createPairingLink({ uid: 'viewer1', email: 'v@x.com', name: 'v' }, { patientUid })).rejects.toThrow(/guardian or admin/)
  })

  it('rejects the elder session itself', async () => {
    const patientUid = await registerElder()
    await expect(createPairingLink({ uid: patientUid, email: null, name: null }, { patientUid })).rejects.toThrow(/family account/)
  })

  it('rejects self-managed (Google) elders', async () => {
    await db.doc('users/p1').set({ patientName: '아빠' })
    await seedMembership('p1', 'fam1', { role: 'admin' })
    await expect(createPairingLink(FAMILY, { patientUid: 'p1' })).rejects.toThrow(/signs in by itself/)
  })
})

describe('re-linking an account that already has a phone', () => {
  async function pairedElder() {
    const patientUid = await registerElder()
    const { code } = await createPairingLink(FAMILY, { patientUid })
    await pairDevice(ANON('anon1'), { code, device: DEVICE })
    return patientUid
  }

  it('remote re-link waits for family approval, then completes', async () => {
    const patientUid = await pairedElder()
    const link = await createPairingLink(FAMILY, { patientUid })
    expect(link.purpose).toBe('repair')

    const res = await pairDevice(ANON('anon2'), { code: link.code, device: { name: 'Galaxy', platform: 'android' } })
    expect(res.status).toBe('awaiting-approval')
    if (res.status !== 'awaiting-approval') return
    expect(await count('notifications', 'type', 'device.approval')).toBe(1)

    // Another phone can't steal the claimed request.
    await expect(completePairing(ANON('anon3'), { pairingId: res.pairingId })).rejects.toThrow(/not your/)
    // Not yet approved.
    expect((await completePairing(ANON('anon2'), { pairingId: res.pairingId })).status).toBe('awaiting-approval')

    await approvePairing(FAMILY, { pairingId: res.pairingId, approve: true })
    const done = await completePairing(ANON('anon2'), { pairingId: res.pairingId })
    expect(done.status).toBe('paired')
    expect((await db.collection(`users/${patientUid}/devices`).get()).size).toBe(2)
  })

  it('denied re-link never gets a token', async () => {
    const patientUid = await pairedElder()
    const { code } = await createPairingLink(FAMILY, { patientUid })
    const res = await pairDevice(ANON('anon2'), { code, device: DEVICE })
    if (res.status !== 'awaiting-approval') throw new Error('expected approval wait')
    await approvePairing(FAMILY, { pairingId: res.pairingId, approve: false })
    await expect(completePairing(ANON('anon2'), { pairingId: res.pairingId })).rejects.toThrow(/denied/)
  })

  it('in-person QR re-link skips approval', async () => {
    const patientUid = await pairedElder()
    const { code } = await createPairingLink(FAMILY, { patientUid, mode: 'qr' })
    expect((await pairDevice(ANON('anon2'), { code, device: DEVICE })).status).toBe('paired')
  })

  it('only family managers can approve', async () => {
    const patientUid = await pairedElder()
    const { code } = await createPairingLink(FAMILY, { patientUid })
    const res = await pairDevice(ANON('anon2'), { code, device: DEVICE })
    if (res.status !== 'awaiting-approval') throw new Error('expected approval wait')
    await expect(approvePairing({ uid: 'stranger', email: 's@x.com', name: 's' }, { pairingId: res.pairingId })).rejects.toThrow(/guardian or admin/)
  })
})

describe('unlinkDevice', () => {
  it('revokes the device, logs it and notifies other family', async () => {
    const patientUid = await registerElder()
    await seedMembership(patientUid, 'fam2', { role: 'admin' })
    const { code } = await createPairingLink(FAMILY, { patientUid })
    const res = await pairDevice(ANON('anon1'), { code, device: DEVICE })
    if (res.status !== 'paired') throw new Error('expected pairing')

    await unlinkDevice(FAMILY, { patientUid, deviceId: res.deviceId })
    const device = (await db.doc(`users/${patientUid}/devices/${res.deviceId}`).get()).data()!
    expect(device).toMatchObject({ status: 'revoked', revokedBy: 'fam1' })
    expect(await count('auditLogs', 'action', 'device.unlink')).toBe(1)
    const notices = await db.collection('notifications').where('type', '==', 'device.unlink').get()
    expect(notices.docs.map((d) => d.data().recipientUid)).toEqual(['fam2'])
    // Last phone gone → refresh tokens revoked.
    expect((await getAuth().getUser(patientUid)).tokensValidAfterTime).toBeTruthy()
  })

  it('rejects non-managers', async () => {
    const patientUid = await registerElder()
    await expect(unlinkDevice({ uid: 'stranger', email: 's@x.com', name: 's' }, { patientUid, deviceId: 'd1' })).rejects.toThrow(/guardian or admin/)
  })
})

describe('managed elder cannot manage sharing from their own phone', () => {
  it('createInvite and setMembershipRole are denied to the elder session', async () => {
    const patientUid = await registerElder()
    const elder = { uid: patientUid, email: null, name: null }
    await expect(createInvite(elder, { patientUid, role: 'admin' })).rejects.toThrow(/only the patient or an admin/)
    await expect(setMembershipRole(elder, { patientUid, caregiverUid: 'fam1', role: 'viewer' })).rejects.toThrow(/owner or a guardian/)
  })

  it('the guardian can invite more family', async () => {
    const patientUid = await registerElder()
    const res = await createInvite(FAMILY, { patientUid, role: 'admin' })
    expect(res.code).toMatch(/^\d{6}$/)
  })
})

describe('deleteManagedElder', () => {
  it('erases the elder account, devices and every patient-owned doc', async () => {
    const patientUid = await registerElder()
    const link = await createPairingLink(FAMILY, { patientUid })
    await pairDevice(ANON('anon1'), { code: link.code, device: DEVICE })
    await seedMembership(patientUid, 'fam2', { role: 'viewer' })
    await db.collection('memos').add({ patientUid, status: 'ready' })
    await db.collection('reactions').add({ patientUid, actorUid: patientUid, kind: 'voice', status: 'ready', notified: true })

    await deleteManagedElder(FAMILY, { patientUid })

    await expect(getAuth().getUser(patientUid)).rejects.toThrow()
    expect((await db.doc(`users/${patientUid}`).get()).exists).toBe(false)
    expect((await db.collection(`users/${patientUid}/devices`).get()).size).toBe(0)
    for (const c of ['memos', 'reactions', 'consents', 'memberships', 'pairings', 'auditLogs', 'notifications']) {
      expect((await db.collection(c).where('patientUid', '==', patientUid).get()).size, c).toBe(0)
    }
  })

  it('only the guardian may delete', async () => {
    const patientUid = await registerElder()
    await seedMembership(patientUid, 'fam2')
    const admin = { uid: 'fam2', email: 'son@example.com', name: '아들' }
    await expect(deleteManagedElder(admin, { patientUid })).rejects.toThrow(/only the guardian/)
    await expect(deleteManagedElder({ uid: patientUid, email: null, name: null }, { patientUid })).rejects.toThrow(/family account/)
    expect((await db.doc(`users/${patientUid}`).get()).exists).toBe(true)
  })

  it('refuses self-managed accounts', async () => {
    await db.doc('users/self1').set({ patientName: '본인' })
    await seedMembership('self1', 'fam1', { role: 'guardian' })
    await expect(deleteManagedElder(FAMILY, { patientUid: 'self1' })).rejects.toThrow(/family-managed/)
  })
})

describe('one name, one person', () => {
  it('refuses a second parent under a name the family member already looks after', async () => {
    await createManagedElder(FAMILY, { patientName: '할아버지' })
    for (const again of ['할아버지', ' 할아버지 ', '할 아버지']) {
      await expect(createManagedElder(FAMILY, { patientName: again })).rejects.toMatchObject({ code: 'already-exists', details: { name: '할아버지' } })
    }
    // Nothing half-made is left behind by a refusal.
    expect((await db.collection('users').get()).size).toBe(1)
    expect((await db.collection('memberships').get()).size).toBe(1)
  })

  it('also counts someone they follow who registered themselves', async () => {
    await db.doc('users/own1').set({ patientName: '엄마' })
    await seedMembership('own1', FAMILY.uid, { role: 'viewer' })
    await expect(createManagedElder(FAMILY, { patientName: '엄마' })).rejects.toMatchObject({ code: 'already-exists' })
  })

  it('allows the name again once that person is gone, and for another family', async () => {
    const first = await createManagedElder(FAMILY, { patientName: '할아버지' })
    await createManagedElder({ uid: 'fam2', email: 'other@example.com', name: '아들' }, { patientName: '할아버지' })
    await deleteManagedElder(FAMILY, { patientUid: first.patientUid })
    await expect(createManagedElder(FAMILY, { patientName: '할아버지' })).resolves.toMatchObject({ patientUid: expect.any(String) })
  })
})

describe('family links to accounts that no longer exist', () => {
  it('are withdrawn when both the settings and the sign-in account are gone, and only then', async () => {
    // Removed outside the app: no settings doc, no sign-in account.
    const gone = await registerElder()
    await getAuth().deleteUser(gone)
    await db.doc(`users/${gone}`).delete()
    await seedMembership(gone, 'sibling', { role: 'viewer' })
    // Still has its sign-in account (settings doc missing).
    const noDoc = (await createManagedElder(FAMILY, { patientName: '아버지' })).patientUid
    await db.doc(`users/${noDoc}`).delete()
    // Entirely fine.
    const fine = (await createManagedElder(FAMILY, { patientName: '이모' })).patientUid

    expect(await revokeLinksToDeletedAccounts()).toBe(2)
    const status = async (patientUid: string, caregiverUid: string) => (await db.doc(`memberships/${patientUid}_${caregiverUid}`).get()).get('status')
    expect(await status(gone, FAMILY.uid)).toBe('revoked')
    expect(await status(gone, 'sibling')).toBe('revoked')
    expect(await status(noDoc, FAMILY.uid)).toBe('active')
    expect(await status(fine, FAMILY.uid)).toBe('active')
    const log = (await db.collection('auditLogs').where('patientUid', '==', gone).get()).docs.map((d) => d.data()).filter((a) => a.action === 'membership.revoke')
    expect(log).toHaveLength(2)
    expect(log[0]).toMatchObject({ actorUid: 'worker', details: { reason: 'account-deleted' } })

    // A second pass finds nothing more to do.
    expect(await revokeLinksToDeletedAccounts()).toBe(0)
  })
})
