/**
 * Family links to accounts that no longer exist.
 *
 * 부모님 삭제 removes a parent's account together with every family link to
 * it. An account removed any other way (straight from the Firebase console,
 * say) leaves those links behind, and each family member keeps seeing a
 * nameless entry in their list. This pass withdraws such links.
 *
 * "No longer exists" is deliberately narrow: no settings doc AND no sign-in
 * account. An account that still has either is left alone.
 */

import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { logger } from '../log.js'

const RUN_EVERY_MS = 24 * 3600 * 1000

/** Withdraw every active family link whose patient is gone. Returns how many. */
export async function revokeLinksToDeletedAccounts(): Promise<number> {
  const db = getFirestore()
  const active = await db.collection('memberships').where('status', '==', 'active').get()
  const byPatient = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>()
  for (const m of active.docs) {
    const patientUid = m.get('patientUid') as string | undefined
    if (patientUid) byPatient.set(patientUid, [...(byPatient.get(patientUid) ?? []), m])
  }

  let revoked = 0
  for (const [patientUid, links] of byPatient) {
    if ((await db.doc(`users/${patientUid}`).get()).exists) continue
    try {
      await getAuth().getUser(patientUid)
      continue // the sign-in account is still there
    } catch (err) {
      // Anything but a plain "no such user" (a network error, say) proves nothing.
      if ((err as { code?: string }).code !== 'auth/user-not-found') {
        logger.warn('[housekeeping] could not check an account; leaving its links', { patientUid, err: String(err) })
        continue
      }
    }
    const batch = db.batch()
    for (const link of links) {
      batch.update(link.ref, { status: 'revoked', revokedAt: FieldValue.serverTimestamp(), revokedBy: 'worker' })
      batch.set(db.collection('auditLogs').doc(), {
        patientUid,
        actorUid: 'worker',
        action: 'membership.revoke',
        details: { caregiverUid: link.get('caregiverUid') ?? null, reason: 'account-deleted' },
        timestamp: FieldValue.serverTimestamp(),
      })
    }
    await batch.commit()
    revoked += links.length
    logger.info('[housekeeping] withdrew links to a deleted account', { patientUid, links: links.length })
  }
  return revoked
}

/** Now, then once a day. Returns how to stop. */
export function startHousekeeping(): () => void {
  const run = () => { revokeLinksToDeletedAccounts().catch((err) => logger.warn('[housekeeping] failed', { err: String(err) })) }
  const first = setTimeout(run, 60_000)
  const timer = setInterval(run, RUN_EVERY_MS)
  return () => { clearTimeout(first); clearInterval(timer) }
}
