// Integration tests for the caregiver-share Cloud Functions.
//
// Strategy: firebase-functions-test (offline) `wrap()`s each function and runs
// its handler in-process, while the function's own admin-SDK writes hit a real
// Firestore emulator (FIRESTORE_EMULATOR_HOST is set by `firebase emulators:exec`).
// We then assert the resulting Firestore docs with the admin SDK.
//
// We import the function source directly from ../functions/src (not index.ts) so
// we don't pull in the Gemini/OpenAI photo-pipeline deps, and we own initializeApp.
//
// Run: npm test   (boots the Firestore emulator, then vitest)

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
// Import admin from the FUNCTIONS' copy (not functions-tests') so it's the exact
// same instance the function source resolves — otherwise initializeApp() here
// registers on a different copy and the handlers see "default app does not exist".
import admin from '../functions/node_modules/firebase-admin/lib/index.js'
import functionsTest from 'firebase-functions-test'

import {
  createInvite,
  acceptInvite,
  revokeMembership,
  setMembershipRole,
  syncCaregiverName,
} from '../functions/src/caregiver'
import { onUserSettingsChanged } from '../functions/src/audit'

const PROJECT = 'demo-trackbyphoto'
process.env.GCLOUD_PROJECT = PROJECT
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'

const testEnv = functionsTest()
admin.initializeApp({ projectId: PROJECT })
const db = admin.firestore()

// ── helpers ──────────────────────────────────────────────────────────────────

interface Auth { uid: string; token?: Record<string, unknown> }

// Invoke a v2 callable as a given user.
function call<T>(fn: T, data: unknown, auth: Auth): Promise<any> {
  return (testEnv.wrap(fn as any) as any)({ data, auth: { uid: auth.uid, token: auth.token || {} } })
}

// Fire the users/{patientUid} write trigger with a before/after settings shape.
function fireSettings(patientUid: string, before: Record<string, unknown>, after: Record<string, unknown>) {
  const path = `users/${patientUid}`
  const b = testEnv.firestore.makeDocumentSnapshot(before, path)
  const a = testEnv.firestore.makeDocumentSnapshot(after, path)
  return (testEnv.wrap(onUserSettingsChanged as any) as any)({
    data: testEnv.makeChange(b, a),
    params: { patientUid },
  })
}

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
}

async function seedMembership(patientUid: string, caregiverUid: string, extra: Record<string, unknown> = {}) {
  await db.doc(`memberships/${patientUid}_${caregiverUid}`).set({
    patientUid, caregiverUid, role: 'admin', status: 'active', consentId: 'c1', ...extra,
  })
}

const count = async (coll: string, field: string, value: string) =>
  (await db.collection(coll).where(field, '==', value).get()).size

beforeAll(async () => { await clearFirestore() })
afterAll(() => { testEnv.cleanup() })
beforeEach(async () => { await clearFirestore() })

// ── createInvite ─────────────────────────────────────────────────────────────
describe('createInvite', () => {
  it('owner creates an invite + two consents + an audit log', async () => {
    const res = await call(createInvite, { patientUid: 'p1', role: 'admin' }, { uid: 'p1', token: { name: '환자' } })
    expect(res.code).toMatch(/^\d{6}$/)
    const invite = await db.doc(`invites/${res.code}`).get()
    expect(invite.exists).toBe(true)
    expect(invite.data()!.role).toBe('admin')
    expect(invite.data()!.used).toBe(false)
    expect((await db.collection('consents').where('patientUid', '==', 'p1').get()).size).toBe(2)
    expect(await count('auditLogs', 'action', 'invite.create')).toBe(1)
  })

  it('defaults a missing role to viewer (§8 least privilege)', async () => {
    const res = await call(createInvite, { patientUid: 'p1' }, { uid: 'p1' })
    expect((await db.doc(`invites/${res.code}`).get()).data()!.role).toBe('viewer')
  })

  it('rejects a stranger (not owner/admin)', async () => {
    await expect(call(createInvite, { patientUid: 'p1', role: 'admin' }, { uid: 'stranger' })).rejects.toThrow()
  })

  it('rejects an unauthenticated caller', async () => {
    await expect((testEnv.wrap(createInvite as any) as any)({ data: { patientUid: 'p1' } })).rejects.toThrow()
  })
})

// ── acceptInvite ─────────────────────────────────────────────────────────────
describe('acceptInvite', () => {
  async function invite(role = 'admin') {
    const res = await call(createInvite, { patientUid: 'p1', role }, { uid: 'p1' })
    return res.code as string
  }

  it('activates the membership with the caregiver real name + notifies the elder', async () => {
    const code = await invite()
    const res = await call(acceptInvite, { code }, { uid: 'cg1', token: { name: '김보호', email: 'cg@x.com' } })
    expect(res.patientUid).toBe('p1')
    const m = await db.doc('memberships/p1_cg1').get()
    expect(m.data()!.status).toBe('active')
    expect(m.data()!.role).toBe('admin')
    expect(m.data()!.caregiverName).toBe('김보호')
    expect(await count('auditLogs', 'action', 'membership.accept')).toBe(1)
    expect(await count('notifications', 'type', 'caregiver.accept')).toBe(1)
  })

  it('falls back to email when the token has no name', async () => {
    const code = await invite()
    await call(acceptInvite, { code }, { uid: 'cg1', token: { email: 'cg@x.com' } })
    expect((await db.doc('memberships/p1_cg1').get()).data()!.caregiverName).toBe('cg@x.com')
  })

  it('rejects accepting your own invite', async () => {
    const code = await invite()
    await expect(call(acceptInvite, { code }, { uid: 'p1' })).rejects.toThrow()
  })

  it('rejects an already-used code (one-shot)', async () => {
    const code = await invite()
    await call(acceptInvite, { code }, { uid: 'cg1', token: { name: 'A' } })
    await expect(call(acceptInvite, { code }, { uid: 'cg2', token: { name: 'B' } })).rejects.toThrow()
  })

  it('rejects an unknown code', async () => {
    await expect(call(acceptInvite, { code: '000000' }, { uid: 'cg1' })).rejects.toThrow()
  })
})

