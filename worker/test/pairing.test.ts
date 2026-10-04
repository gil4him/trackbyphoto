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
  pairDevice,
  resetPairingThrottle,
  unlinkDevice,
} from '../src/handlers/pairing'
import { createInvite, setMembershipRole } from '../src/handlers/caregiver'
import { db, clearFirestore, seedMembership, count } from './setup'

const FAMILY = { uid: 'fam1', email: 'kid@example.com', name: '딸' }
const ANON = (uid: string) => ({ uid, email: null, name: null })
const DEVICE = { name: 'iPhone', platform: 'ios' }

async function registerElder() {
  const { patientUid } = await createManagedElder(FAMILY, {
    patientName: '엄마',
    settings: { cadence: 'realtime', autoMode: true, bigText: true },
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
    expect(user).toMatchObject({ patientName: '엄마', accountType: 'managed', createdBy: 'fam1', cadence: 'realtime', lastModifiedBy: 'fam1' })

    const m = (await db.doc(`memberships/${patientUid}_fam1`).get()).data()!
    expect(m).toMatchObject({ role: 'guardian', status: 'active', caregiverName: '딸' })

    const consents = await db.collection('consents').where('patientUid', '==', patientUid).get()
    expect(consents.size).toBe(2)
    consents.forEach((c) => expect(c.data()).toMatchObject({ grantedBy: 'guardian', guardianUid: 'fam1' }))
    expect(await count('auditLogs', 'action', 'elder.create')).toBe(1)
  })

  it('refuses callers without a family (Google) account', async () => {
    await expect(createManagedElder(ANON('anon1'), { patientName: '엄마' })).rejects.toThrow(/family account/)
  })

  it('requires a name', async () => {
    await expect(createManagedElder(FAMILY, { patientName: '  ' })).rejects.toThrow(/patientName/)
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
