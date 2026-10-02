// Client-side wrappers for the caregiver-share requests, handled by the Mac
// mini worker (worker/src/handlers/caregiver.ts) via the requests queue:
//   createInvite      — patient/admin issues a 6-digit code; the worker
//                       bundles two consent docs + the invite + an audit log
//                       into a single batched commit.
//   acceptInvite      — caregiver enters the code; worker validates and
//                       atomically activates the membership.
//   revokeMembership  — owner/admin/self revokes; worker flips status and
//                       writes the audit log.
//
// Each call rejects with WorkerError('unavailable') when the Mac mini doesn't
// answer in time — show WORKER_OFFLINE_MESSAGE in that case.

import { callWorker } from './worker'

export type InvitableRole = 'admin' | 'viewer'

export interface CreateInviteResult {
  code: string
  /** ISO timestamp at which the code stops working. */
  expiresAt: string
}

/**
 * Issue a fresh 6-digit invite code. Caller must be the patient or an active
 * admin caregiver on the patient. Pass through the consent scope strings so
 * the audit trail records the exact wording the user agreed to.
 */
export async function createInvite(args: {
  patientUid: string
  role: InvitableRole
  sensitiveScope?: string
  thirdPartyScope?: string
  consentTextVersion?: string
}): Promise<CreateInviteResult> {
  return callWorker<CreateInviteResult>('createInvite', args)
}

export interface AcceptInviteResult {
  patientUid: string
  role: InvitableRole
  membershipId: string
}

/**
 * Redeem a 6-digit code. On success the caller has an active membership on
 * the returned patient — the UI should switch the patient context to
 * `patientUid` so the new memos load immediately.
 */
export async function acceptInvite(code: string): Promise<AcceptInviteResult> {
  return callWorker<AcceptInviteResult>('acceptInvite', { code })
}

/**
 * Flip a membership to status='revoked'. The patient or an active admin
 * caregiver can revoke any caregiver; a caregiver can self-revoke. The
 * worker writes an audit log in the same batch.
 */
export async function revokeMembership(args: {
  patientUid: string
  caregiverUid: string
  reason?: string
}): Promise<void> {
  await callWorker<{ ok: true }>('revokeMembership', args)
}

/**
 * Change a caregiver's role (admin ↔ viewer). Owner or guardian only; the
 * worker writes an audit log in the same batch.
 */
export async function setMembershipRole(args: {
  patientUid: string
  caregiverUid: string
  role: InvitableRole
}): Promise<void> {
  await callWorker<{ ok: true }>('setMembershipRole', args)
}

/**
 * Stamp the signed-in caregiver's real (Google) name onto their membership
 * rows so the patient sees a name, not a UID. Fire-and-forget on sign-in.
 */
export async function syncCaregiverName(): Promise<void> {
  await callWorker<{ updated: number }>('syncCaregiverName')
}

// ────────────────────────────────────────────────────────────────────────────
// UI helpers
// ────────────────────────────────────────────────────────────────────────────

/** Format a 6-digit code as "123 456" for at-a-glance readability. */
export function formatInviteCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code
}

/** Strip whitespace and non-digits from user-entered code text. */
export function normalizeInviteCode(input: string): string {
  return input.replace(/\D+/g, '').slice(0, 6)
}
