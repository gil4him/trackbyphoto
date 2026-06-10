/**
 * Caregiver-share callables.
 *
 * Three HTTPS callables back the invite → consent → membership flow:
 *
 *   createInvite      Patient (or active admin) issues a 6-digit code. The
 *                     patient confirms two consent screens (sensitive_data +
 *                     third_party_share) in the client UI right before this
 *                     call. The function writes both consent docs *and* the
 *                     invite in a single batch, using admin SDK so the
 *                     timestamps match the server clock exactly. Returns the
 *                     code + expiry.
 *
 *   acceptInvite      Caregiver enters the code. Function validates the code
 *                     is unused + not expired, then atomically:
 *                       — marks the invite used=true
 *                       — creates memberships/{patientUid}_{caregiverUid}
 *                         with status='active' and consentId pointing at the
 *                         third_party_share consent
 *                       — writes an auditLog
 *                     Returns the patient identity so the client can switch
 *                     context to the new patient.
 *
 *   revokeMembership  Owner or active admin caregiver flips status to
 *                     'revoked' (or, when called by a caregiver on their own
 *                     row, deletes it) and writes an auditLog. Plain Firestore
 *                     rules can already do this; the callable exists so the
 *                     audit log write is guaranteed (rules can't gate "must
 *                     write log B before doing A").
 *
 * Source of truth lives in Firestore. We do NOT set custom claims here — the
 * rules read membership status from Firestore directly so revocation is
 * instant (no token refresh delay). Custom-claims caching can be added later
 * as a perf hint without changing semantics.
 *
 * All three functions emit `auditLogs` entries. The actorUid is the caller's
 * auth uid (verified by Cloud Functions runtime), so the log can't be forged.
 *
 * See TrackByPhoto-Plan.md §7 / Appendix B (callable contracts) for the spec.
 */

import { randomInt } from 'node:crypto'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions/v2'

const REGION = 'us-west1'

// Invite codes are 6-digit numeric (000000–999999). 10^6 is plenty for a code
// that lives 24 hours and is one-shot; collisions are handled by retry below.
const INVITE_CODE_LEN = 6
const INVITE_TTL_HOURS = 24

// Roles the invite path exposes. Guardian is intentionally not invitable —
// court-appointed guardianship is set up out of band by an admin, not via a
// 6-digit code.
const INVITABLE_ROLES = ['admin', 'viewer'] as const
type InvitableRole = typeof INVITABLE_ROLES[number]

function requireAuth(req: CallableRequest): string {
  const uid = req.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'sign in required')
  return uid
}

function membershipDocId(patientUid: string, caregiverUid: string): string {
  return `${patientUid}_${caregiverUid}`
}

function genInviteCode(): string {
  // Zero-padded numeric string. crypto.randomInt is uniform; Math.random isn't.
  return String(randomInt(0, 10 ** INVITE_CODE_LEN)).padStart(INVITE_CODE_LEN, '0')
}

async function isOwnerOrAdminCaregiver(
  callerUid: string,
  patientUid: string,
): Promise<boolean> {
  if (callerUid === patientUid) return true
  const db = getFirestore()
  const snap = await db
    .collection('memberships')
    .doc(membershipDocId(patientUid, callerUid))
    .get()
  if (!snap.exists) return false
  const m = snap.data() as { status?: string; role?: string }
  return m.status === 'active' && m.role === 'admin'
}

// ────────────────────────────────────────────────────────────────────────────
// createInvite
//
// Owner or active admin caregiver hands the elder a 6-digit code.
//
// In one batched commit:
//   consents/{sid}   — sensitive_data, self-granted by patient
//   consents/{tid}   — third_party_share, self-granted by patient
//   invites/{code}   — carries patientUid, role, both consent IDs, expiresAt
//   auditLogs/{aid}  — 'invite.create'
//
// Why bundle the consents here rather than have the patient write them first
// from the client? Two reasons:
//   1. The patient sees the two consent texts immediately before tapping
//      "Generate code." Writing them together with the invite keeps the
//      patient's UI to one tap and guarantees the timestamps align.
//   2. The admin SDK bypasses Firestore rules, so we can set
//      consents.timestamp to FieldValue.serverTimestamp() without the rules-
//      mandated request.time match check refusing the write.
// ────────────────────────────────────────────────────────────────────────────

interface CreateInviteRequest {
  patientUid: string
  role: InvitableRole
  /** UI-visible consent strings so the dashboard / audit log can show the
   *  exact wording the patient agreed to. Defaults applied server-side if
   *  the client doesn't pass them (older app versions). */
  sensitiveScope?: string
  thirdPartyScope?: string
  consentTextVersion?: string
}

interface CreateInviteResponse {
  code: string
  expiresAt: string // ISO
}

