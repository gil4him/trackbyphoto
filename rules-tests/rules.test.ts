import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore'
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest'

const PROJECT_ID = 'trackbyphoto-test'
const ADMIN_EMAIL = 'zymer4him@gmail.com'

// Fixtures — UIDs chosen to be obviously distinct in failure messages.
const PATIENT = 'patient_alice'
const CAREGIVER_ACTIVE_ADMIN = 'cg_active_admin'
const CAREGIVER_ACTIVE_VIEWER = 'cg_active_viewer'
const CAREGIVER_INVITED = 'cg_invited'
const CAREGIVER_REVOKED = 'cg_revoked'
const STRANGER = 'stranger'
const ADMIN_UID = 'superadmin_uid'

const membershipId = (p: string, c: string) => `${p}_${c}`

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

// Each test starts from a clean dataset, then we seed via the security-rules
// bypass context so we can plant memberships/consents/memos without first
// having to navigate the rules to create them.
beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()

    // Memo owned by patient
    await setDoc(doc(db, 'memos', 'memo1'), {
      patientUid: PATIENT,
      photoPath: `photos/${PATIENT}/m1.jpg`,
      photoUrl: '',
      activity: 'walk',
      details: '',
      category: '산책',
      status: 'ready',
      place: '',
      createdAt: new Date(),
      takenAt: new Date(),
    })

    // Patient's settings doc
    await setDoc(doc(db, 'users', PATIENT), {
      patientName: 'Alice',
      recipients: [],
      cadence: 'daily',
      autoMode: true,
      bigText: true,
      retention: '90',
    })

    // A consent record on file for the patient (needed for active memberships)
    await setDoc(doc(db, 'consents', 'consent1'), {
      patientUid: PATIENT,
      type: 'third_party_share',
      grantedBy: 'self',
      guardianUid: null,
      scope: 'memo data + location',
      consentTextVersion: 'v1',
      timestamp: new Date(),
    })

    // Active admin caregiver
    await setDoc(doc(db, 'memberships', membershipId(PATIENT, CAREGIVER_ACTIVE_ADMIN)), {
      patientUid: PATIENT,
      caregiverUid: CAREGIVER_ACTIVE_ADMIN,
      role: 'admin',
      status: 'active',
      invitedBy: PATIENT,
      consentId: 'consent1',
      createdAt: new Date(),
      acceptedAt: new Date(),
      revokedAt: null,
    })
    // Active viewer caregiver
    await setDoc(doc(db, 'memberships', membershipId(PATIENT, CAREGIVER_ACTIVE_VIEWER)), {
      patientUid: PATIENT,
      caregiverUid: CAREGIVER_ACTIVE_VIEWER,
      role: 'viewer',
      status: 'active',
      invitedBy: PATIENT,
      consentId: 'consent1',
      createdAt: new Date(),
      acceptedAt: new Date(),
      revokedAt: null,
    })
    // Invited (not yet accepted) caregiver
    await setDoc(doc(db, 'memberships', membershipId(PATIENT, CAREGIVER_INVITED)), {
      patientUid: PATIENT,
      caregiverUid: CAREGIVER_INVITED,
      role: 'admin',
      status: 'invited',
      invitedBy: PATIENT,
      consentId: null,
      createdAt: new Date(),
      acceptedAt: null,
      revokedAt: null,
    })
    // Revoked former caregiver
    await setDoc(doc(db, 'memberships', membershipId(PATIENT, CAREGIVER_REVOKED)), {
      patientUid: PATIENT,
      caregiverUid: CAREGIVER_REVOKED,
      role: 'admin',
      status: 'revoked',
      invitedBy: PATIENT,
      consentId: 'consent1',
      createdAt: new Date(),
      acceptedAt: new Date(),
      revokedAt: new Date(),
    })
  })
})

function authedDb(uid: string, opts: { email?: string } = {}) {
  const ctx = opts.email
    ? testEnv.authenticatedContext(uid, { email: opts.email })
    : testEnv.authenticatedContext(uid)
  return ctx.firestore()
}

