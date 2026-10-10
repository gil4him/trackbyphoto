/**
 * 계정 삭제 — a signed-in family member erases their own account.
 *
 * Apple guideline 5.1.1(v): an app that creates an account has to let the
 * person delete it from inside the app. The client calls this once from
 * 설정 → 계정 삭제 and signs out as soon as it answers.
 *
 * What goes: their own records (memos and photos, voice replies, digests,
 * consents, audit trail, notifications), the family links on their records
 * and the ones they hold on other people's, the settings doc with every
 * per-user subcollection under it (devices, private/*), the files they left
 * on a parent's record, and last of all the sign-in itself.
 *
 * What stays: the parents they look after. A family-managed elder is a
 * separate account with its own photos, and other family may still be
 * watching it — 부모님 삭제 (deleteManagedElder) is how that one goes. The
 * confirmation sheet in the app says so.
 *
 * Deliberately kept, because they belong to whoever stays behind: the
 * notices and audit entries this person caused on someone else's record
 * (`actorUid`) — that person's §8 safeguard trail; the consents they granted
 * on a parent's behalf (`guardianUid`), which are the parent's record of why
 * their data may be processed at all; and `memberships.invitedBy` on family
 * they invited, since dropping those would cut another member's access.
 *
 * Every step is a sweep over "docs whose <field> is my uid", so a run that
 * fails half-way can simply be repeated.
 */

import { getAuth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'
import { getFirestore } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { WorkerError as HttpsError, type Caller } from '../context.js'

// Every top-level collection to sweep, with the field that names the owner.
// Both sides of each link: `patientUid` is this account's own record, the
// rest is what it left on a parent's (a heart or reply, a photo it sent, its
// own membership, a pairing link it made).
const OWNED: ReadonlyArray<readonly [string, string]> = [
  ['memos', 'patientUid'],
  ['digests', 'patientUid'],
  ['reactions', 'patientUid'],
  ['reactions', 'actorUid'],
  ['familyPhotos', 'patientUid'],
  ['familyPhotos', 'senderUid'],
  ['consents', 'patientUid'],
  ['memberships', 'patientUid'],
  ['memberships', 'caregiverUid'],
  ['pairings', 'patientUid'],
  ['pairings', 'claimedBy'],
  ['invites', 'patientUid'],
  ['invites', 'createdBy'],
  ['auditLogs', 'patientUid'],
  ['notifications', 'patientUid'],
  ['notifications', 'recipientUid'],
]

// Storage folders that hold nothing but one account's own files.
const OWN_PREFIXES = ['photos/', 'voice/', 'familyPhotos/']

function requireOwnAccount(caller: Caller): string {
  if (!caller.uid) throw new HttpsError('unauthenticated', 'sign in required')
  if (!caller.email) throw new HttpsError('permission-denied', 'a signed-in family account is required')
  return caller.uid
}

export async function deleteMyAccount(caller: Caller): Promise<{ ok: true }> {
  const uid = requireOwnAccount(caller)
  const db = getFirestore()

  // An elder's phone has no settings screen at all, and a family-managed
  // account belongs to whoever registered it (부모님 삭제).
  const authUser = await getAuth().getUser(uid).catch(() => null)
  if (authUser?.customClaims?.elder) {
    throw new HttpsError('permission-denied', "an elder's phone cannot delete the account")
  }
  const userRef = db.collection('users').doc(uid)
  const settings = (await userRef.get()).data() as { accountType?: string } | undefined
  if (settings?.accountType === 'managed') {
    throw new HttpsError('failed-precondition', 'a family-managed account is deleted by its guardian')
  }

  // Files this account left under someone else's prefix (a voice reply on a
  // parent's memo, a photo sent to them): the prefix sweep below can't see
  // them, so collect them while the docs that name them still exist.
  const strays = new Set<string>()
  const isOwnFile = (path: string) => OWN_PREFIXES.some((p) => path.startsWith(`${p}${uid}/`))

  const writer = db.bulkWriter()
  for (const [name, field] of OWNED) {
    const snap = await db.collection(name).where(field, '==', uid).get()
    for (const d of snap.docs) {
      const path = d.get('audioPath') ?? d.get('photoPath')
      if (typeof path === 'string' && path && !isOwnFile(path)) strays.add(path)
      writer.delete(d.ref)
    }
  }
  // Requests this account queued. Anything still 'processing' is this very
  // call — the queue has yet to write its answer back to it — so the daily
  // stale purge takes those instead.
  const requests = await db.collection('requests').where('uid', '==', uid).get()
  for (const d of requests.docs) if (d.get('status') !== 'processing') writer.delete(d.ref)
  await writer.close()

  // Settings, with devices/ and private/* underneath.
  await db.recursiveDelete(userRef)

  // Tests run without a storage emulator; skip rather than reach real GCS.
  if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    const bucket = getStorage().bucket()
    for (const prefix of OWN_PREFIXES) {
      await bucket.deleteFiles({ prefix: `${prefix}${uid}/` }).catch((err) =>
        logger.warn('[account] file cleanup failed', { uid, prefix, err: String(err) }))
    }
    for (const path of strays) {
      await bucket.file(path).delete({ ignoreNotFound: true }).catch((err) =>
        logger.warn('[account] file cleanup failed', { uid, path, err: String(err) }))
    }
  }

  // Last: the sign-in. Keeping it to the end means a run that fails on the
  // way can be repeated by the same person, from the same screen.
  await getAuth().deleteUser(uid).catch((err) => {
    if ((err as { code?: string }).code !== 'auth/user-not-found') throw err
  })

  logger.info('[account] account deleted', { uid, strayFiles: strays.size })
  return { ok: true }
}