// ── setMembershipRole ────────────────────────────────────────────────────────
describe('setMembershipRole', () => {
  it('owner promotes viewer → admin and writes an audit log', async () => {
    await seedMembership('p1', 'cg1', { role: 'viewer' })
    await call(setMembershipRole, { patientUid: 'p1', caregiverUid: 'cg1', role: 'admin' }, { uid: 'p1' })
    expect((await db.doc('memberships/p1_cg1').get()).data()!.role).toBe('admin')
    expect(await count('auditLogs', 'action', 'membership.role')).toBe(1)
  })

  it('denies a non-owner / non-guardian', async () => {
    await seedMembership('p1', 'cg1', { role: 'viewer' })
    await expect(
      call(setMembershipRole, { patientUid: 'p1', caregiverUid: 'cg1', role: 'admin' }, { uid: 'cg1' }),
    ).rejects.toThrow()
  })

  it('rejects an invalid role', async () => {
    await seedMembership('p1', 'cg1')
    await expect(
      call(setMembershipRole, { patientUid: 'p1', caregiverUid: 'cg1', role: 'superuser' }, { uid: 'p1' }),
    ).rejects.toThrow()
  })
})

// ── revokeMembership ─────────────────────────────────────────────────────────
describe('revokeMembership', () => {
  it('owner revokes → status revoked + audit log', async () => {
    await seedMembership('p1', 'cg1')
    await call(revokeMembership, { patientUid: 'p1', caregiverUid: 'cg1' }, { uid: 'p1' })
    expect((await db.doc('memberships/p1_cg1').get()).data()!.status).toBe('revoked')
    expect(await count('auditLogs', 'action', 'membership.revoke')).toBe(1)
  })

  it('caregiver self-revoke is allowed', async () => {
    await seedMembership('p1', 'cg1')
    await call(revokeMembership, { patientUid: 'p1', caregiverUid: 'cg1' }, { uid: 'cg1' })
    expect((await db.doc('memberships/p1_cg1').get()).data()!.status).toBe('revoked')
  })

  it('denies an unrelated stranger', async () => {
    await seedMembership('p1', 'cg1')
    await expect(call(revokeMembership, { patientUid: 'p1', caregiverUid: 'cg1' }, { uid: 'stranger' })).rejects.toThrow()
  })
})

// ── syncCaregiverName ────────────────────────────────────────────────────────
describe('syncCaregiverName', () => {
  it('backfills caregiverName across all of the caller\'s memberships', async () => {
    await seedMembership('p1', 'cg1', { caregiverName: '' })
    await seedMembership('p2', 'cg1', { role: 'viewer' })
    await seedMembership('p3', 'other')
    const res = await call(syncCaregiverName, undefined, { uid: 'cg1', token: { name: '김보호' } })
    expect(res.updated).toBe(2)
    expect((await db.doc('memberships/p1_cg1').get()).data()!.caregiverName).toBe('김보호')
    expect((await db.doc('memberships/p2_cg1').get()).data()!.caregiverName).toBe('김보호')
    // Untouched: a different caregiver's row.
    expect((await db.doc('memberships/p3_other').get()).data()!.caregiverName).toBeUndefined()
  })

  it('is a no-op when the token carries no name/email', async () => {
    await seedMembership('p1', 'cg1')
    const res = await call(syncCaregiverName, undefined, { uid: 'cg1', token: {} })
    expect(res.updated).toBe(0)
  })
})

// ── onUserSettingsChanged trigger ────────────────────────────────────────────
describe('onUserSettingsChanged', () => {
  it('caregiver adds a recipient → recipient.add audit log + notification', async () => {
    await fireSettings(
      'p1',
      { recipients: [], lastModifiedBy: 'cg1' },
      { recipients: [{ name: '홍길동', phone: '010-1' }], lastModifiedBy: 'cg1' },
    )
    expect(await count('auditLogs', 'action', 'recipient.add')).toBe(1)
    expect(await count('notifications', 'type', 'recipient.add')).toBe(1)
  })

  it('caregiver changes a setting → settings.update audit log', async () => {
    await fireSettings('p1', { cadence: 'daily', lastModifiedBy: 'cg1' }, { cadence: 'weekly', lastModifiedBy: 'cg1' })
    expect(await count('auditLogs', 'action', 'settings.update')).toBe(1)
  })

  it('the elder editing their own settings is NOT logged (no self-notice)', async () => {
    await fireSettings('p1', { cadence: 'daily', lastModifiedBy: 'p1' }, { cadence: 'weekly', lastModifiedBy: 'p1' })
    expect((await db.collection('auditLogs').get()).size).toBe(0)
    expect((await db.collection('notifications').get()).size).toBe(0)
  })

  it('a write that only bumps lastModifiedAt is not treated as a change', async () => {
    await fireSettings(
      'p1',
      { cadence: 'daily', lastModifiedBy: 'cg1', lastModifiedAt: 1 },
      { cadence: 'daily', lastModifiedBy: 'cg1', lastModifiedAt: 2 },
    )
    expect((await db.collection('auditLogs').get()).size).toBe(0)
  })
})
