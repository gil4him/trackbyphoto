// Client-side wrappers for the caregiver-share Cloud Functions.
//
// Three callables live in functions/src/caregiver.ts:
//   createInvite      — patient/admin issues a 6-digit code; the function
//                       bundles two consent docs + the invite + an audit log
//                       into a single batched commit.
//   acceptInvite      — caregiver enters the code; function validates and
//                       atomically activates the membership.
//   revokeMembership  — owner/admin/self revokes; function flips status and
//                       writes the audit log.
//
// The region MUST match `REGION` in the functions module ('us-west1') —
// httpsCallable hits the wrong endpoint otherwise and the call silently 404s.
//
// We construct a fresh httpsCallable on every call rather than memoizing
// because the underlying Functions instance is cheap and memoizing across
// auth state changes can hold a stale Auth token; the SDK reads the current
// token on each call anyway.

import { getFunctions, httpsCallable } from 'firebase/functions'

const REGION = 'us-west1'

function fns() {
  return getFunctions(undefined, REGION)
}

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
  const fn = httpsCallable<typeof args, CreateInviteResult>(fns(), 'createInvite')
  const res = await fn(args)
  return res.data
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
  const fn = httpsCallable<{ code: string }, AcceptInviteResult>(fns(), 'acceptInvite')
  const res = await fn({ code })
  return res.data
}

/**
 * Flip a membership to status='revoked'. The patient or an active admin
 * caregiver can revoke any caregiver; a caregiver can self-revoke. The
 * function writes an audit log in the same batch.
 */
export async function revokeMembership(args: {
  patientUid: string
  caregiverUid: string
  reason?: string
}): Promise<void> {
  const fn = httpsCallable<typeof args, { ok: true }>(fns(), 'revokeMembership')
  await fn(args)
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
