import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp,
  collection, query, where,
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

function authedDb(uid: string, opts: { email?: string; name?: string } = {}) {
  const claims = { ...(opts.email ? { email: opts.email } : {}), ...(opts.name ? { name: opts.name } : {}) }
  const ctx = Object.keys(claims).length
    ? testEnv.authenticatedContext(uid, claims)
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

  // Pending placeholder the client writes right after uploading its photo.
  const pendingMemo = (uid: string, extra: Record<string, unknown> = {}) => ({
    patientUid: uid,
    photoPath: `photos/${uid}/new_memo.jpg`, photoUrl: '',
    takenAt: new Date(), lat: null, lng: null,
    place: '', activity: '기타', memo: '', scene: '',
    status: 'pending', createdAt: serverTimestamp(),
    deviceMemo: '', deviceMemoSource: '',
    ...extra,
  })

  it('patient can create a pending memo for their own photo', async () => {
    await assertSucceeds(setDoc(doc(authedDb(PATIENT), 'memos', 'new_memo'), pendingMemo(PATIENT)))
  })

  it('patient can send the phone time zone, but not arbitrary extra fields', async () => {
    await assertSucceeds(setDoc(doc(authedDb(PATIENT), 'memos', 'new_memo'), pendingMemo(PATIENT, { tzOffsetMin: 540 })))
    await assertFails(setDoc(doc(authedDb(PATIENT), 'memos', 'other_memo'),
      pendingMemo(PATIENT, { photoPath: `photos/${PATIENT}/other_memo.jpg`, notifiedAt: new Date() })))
  })

  it('patient cannot create a memo already marked ready', async () => {
    await assertFails(
      setDoc(doc(authedDb(PATIENT), 'memos', 'new_memo'), pendingMemo(PATIENT, { status: 'ready' })),
    )
  })

  it("patient cannot point a memo at someone else's photo", async () => {
    await assertFails(
      setDoc(doc(authedDb(PATIENT), 'memos', 'new_memo'),
        pendingMemo(PATIENT, { photoPath: `photos/${STRANGER}/x.jpg` })),
    )
  })

  it('patient cannot pre-set worker-only fields (humanEdited, memoSource)', async () => {
    await assertFails(
      setDoc(doc(authedDb(PATIENT), 'memos', 'new_memo'), pendingMemo(PATIENT, { humanEdited: true })),
    )
    await assertFails(
      setDoc(doc(authedDb(PATIENT), 'memos', 'new_memo'), pendingMemo(PATIENT, { memoSource: 'local-llm' })),
    )
  })

  // The app's outbox checks whether an earlier attempt already delivered a
  // memo. A plain get() of a missing memo is denied, so it uses this query.
  it('patient can look up whether their own memo exists, even when it does not', async () => {
    const lookup = (uid: string, id: string) => query(
      collection(authedDb(uid), 'memos'),
      where('patientUid', '==', uid),
      where('photoPath', '==', `photos/${uid}/${id}.jpg`),
    )
    await assertSucceeds(getDocs(lookup(PATIENT, 'not_sent_yet')))
    await assertFails(getDoc(doc(authedDb(PATIENT), 'memos', 'not_sent_yet')))
    await assertFails(getDocs(query(collection(authedDb(STRANGER), 'memos'), where('patientUid', '==', PATIENT))))
  })

  it('patient can attach a late location to their memo; a stranger cannot', async () => {
    const late = { lat: 34.86, lng: 136.82, needsGeocode: true }
    await assertSucceeds(updateDoc(doc(authedDb(PATIENT), 'memos', 'memo1'), late))
    await assertFails(updateDoc(doc(authedDb(STRANGER), 'memos', 'memo1'), late))
  })

  it("caregiver cannot create a memo on the patient's behalf", async () => {
    await assertFails(
      setDoc(doc(authedDb(CAREGIVER_ACTIVE_ADMIN), 'memos', 'new_memo'), pendingMemo(PATIENT)),
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// requests/{id} — Mac mini worker queue (replaces HTTPS callables)
// ────────────────────────────────────────────────────────────────────────────
describe('requests', () => {
  const EMAIL = 'alice@example.com'
  const NAME = 'Alice'
  const req = (extra: Record<string, unknown> = {}) => ({
    type: 'createInvite', uid: PATIENT, email: EMAIL, name: NAME,
    payload: { patientUid: PATIENT }, status: 'pending', createdAt: serverTimestamp(),
    ...extra,
  })
  const alice = () => authedDb(PATIENT, { email: EMAIL, name: NAME })

  it('user can create a request stamped with their own verified identity', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'requests', 'r1'), req()))
  })

  it('a user with no display name stamps name: null', async () => {
    await assertSucceeds(
      setDoc(doc(authedDb(PATIENT, { email: EMAIL }), 'requests', 'r1'), req({ name: null })),
    )
  })

  it('cannot forge another uid', async () => {
    await assertFails(setDoc(doc(alice(), 'requests', 'r1'), req({ uid: STRANGER })))
  })

  it('cannot forge the admin email (regenerateMemo gate)', async () => {
    await assertFails(
      setDoc(doc(alice(), 'requests', 'r1'), req({ type: 'regenerateMemo', email: ADMIN_EMAIL })),
    )
  })

  it('cannot forge the display name (acceptInvite stores it)', async () => {
    await assertFails(setDoc(doc(alice(), 'requests', 'r1'), req({ name: '김보호' })))
  })

  it('cannot submit a pre-completed request or an unknown type', async () => {
    await assertFails(setDoc(doc(alice(), 'requests', 'r1'), req({ status: 'done', result: {} })))
    await assertFails(setDoc(doc(alice(), 'requests', 'r1'), req({ type: 'deleteEverything' })))
  })

  it('owner can read + delete their request; nobody can update it', async () => {
    await setDoc(doc(alice(), 'requests', 'r1'), req())
    await assertFails(getDoc(doc(authedDb(STRANGER), 'requests', 'r1')))
    await assertFails(updateDoc(doc(alice(), 'requests', 'r1'), { status: 'done' }))
    await assertSucceeds(getDoc(doc(alice(), 'requests', 'r1')))
    await assertSucceeds(deleteDoc(doc(alice(), 'requests', 'r1')))
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

  // Memberships are mutated ONLY by the Mac mini worker (admin SDK). Direct
  // client create/update is denied — this closes the hole where a caregiver
  // could self-activate their own row by reusing any consent on file, skipping
  // the one-shot invite code.
  it('client cannot create a membership directly (worker only)', async () => {
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
// In production the worker's createInvite handler writes via admin SDK and
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

  it('any signed-in user can get an invite by its code (the invite link)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invites', '666666'), VALID_INVITE)
    })
    await assertSucceeds(getDoc(doc(authedDb(STRANGER), 'invites', '666666')))
  })

  it('no one can list invites (codes must not be enumerable)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invites', '676767'), VALID_INVITE)
    })
    await assertFails(getDocs(collection(authedDb(STRANGER), 'invites')))
    await assertFails(getDocs(query(collection(authedDb(PATIENT), 'invites'), where('patientUid', '==', PATIENT))))
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

  it('clients cannot create notifications (only the worker can)', async () => {
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

// ────────────────────────────────────────────────────────────────────────────
// Family-managed elders: elder phone sessions, anonymous pairing sessions,
// pairings, devices
// ────────────────────────────────────────────────────────────────────────────
describe('managed elder sessions', () => {
  const ELDER = 'elder_managed'
  const GUARDIAN = 'cg_guardian'

  // The phone's custom-token session: { elder: true, deviceId }.
  const elderDb = (deviceId = 'dev1') =>
    testEnv.authenticatedContext(ELDER, { elder: true, deviceId }).firestore()
  const anonDb = (uid = 'anon1') =>
    testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore()

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'users', ELDER), { patientName: '엄마', accountType: 'managed', lastModifiedBy: GUARDIAN })
      await setDoc(doc(db, 'users', ELDER, 'devices', 'dev1'), { name: 'iPhone', status: 'active' })
      await setDoc(doc(db, 'users', ELDER, 'devices', 'dev2'), { name: 'Old phone', status: 'revoked' })
      await setDoc(doc(db, 'memberships', membershipId(ELDER, GUARDIAN)), {
        patientUid: ELDER, caregiverUid: GUARDIAN, role: 'guardian', status: 'active', consentId: 'c1',
      })
      await setDoc(doc(db, 'memos', 'elderMemo'), { patientUid: ELDER, photoPath: `photos/${ELDER}/m.jpg`, status: 'ready' })
      await setDoc(doc(db, 'pairings', 'pair1'), {
        patientUid: ELDER, codeHash: 'h', status: 'awaiting-approval', claimedBy: 'anon1',
      })
      await setDoc(doc(db, 'notifications', 'elderNotice'), {
        recipientUid: ELDER, patientUid: ELDER, actorUid: GUARDIAN, type: 'x', message: 'x', read: false,
      })
    })
  })

  it('linked phone reads its own settings and memos and can create a memo', async () => {
    await assertSucceeds(getDoc(doc(elderDb(), 'users', ELDER)))
    await assertSucceeds(getDoc(doc(elderDb(), 'memos', 'elderMemo')))
    await assertSucceeds(setDoc(doc(elderDb(), 'memos', 'newMemo'), {
      patientUid: ELDER, photoPath: `photos/${ELDER}/new.jpg`, status: 'pending', createdAt: serverTimestamp(),
    }))
  })

  it('an unlinked (revoked) phone loses all access', async () => {
    await assertFails(getDoc(doc(elderDb('dev2'), 'users', ELDER)))
    await assertFails(getDoc(doc(elderDb('dev2'), 'memos', 'elderMemo')))
    await assertFails(getDoc(doc(elderDb('dev2'), 'notifications', 'elderNotice')))
    await assertFails(setDoc(doc(elderDb('dev2'), 'memos', 'newMemo'), {
      patientUid: ELDER, photoPath: `photos/${ELDER}/new.jpg`, status: 'pending', createdAt: serverTimestamp(),
    }))
  })

  it('a phone whose device record is missing has no access', async () => {
    await assertFails(getDoc(doc(elderDb('ghost'), 'users', ELDER)))
  })

  it('elder phone cannot change settings', async () => {
    await assertFails(setDoc(doc(elderDb(), 'users', ELDER), { patientName: 'x', lastModifiedBy: ELDER }, { merge: true }))
  })

  it('guardian can change the elder settings', async () => {
    await assertSucceeds(setDoc(doc(authedDb(GUARDIAN), 'users', ELDER), { bigText: false, lastModifiedBy: GUARDIAN }, { merge: true }))
  })

  it('elder phone cannot remove family or create invites', async () => {
    await assertFails(deleteDoc(doc(elderDb(), 'memberships', membershipId(ELDER, GUARDIAN))))
    await assertFails(setDoc(doc(elderDb(), 'invites', '123456'), { patientUid: ELDER, used: false }))
  })

  it('elder phone may record its own one-tap notice acknowledgement', async () => {
    await assertSucceeds(setDoc(doc(elderDb(), 'consents', 'ack1'), {
      patientUid: ELDER, type: 'notice_ack', grantedBy: 'self', guardianUid: null,
      scope: 'x', consentTextVersion: 'managed-v1', timestamp: serverTimestamp(),
    }))
  })

  it('elder phone makes no worker requests', async () => {
    await assertFails(setDoc(doc(elderDb(), 'requests', 'r1'), {
      type: 'createInvite', uid: ELDER, email: null, name: null, payload: {}, status: 'pending', createdAt: serverTimestamp(),
    }))
  })

  it('anonymous session may only redeem a pairing code', async () => {
    const anonReq = (type: string) => ({
      type, uid: 'anon1', email: null, name: null, payload: {}, status: 'pending', createdAt: serverTimestamp(),
    })
    await assertSucceeds(setDoc(doc(anonDb(), 'requests', 'r1'), anonReq('pairDevice')))
    await assertSucceeds(setDoc(doc(anonDb(), 'requests', 'r2'), anonReq('completePairing')))
    await assertFails(setDoc(doc(anonDb(), 'requests', 'r3'), anonReq('createInvite')))
    await assertFails(setDoc(doc(anonDb(), 'requests', 'r4'), anonReq('createManagedElder')))
  })

  it('pairings: claimant and family can read; strangers and the elder phone cannot; nobody writes', async () => {
    await assertSucceeds(getDoc(doc(anonDb('anon1'), 'pairings', 'pair1')))
    await assertSucceeds(getDoc(doc(authedDb(GUARDIAN), 'pairings', 'pair1')))
    await assertSucceeds(getDocs(query(collection(authedDb(GUARDIAN), 'pairings'), where('patientUid', '==', ELDER))))
    await assertFails(getDoc(doc(anonDb('anon2'), 'pairings', 'pair1')))
    await assertFails(getDoc(doc(authedDb(STRANGER), 'pairings', 'pair1')))
    await assertFails(getDoc(doc(elderDb(), 'pairings', 'pair1')))
    await assertFails(getDocs(collection(authedDb(STRANGER), 'pairings')))
    await assertFails(updateDoc(doc(authedDb(GUARDIAN), 'pairings', 'pair1'), { status: 'approved' }))
  })

  it('devices: family and the phone read; nobody writes', async () => {
    await assertSucceeds(getDocs(collection(authedDb(GUARDIAN), 'users', ELDER, 'devices')))
    await assertSucceeds(getDoc(doc(elderDb(), 'users', ELDER, 'devices', 'dev1')))
    await assertFails(getDocs(collection(authedDb(STRANGER), 'users', ELDER, 'devices')))
    await assertFails(updateDoc(doc(authedDb(GUARDIAN), 'users', ELDER, 'devices', 'dev2'), { status: 'active' }))
    await assertFails(updateDoc(doc(elderDb(), 'users', ELDER, 'devices', 'dev1'), { name: 'x' }))
  })
})

describe('notifications feed query', () => {
  it('a user can list their own unread notices (useNotifications query)', async () => {
    await assertSucceeds(getDocs(query(
      collection(authedDb(PATIENT), 'notifications'),
      where('recipientUid', '==', PATIENT),
      where('read', '==', false),
    )))
  })
})