// ────────────────────────────────────────────────────────────────────────────
// memos
// ────────────────────────────────────────────────────────────────────────────
describe('memos', () => {
  it('patient can read their own memo', async () => {
    await assertSucceeds(getDoc(doc(authedDb(PATIENT), 'memos', 'memo1')))
  })

  it('stranger cannot read patient memo', async () => {
    await assertFails(getDoc(doc(authedDb(STRANGER), 'memos', 'memo1')))
  })

  it('active viewer caregiver can read memo', async () => {
    await assertSucceeds(getDoc(doc(authedDb(CAREGIVER_ACTIVE_VIEWER), 'memos', 'memo1')))
  })

  it('invited (not accepted) caregiver cannot read memo', async () => {
    await assertFails(getDoc(doc(authedDb(CAREGIVER_INVITED), 'memos', 'memo1')))
  })

  it('revoked caregiver cannot read memo', async () => {
    await assertFails(getDoc(doc(authedDb(CAREGIVER_REVOKED), 'memos', 'memo1')))
  })

  it('active viewer caregiver cannot update memo', async () => {
    await assertFails(
      updateDoc(doc(authedDb(CAREGIVER_ACTIVE_VIEWER), 'memos', 'memo1'), { activity: 'edit' }),
    )
  })

  it('active admin caregiver can update memo', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(CAREGIVER_ACTIVE_ADMIN), 'memos', 'memo1'), { activity: 'edit' }),
    )
  })

  it('super-admin (by email) can read any memo', async () => {
    await assertSucceeds(
      getDoc(doc(authedDb(ADMIN_UID, { email: ADMIN_EMAIL }), 'memos', 'memo1')),
    )
  })

  it('clients cannot create memos (only Cloud Functions can)', async () => {
    await assertFails(
      setDoc(doc(authedDb(PATIENT), 'memos', 'new_memo'), {
        patientUid: PATIENT,
        photoPath: 'x', photoUrl: '', activity: '', details: '', category: '일상',
        status: 'pending', place: '', createdAt: new Date(), takenAt: new Date(),
      }),
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// users/{patientUid} — settings doc
// ────────────────────────────────────────────────────────────────────────────
describe('users', () => {
  it('patient can read+write own settings', async () => {
    const ref = doc(authedDb(PATIENT), 'users', PATIENT)
    await assertSucceeds(getDoc(ref))
    await assertSucceeds(updateDoc(ref, { patientName: 'Alice 2' }))
  })

  it('active admin caregiver can write patient settings', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(CAREGIVER_ACTIVE_ADMIN), 'users', PATIENT), { patientName: 'edited' }),
    )
  })

  it('active viewer caregiver can read but NOT write patient settings', async () => {
    await assertSucceeds(getDoc(doc(authedDb(CAREGIVER_ACTIVE_VIEWER), 'users', PATIENT)))
    await assertFails(
      updateDoc(doc(authedDb(CAREGIVER_ACTIVE_VIEWER), 'users', PATIENT), { patientName: 'edited' }),
    )
  })

  it('stranger cannot read patient settings', async () => {
    await assertFails(getDoc(doc(authedDb(STRANGER), 'users', PATIENT)))
  })
})