export const createInvite = onCall<CreateInviteRequest, Promise<CreateInviteResponse>>(
  { region: REGION, memory: '256MiB', timeoutSeconds: 30 },
  async (request) => {
    const callerUid = requireAuth(request)
    const { patientUid, role } = request.data || ({} as CreateInviteRequest)

    if (!patientUid || typeof patientUid !== 'string') {
      throw new HttpsError('invalid-argument', 'patientUid required')
    }
    if (!INVITABLE_ROLES.includes(role)) {
      throw new HttpsError('invalid-argument', `role must be one of ${INVITABLE_ROLES.join(', ')}`)
    }
    if (!(await isOwnerOrAdminCaregiver(callerUid, patientUid))) {
      throw new HttpsError('permission-denied', 'only the patient or an admin caregiver can invite')
    }

    const db = getFirestore()
    const now = Date.now()
    const expiresAt = Timestamp.fromMillis(now + INVITE_TTL_HOURS * 3600 * 1000)
    const sensitiveScope = request.data.sensitiveScope || '메모 텍스트와 사진'
    const thirdPartyScope = request.data.thirdPartyScope || '메모 + 위치 + 사진을 보호자와 공유'
    const consentTextVersion = request.data.consentTextVersion || 'v1'

    // Find an unused 6-digit code. Two retries — 6-digit space (10^6) makes
    // a third collision astronomically unlikely with ~hundreds of live invites.
    let code = ''
    for (let i = 0; i < 3; i++) {
      const candidate = genInviteCode()
      const existing = await db.collection('invites').doc(candidate).get()
      if (!existing.exists) { code = candidate; break }
    }
    if (!code) throw new HttpsError('internal', 'could not allocate a unique invite code; try again')

    const sensitiveRef = db.collection('consents').doc()
    const thirdPartyRef = db.collection('consents').doc()
    const inviteRef = db.collection('invites').doc(code)
    const logRef = db.collection('auditLogs').doc()

    const consentBase = {
      patientUid,
      grantedBy: 'self' as const,
      guardianUid: null,
      consentTextVersion,
      timestamp: FieldValue.serverTimestamp(),
    }

    const batch = db.batch()
    batch.set(sensitiveRef, { ...consentBase, type: 'sensitive_data', scope: sensitiveScope })
    batch.set(thirdPartyRef, { ...consentBase, type: 'third_party_share', scope: thirdPartyScope })
    batch.set(inviteRef, {
      patientUid,
      role,
      createdBy: callerUid,
      sensitiveConsentId: sensitiveRef.id,
      thirdPartyConsentId: thirdPartyRef.id,
      expiresAt,
      used: false,
      createdAt: FieldValue.serverTimestamp(),
    })
    batch.set(logRef, {
      patientUid,
      actorUid: callerUid,
      action: 'invite.create',
      details: { code, role, sensitiveConsentId: sensitiveRef.id, thirdPartyConsentId: thirdPartyRef.id },
      timestamp: FieldValue.serverTimestamp(),
    })
    await batch.commit()

    logger.info('[caregiver] invite created', { patientUid, callerUid, role, code })
    return { code, expiresAt: expiresAt.toDate().toISOString() }
  },
)

// ────────────────────────────────────────────────────────────────────────────
// acceptInvite
//
// Caregiver types the 6-digit code. We:
//   1. Look up invites/{code}, verify used=false and expiresAt > now.
//   2. Reject self-invites (caregiverUid != patientUid).
//   3. Reject if a non-revoked membership already exists for this pair.
//   4. Batch:
//        — set invite.used = true (one-shot)
//        — create memberships/{patientUid}_{caregiverUid} with status=active,
//          consentId = thirdPartyConsentId (the membership-relevant consent;
//          the sensitive-data consent travels alongside but isn't referenced
//          by the membership doc).
//        — auditLog 'membership.accept'
//   5. Return the patient identity so the client can switch context.
// ────────────────────────────────────────────────────────────────────────────

interface AcceptInviteRequest {
  code: string
}

interface AcceptInviteResponse {
  patientUid: string
  role: InvitableRole
  membershipId: string
}

