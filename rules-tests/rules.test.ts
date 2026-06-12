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

// demo- prefix = fully offline project, so the Firebase CLI never asks for
// credentials (needed on logged-out CI runners). Must match package.json.
const PROJECT_ID = 'demo-trackbyphoto-test'
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
      activity: '산책',
      memo: '공원에서 산책 중이세요.',
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

    // An unread safeguard notice addressed to the patient
    await setDoc(doc(db, 'notifications', 'notif1'), {
      recipientUid: PATIENT,
      patientUid: PATIENT,
      actorUid: CAREGIVER_ACTIVE_ADMIN,
      type: 'recipient.add',
      message: '보호자가 받는 사람을 추가했어요',
      read: false,
      createdAt: new Date(),
    })
    // A new-photo notice addressed to a caregiver
    await setDoc(doc(db, 'notifications', 'notif_cg'), {
      recipientUid: CAREGIVER_ACTIVE_ADMIN,
      patientUid: PATIENT,
      actorUid: PATIENT,
      type: 'photo.new',
      message: 'Alice님이 새 사진을 올렸어요',
      read: false,
      createdAt: new Date(),
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
        photoPath: 'x', photoUrl: '', activity: '기타', memo: '',
        status: 'pending', place: '', createdAt: new Date(), takenAt: new Date(),
      }),
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// users/{patientUid} — settings doc
// ────────────────────────────────────────────────────────────────────────────
describe('users', () => {
  it('patient can read+write own settings (self-stamped)', async () => {
    const ref = doc(authedDb(PATIENT), 'users', PATIENT)
    await assertSucceeds(getDoc(ref))
    await assertSucceeds(updateDoc(ref, { patientName: 'Alice 2', lastModifiedBy: PATIENT }))
  })

  it('active admin caregiver can write patient settings (self-stamped)', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(CAREGIVER_ACTIVE_ADMIN), 'users', PATIENT), {
        patientName: 'edited',
        lastModifiedBy: CAREGIVER_ACTIVE_ADMIN,
      }),
    )
  })

  it('cannot forge lastModifiedBy as someone else (trusted actor for audit)', async () => {
    // Admin caregiver tries to frame the edit as the elder's own change so the
    // audit trigger stays silent. The rule pins lastModifiedBy to the writer.
    await assertFails(
      updateDoc(doc(authedDb(CAREGIVER_ACTIVE_ADMIN), 'users', PATIENT), {
        patientName: 'edited',
        lastModifiedBy: PATIENT,
      }),
    )
  })

  it('write without lastModifiedBy is rejected', async () => {
    await assertFails(
      updateDoc(doc(authedDb(PATIENT), 'users', PATIENT), { patientName: 'no stamp' }),
    )
  })

  it('active viewer caregiver can read but NOT write patient settings', async () => {
    await assertSucceeds(getDoc(doc(authedDb(CAREGIVER_ACTIVE_VIEWER), 'users', PATIENT)))
    await assertFails(
      updateDoc(doc(authedDb(CAREGIVER_ACTIVE_VIEWER), 'users', PATIENT), {
        patientName: 'edited',
        lastModifiedBy: CAREGIVER_ACTIVE_VIEWER,
      }),
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

  // Memberships are mutated ONLY by the Cloud Functions (admin SDK). Direct
  // client create/update is denied — this closes the hole where a caregiver
  // could self-activate their own row by reusing any consent on file, skipping
  // the one-shot invite code.
  it('client cannot create a membership directly (Cloud Functions only)', async () => {
    await assertFails(
      setDoc(doc(authedDb(PATIENT), 'memberships', membershipId(PATIENT, 'new_cg')), {
        patientUid: PATIENT,
        caregiverUid: 'new_cg',
        role: 'viewer',
        status: 'invited',
        invitedBy: PATIENT,
        consentId: null,
        createdAt: new Date(),
        acceptedAt: null,
        revokedAt: null,
      }),
    )
  })

  it('caregiver CANNOT self-activate an invited membership (even with a valid consent)', async () => {
    const id = membershipId(PATIENT, CAREGIVER_INVITED)
    await assertFails(
      updateDoc(doc(authedDb(CAREGIVER_INVITED), 'memberships', id), {
        status: 'active',
        consentId: 'consent1',
      }),
    )
  })

  it('owner cannot update a membership directly (revoke goes through the callable)', async () => {
    const id = membershipId(PATIENT, CAREGIVER_ACTIVE_ADMIN)
    await assertFails(
      updateDoc(doc(authedDb(PATIENT), 'memberships', id), { status: 'revoked' }),
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
// invites — 6-digit codes the patient hands to a caregiver
//
// In production the createInvite Cloud Function writes via admin SDK and
// bypasses these rules. The rules still need to make sense for any direct
// client write attempt (defense-in-depth), so this block exercises them.
// ────────────────────────────────────────────────────────────────────────────
describe('invites', () => {
  const VALID_INVITE = {
    patientUid: PATIENT,
    role: 'admin',
    createdBy: PATIENT,
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    used: false,
    createdAt: new Date(),
  }

  it('patient can create an invite for themselves', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(PATIENT), 'invites', '111111'), VALID_INVITE),
    )
  })

  it('admin caregiver can create an invite for the patient', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(CAREGIVER_ACTIVE_ADMIN), 'invites', '222222'), {
        ...VALID_INVITE,
        createdBy: CAREGIVER_ACTIVE_ADMIN,
      }),
    )
  })

  it('stranger cannot create an invite for someone else', async () => {
    await assertFails(
      setDoc(doc(authedDb(STRANGER), 'invites', '333333'), {
        ...VALID_INVITE,
        createdBy: STRANGER,
      }),
    )
  })

  it('viewer caregiver cannot create an invite (admin/owner only)', async () => {
    await assertFails(
      setDoc(doc(authedDb(CAREGIVER_ACTIVE_VIEWER), 'invites', '444444'), {
        ...VALID_INVITE,
        createdBy: CAREGIVER_ACTIVE_VIEWER,
      }),
    )
  })

  it('used=true on create is rejected (must start unused)', async () => {
    await assertFails(
      setDoc(doc(authedDb(PATIENT), 'invites', '555555'), {
        ...VALID_INVITE,
        used: true,
      }),
    )
  })

  it('any signed-in user can read an invite (to look up the code they typed)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invites', '666666'), VALID_INVITE)
    })
    await assertSucceeds(getDoc(doc(authedDb(STRANGER), 'invites', '666666')))
  })

  it('owner can delete their own invite', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invites', '777777'), VALID_INVITE)
    })
    await assertSucceeds(deleteDoc(doc(authedDb(PATIENT), 'invites', '777777')))
  })

  it('stranger cannot delete an invite', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invites', '888888'), VALID_INVITE)
    })
    await assertFails(deleteDoc(doc(authedDb(STRANGER), 'invites', '888888')))
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