// ────────────────────────────────────────────────────────────────────────────
// memberships — the consent gate is the critical invariant
// ────────────────────────────────────────────────────────────────────────────
describe('memberships', () => {
  it('patient sees their own memberships', async () => {
    await assertSucceeds(
      getDoc(doc(authedDb(PATIENT), 'memberships', membershipId(PATIENT, CAREGIVER_ACTIVE_ADMIN))),
    )
  })

  it('caregiver sees their own membership row', async () => {
    await assertSucceeds(
      getDoc(doc(authedDb(CAREGIVER_ACTIVE_ADMIN), 'memberships', membershipId(PATIENT, CAREGIVER_ACTIVE_ADMIN))),
    )
  })

  it('stranger cannot read another patient/caregiver pair', async () => {
    await assertFails(
      getDoc(doc(authedDb(STRANGER), 'memberships', membershipId(PATIENT, CAREGIVER_ACTIVE_ADMIN))),
    )
  })

  it('caregiver CANNOT accept an invite without a consent doc reference', async () => {
    const id = membershipId(PATIENT, CAREGIVER_INVITED)
    await assertFails(
      updateDoc(doc(authedDb(CAREGIVER_INVITED), 'memberships', id), {
        status: 'active',
        consentId: 'nonexistent_consent',
      }),
    )
  })

  it('caregiver CAN accept an invite when consentId references a real consent', async () => {
    const id = membershipId(PATIENT, CAREGIVER_INVITED)
    await assertSucceeds(
      updateDoc(doc(authedDb(CAREGIVER_INVITED), 'memberships', id), {
        status: 'active',
        consentId: 'consent1',
      }),
    )
  })

  it('caregiver cannot grant themselves a different role while accepting', async () => {
    // Invited row has role=admin; try to bump to guardian on accept (no-op
    // here since it's already admin, but flip the role to viewer to catch
    // the rule denying role-mutation on accept).
    const id = membershipId(PATIENT, CAREGIVER_INVITED)
    await assertFails(
      updateDoc(doc(authedDb(CAREGIVER_INVITED), 'memberships', id), {
        status: 'active',
        role: 'guardian',
        consentId: 'consent1',
      }),
    )
  })

  it('patient can revoke a caregiver (delete)', async () => {
    await assertSucceeds(
      deleteDoc(doc(authedDb(PATIENT), 'memberships', membershipId(PATIENT, CAREGIVER_ACTIVE_VIEWER))),
    )
  })

  it('caregiver can remove their own membership', async () => {
    await assertSucceeds(
      deleteDoc(doc(authedDb(CAREGIVER_ACTIVE_VIEWER), 'memberships', membershipId(PATIENT, CAREGIVER_ACTIVE_VIEWER))),
    )
  })

  it('viewer caregiver CANNOT delete another caregiver', async () => {
    await assertFails(
      deleteDoc(doc(authedDb(CAREGIVER_ACTIVE_VIEWER), 'memberships', membershipId(PATIENT, CAREGIVER_ACTIVE_ADMIN))),
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// consents — immutable evidence
// ────────────────────────────────────────────────────────────────────────────
describe('consents', () => {
  it('patient can create a self consent', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(PATIENT), 'consents', 'new_self'), {
        patientUid: PATIENT,
        type: 'sensitive_data',
        grantedBy: 'self',
        guardianUid: null,
        scope: 'memo + location',
        consentTextVersion: 'v1',
        timestamp: serverTimestamp(),
      }),
    )
  })

  it('stranger cannot create a self consent for someone else', async () => {
    await assertFails(
      setDoc(doc(authedDb(STRANGER), 'consents', 'bad_consent'), {
        patientUid: PATIENT,
        type: 'sensitive_data',
        grantedBy: 'self',
        guardianUid: null,
        scope: 'x',
        consentTextVersion: 'v1',
        timestamp: serverTimestamp(),
      }),
    )
  })

  it('consents are immutable once written', async () => {
    await assertFails(
      updateDoc(doc(authedDb(PATIENT), 'consents', 'consent1'), { scope: 'changed' }),
    )
    await assertFails(deleteDoc(doc(authedDb(PATIENT), 'consents', 'consent1')))
  })
})

// ────────────────────────────────────────────────────────────────────────────
// auditLogs — append-only
// ────────────────────────────────────────────────────────────────────────────
describe('auditLogs', () => {
  it('owner can append a log about themselves', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(PATIENT), 'auditLogs', 'log1'), {
        patientUid: PATIENT,
        actorUid: PATIENT,
        action: 'settings.update',
        details: { field: 'cadence' },
        timestamp: serverTimestamp(),
      }),
    )
  })

  it('active caregiver can append a log', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(CAREGIVER_ACTIVE_ADMIN), 'auditLogs', 'log2'), {
        patientUid: PATIENT,
        actorUid: CAREGIVER_ACTIVE_ADMIN,
        action: 'recipient.add',
        details: {},
        timestamp: serverTimestamp(),
      }),
    )
  })

  it('stranger cannot append a log', async () => {
    await assertFails(
      setDoc(doc(authedDb(STRANGER), 'auditLogs', 'log3'), {
        patientUid: PATIENT,
        actorUid: STRANGER,
        action: 'evil',
        details: {},
        timestamp: serverTimestamp(),
      }),
    )
  })

  it('cannot lie about actorUid', async () => {
    await assertFails(
      setDoc(doc(authedDb(CAREGIVER_ACTIVE_ADMIN), 'auditLogs', 'log4'), {
        patientUid: PATIENT,
        actorUid: PATIENT, // not the writer
        action: 'fake',
        details: {},
        timestamp: serverTimestamp(),
      }),
    )
  })

  it('audit logs are append-only', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'auditLogs', 'preexisting'), {
        patientUid: PATIENT, actorUid: PATIENT, action: 'x', details: {}, timestamp: new Date(),
      })
    })
    await assertFails(
      updateDoc(doc(authedDb(PATIENT), 'auditLogs', 'preexisting'), { action: 'tampered' }),
    )
    await assertFails(deleteDoc(doc(authedDb(PATIENT), 'auditLogs', 'preexisting')))
  })
})