export const acceptInvite = onCall<AcceptInviteRequest, Promise<AcceptInviteResponse>>(
  { region: REGION, memory: '256MiB', timeoutSeconds: 30 },
  async (request) => {
    const callerUid = requireAuth(request)
    const code = (request.data?.code || '').trim()
    if (!/^\d{6}$/.test(code)) {
      throw new HttpsError('invalid-argument', '6-digit code required')
    }

    const db = getFirestore()
    const inviteRef = db.collection('invites').doc(code)
    const inviteSnap = await inviteRef.get()
    if (!inviteSnap.exists) {
      throw new HttpsError('not-found', 'invite code not found')
    }
    const inv = inviteSnap.data() as {
      patientUid: string
      role: InvitableRole
      thirdPartyConsentId?: string
      sensitiveConsentId?: string
      expiresAt: Timestamp
      used: boolean
    }
    if (inv.used) throw new HttpsError('failed-precondition', 'invite already used')
    if (inv.expiresAt.toMillis() < Date.now()) {
      throw new HttpsError('deadline-exceeded', 'invite expired')
    }
    if (inv.patientUid === callerUid) {
      throw new HttpsError('failed-precondition', 'cannot accept your own invite')
    }
    if (!inv.thirdPartyConsentId) {
      // Older invites (pre-this-deploy) wouldn't have consent refs. Bail so
      // we don't create a membership lacking a consent trail.
      throw new HttpsError('failed-precondition', 'invite is missing consent reference; ask the patient to generate a new code')
    }

    const membershipRef = db
      .collection('memberships')
      .doc(membershipDocId(inv.patientUid, callerUid))
    const existing = await membershipRef.get()
    if (existing.exists) {
      const m = existing.data() as { status?: string }
      if (m.status === 'active') {
        throw new HttpsError('already-exists', 'you already have access to this patient')
      }
      // invited / revoked rows are overwritten by the accept — the new code
      // is fresh consent.
    }

    const logRef = db.collection('auditLogs').doc()
    const batch = db.batch()
    batch.update(inviteRef, { used: true, usedAt: FieldValue.serverTimestamp(), usedBy: callerUid })
    batch.set(membershipRef, {
      patientUid: inv.patientUid,
      caregiverUid: callerUid,
      role: inv.role,
      status: 'active',
      invitedBy: inv.patientUid, // best signal we have without storing creator on invite separately
      consentId: inv.thirdPartyConsentId,
      createdAt: FieldValue.serverTimestamp(),
      acceptedAt: FieldValue.serverTimestamp(),
      revokedAt: null,
    })
    batch.set(logRef, {
      patientUid: inv.patientUid,
      actorUid: callerUid,
      action: 'membership.accept',
      details: { code, role: inv.role, consentId: inv.thirdPartyConsentId },
      timestamp: FieldValue.serverTimestamp(),
    })
    await batch.commit()

    logger.info('[caregiver] invite accepted', { patientUid: inv.patientUid, callerUid, role: inv.role })
    return {
      patientUid: inv.patientUid,
      role: inv.role,
      membershipId: membershipRef.id,
    }
  },
)

// ────────────────────────────────────────────────────────────────────────────
// revokeMembership
//
// Owner or active admin caregiver flips a membership to status='revoked'.
// The rules already permit this, but routing through the callable guarantees
// the audit log gets written in the same batch (atomic with the status flip).
//
// A caregiver removing their own access doesn't need to call this — they can
// delete their own row directly via rules. We still accept the call for
// symmetry and to write the audit log.
// ────────────────────────────────────────────────────────────────────────────

interface RevokeMembershipRequest {
  patientUid: string
  caregiverUid: string
  /** Optional short reason the patient gave ("changed caregivers", etc.) —
   *  surfaced on the audit log entry for later review. */
  reason?: string
}

interface RevokeMembershipResponse {
  ok: true
}

export const revokeMembership = onCall<RevokeMembershipRequest, Promise<RevokeMembershipResponse>>(
  { region: REGION, memory: '256MiB', timeoutSeconds: 30 },
  async (request) => {
    const callerUid = requireAuth(request)
    const { patientUid, caregiverUid, reason } = request.data || ({} as RevokeMembershipRequest)
    if (!patientUid || !caregiverUid) {
      throw new HttpsError('invalid-argument', 'patientUid and caregiverUid required')
    }

    // Authz: caller is patient, an active admin caregiver on the patient, or
    // the caregiver themselves (removing their own access).
    const callerIsCaregiverOnRow = callerUid === caregiverUid
    const callerCanManage =
      callerUid === patientUid || (await isOwnerOrAdminCaregiver(callerUid, patientUid))
    if (!callerIsCaregiverOnRow && !callerCanManage) {
      throw new HttpsError('permission-denied', 'not authorized to revoke this membership')
    }

    const db = getFirestore()
    const ref = db.collection('memberships').doc(membershipDocId(patientUid, caregiverUid))
    const snap = await ref.get()
    if (!snap.exists) throw new HttpsError('not-found', 'membership not found')

    const logRef = db.collection('auditLogs').doc()
    const batch = db.batch()
    batch.update(ref, { status: 'revoked', revokedAt: FieldValue.serverTimestamp() })
    batch.set(logRef, {
      patientUid,
      actorUid: callerUid,
      action: 'membership.revoke',
      details: {
        caregiverUid,
        selfRevoke: callerIsCaregiverOnRow && !callerCanManage,
        ...(reason ? { reason } : {}),
      },
      timestamp: FieldValue.serverTimestamp(),
    })
    await batch.commit()

    logger.info('[caregiver] membership revoked', { patientUid, caregiverUid, callerUid })
    return { ok: true }
  },
)