// ────────────────────────────────────────────────────────────────────────────
// notifications — elder-only safeguard feed
// ────────────────────────────────────────────────────────────────────────────
describe('notifications', () => {
  it('patient can read their own notification', async () => {
    await assertSucceeds(getDoc(doc(authedDb(PATIENT), 'notifications', 'notif1')))
  })

  it('caregiver CANNOT read a notice addressed to the patient', async () => {
    await assertFails(getDoc(doc(authedDb(CAREGIVER_ACTIVE_ADMIN), 'notifications', 'notif1')))
  })

  it('caregiver CAN read a notice addressed to them (new photo)', async () => {
    await assertSucceeds(getDoc(doc(authedDb(CAREGIVER_ACTIVE_ADMIN), 'notifications', 'notif_cg')))
  })

  it('patient CANNOT read a caregiver-addressed notice', async () => {
    await assertFails(getDoc(doc(authedDb(PATIENT), 'notifications', 'notif_cg')))
  })

  it('caregiver can mark their own notice read', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(CAREGIVER_ACTIVE_ADMIN), 'notifications', 'notif_cg'), { read: true }),
    )
  })

  it('stranger cannot read a notification', async () => {
    await assertFails(getDoc(doc(authedDb(STRANGER), 'notifications', 'notif1')))
  })

  it('clients cannot create notifications (only Cloud Functions can)', async () => {
    await assertFails(
      setDoc(doc(authedDb(PATIENT), 'notifications', 'forged'), {
        patientUid: PATIENT, actorUid: PATIENT, type: 'x', message: 'x',
        read: false, createdAt: new Date(),
      }),
    )
  })

  it('patient can mark a notification read', async () => {
    await assertSucceeds(
      updateDoc(doc(authedDb(PATIENT), 'notifications', 'notif1'), { read: true }),
    )
  })

  it('patient cannot edit a notification beyond the read flag', async () => {
    await assertFails(
      updateDoc(doc(authedDb(PATIENT), 'notifications', 'notif1'), { message: 'tampered' }),
    )
  })

  it('caregiver cannot mark the patient notification read', async () => {
    await assertFails(
      updateDoc(doc(authedDb(CAREGIVER_ACTIVE_ADMIN), 'notifications', 'notif1'), { read: true }),
    )
  })

  it('patient can dismiss (delete) their notification', async () => {
    await assertSucceeds(deleteDoc(doc(authedDb(PATIENT), 'notifications', 'notif1')))
  })
})
