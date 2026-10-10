// A phone whose account no longer exists: the family deleted the parent
// (부모님 삭제), or the account was removed elsewhere. The sign-in library
// itself only notices at its hourly token refresh, so the app asks.
// 계정 삭제 (below) is the other way an account goes: this person asking.

import { callWorker } from './worker'

/** Answers to a token refresh that mean the account is gone for good (the
 *  sign-in can never be renewed): Firebase reports a deleted account as
 *  user-token-expired, the local emulator as invalid-refresh-token. Any other
 *  failure (no connection, a slow one) is not believed. */
const GONE = new Set([
  'auth/user-token-expired', 'auth/user-not-found', 'auth/user-disabled', 'auth/invalid-user-token', 'auth/invalid-refresh-token',
])

export function accountGone(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && GONE.has(code)
}

/** What this phone kept about that account. The plans table (not personal)
 *  stays; the Firestore cache is memory only and goes with the reload. */
export function forgetAccountKeys(uid: string): void {
  for (const key of [`tbp.settings.${uid}`, `tbp.activePatient.${uid}`]) {
    try { localStorage.removeItem(key) } catch { /* storage blocked */ }
  }
}

/**
 * 계정 삭제 — erase this account: my records and photos, my family links and
 * the sign-in itself. The worker refuses it for a parent's phone and for a
 * family-managed account (that one is 부모님 삭제). Takes a while on an
 * account with many photos, so it gets the longer timeout.
 *
 * The caller signs out right after; what this phone kept is dropped here so
 * nothing of the account is left behind even if the sign-out is interrupted.
 */
export async function deleteMyAccount(uid: string): Promise<void> {
  await callWorker('deleteMyAccount', {}, { timeoutMs: 120_000 })
  forgetAccountKeys(uid)
  // Photos and voice replies still waiting on this phone go too.
  await Promise.all([
    import('./outboxBackend').then((m) => m.outbox.drop(uid)),
    import('./voiceOutbox').then((m) => m.voiceOutbox.drop(uid)),
  ]).catch(() => {})
}
