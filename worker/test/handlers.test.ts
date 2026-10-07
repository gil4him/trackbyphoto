// Integration tests for the worker's request handlers + settings audit,
// ported from the old functions-tests suite. Handlers run in-process; their
// admin-SDK writes hit a real Firestore emulator (FIRESTORE_EMULATOR_HOST is
// set by `firebase emulators:exec`), then we assert the resulting docs.
//
// Run: npm test   (boots the Firestore emulator, then vitest)

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createInvite,
  acceptInvite,
  revokeMembership,
  setMembershipRole,
  syncCaregiverName,
} from '../src/handlers/caregiver'
import { processSettingsChange } from '../src/handlers/audit'
import { db, clearFirestore, seedMembership, count } from './setup'

interface Auth { uid: string; token?: { name?: string; email?: string } }

// Invoke a handler as a given user (same shape the old callable tests used).
function call<T extends (...a: any[]) => Promise<any>>(fn: T, data: unknown, auth: Auth): Promise<any> {
  return fn({ uid: auth.uid, email: auth.token?.email ?? null, name: auth.token?.name ?? null }, data)
}

// Feed a users/{patientUid} before/after pair to the settings audit.
function fireSettings(patientUid: string, before: Record<string, unknown>, after: Record<string, unknown>) {
  return processSettingsChange(patientUid, before, after)
}

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

  it("stores the elder's display name for the invitee's confirm screen", async () => {
    await db.doc('users/p1').set({ patientName: '엄마' })
    const res = await call(createInvite, { patientUid: 'p1', role: 'admin' }, { uid: 'p1', token: { name: '환자' } })
    expect((await db.doc(`invites/${res.code}`).get()).data()!.patientName).toBe('엄마')
  })

  it('falls back to the Google name when no display name is set', async () => {
    const res = await call(createInvite, { patientUid: 'p1', role: 'admin' }, { uid: 'p1', token: { name: '환자' } })
    expect((await db.doc(`invites/${res.code}`).get()).data()!.patientName).toBe('환자')
  })

  it('defaults a missing role to viewer (§8 least privilege)', async () => {
    const res = await call(createInvite, { patientUid: 'p1' }, { uid: 'p1' })
    expect((await db.doc(`invites/${res.code}`).get()).data()!.role).toBe('viewer')
  })

  it('rejects a stranger (not owner/admin)', async () => {
    await expect(call(createInvite, { patientUid: 'p1', role: 'admin' }, { uid: 'stranger' })).rejects.toThrow()
  })

  it('rejects an unauthenticated caller', async () => {
    await expect(call(createInvite, { patientUid: 'p1' }, { uid: '' })).rejects.toThrow()
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

  it('an admin cannot remove the guardian', async () => {
    await seedMembership('p1', 'g1', { role: 'guardian' })
    await seedMembership('p1', 'cg1')
    await expect(call(revokeMembership, { patientUid: 'p1', caregiverUid: 'g1' }, { uid: 'cg1' })).rejects.toThrow()
    expect((await db.doc('memberships/p1_g1').get()).data()!.status).toBe('active')
  })

  it('the guardian can still remove an admin, and leave themselves', async () => {
    await seedMembership('p1', 'g1', { role: 'guardian' })
    await seedMembership('p1', 'cg1')
    await call(revokeMembership, { patientUid: 'p1', caregiverUid: 'cg1' }, { uid: 'g1' })
    expect((await db.doc('memberships/p1_cg1').get()).data()!.status).toBe('revoked')
    await call(revokeMembership, { patientUid: 'p1', caregiverUid: 'g1' }, { uid: 'g1' })
    expect((await db.doc('memberships/p1_g1').get()).data()!.status).toBe('revoked')
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

// ── settings audit (formerly onUserSettingsChanged) ────────────────────────────────────────────
describe('settings audit', () => {
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

  it('worker-owned fields (plan, day counters) are never reported as a settings change', async () => {
    await fireSettings(
      'p1',
      { cadence: 'daily', lastModifiedBy: 'cg1' },
      { cadence: 'daily', lastModifiedBy: 'cg1', plan: { tier: 'basic' }, dayCounters: { 20261004: { photos: 3 } } },
    )
    expect((await db.collection('auditLogs').get()).size).toBe(0)
    expect((await db.collection('notifications').get()).size).toBe(0)
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
