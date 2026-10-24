/**
 * Request queue — the replacement for every HTTPS callable.
 *
 * The client writes requests/{autoId}:
 *   { type, uid, email, name, payload, status: 'pending', createdAt }
 * Firestore rules pin uid/email/name to the caller's verified auth token and
 * forbid client updates, so the identity on the doc is trustworthy. The worker
 * claims the doc (pending → processing, in a transaction so a restart can't
 * double-run it), runs the handler, and writes back either
 *   { status: 'done', result }  or  { status: 'error', code, message, details? }.
 * The client awaits that via onSnapshot and then deletes the doc.
 *
 * Requests orphaned by a client that gave up (timeout, closed tab) are purged
 * after a day.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { WorkerError, type Caller } from '../context.js'
import {
  acceptInvite,
  createInvite,
  lookupInvite,
  revokeMembership,
  setMembershipRole,
  syncCaregiverName,
} from './caregiver.js'
import { backfillMemoSchema, backfillPatientUid, regenerateMemo } from './admin.js'
import {
  adminDeleteAccount,
  adminGetPerson,
  adminListPeople,
  adminSetDisabled,
  adminSetMembership,
  adminSetPlan,
  adminUnlinkDevice,
  adminUpdateSettings,
} from './adminPeople.js'
import { adminMetrics } from './adminMetrics.js'
import { adminInbox } from './adminInbox.js'
import { adminGrowth } from './adminGrowth.js'
import { deleteMyAccount } from './account.js'
import {
  approvePairing,
  completePairing,
  createManagedElder,
  createPairingLink,
  deleteManagedElder,
  pairDevice,
  unlinkDevice,
} from './pairing.js'

import { registerFcmToken, setChannels } from './push.js'
import { setDigest } from './digest.js'
import { changePlan } from './plan.js'
import { searchAddress } from './geo.js'

type Handler = (caller: Caller, payload: any) => Promise<unknown>

// Must match the `type in [...]` allow-list in firestore.rules.
export const HANDLERS: Record<string, Handler> = {
  createInvite,
  lookupInvite,
  acceptInvite,
  revokeMembership,
  setMembershipRole,
  syncCaregiverName,
  regenerateMemo,
  backfillMemoSchema,
  backfillPatientUid,
  adminListPeople,
  adminGetPerson,
  adminDeleteAccount,
  adminUnlinkDevice,
  adminSetMembership,
  adminSetPlan,
  adminUpdateSettings,
  adminSetDisabled,
  adminMetrics,
  adminInbox,
  adminGrowth,
  createManagedElder,
  createPairingLink,
  pairDevice,
  approvePairing,
  completePairing,
  unlinkDevice,
  deleteManagedElder,
  deleteMyAccount,
  registerFcmToken,
  setChannels,
  setDigest,
  changePlan,
  searchAddress,
}

const STALE_AFTER_MS = 24 * 3600 * 1000

/** Claim and run one request. Safe to call repeatedly for the same id. */
export async function processRequest(requestId: string): Promise<void> {
  const db = getFirestore()
  const ref = db.collection('requests').doc(requestId)

  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists || snap.data()?.status !== 'pending') return null
    tx.update(ref, { status: 'processing', startedAt: FieldValue.serverTimestamp() })
    return snap.data()!
  })
  if (!claimed) return

  const type = claimed.type as string
  const caller: Caller = {
    uid: claimed.uid as string,
    email: (claimed.email as string | null) ?? null,
    name: (claimed.name as string | null) ?? null,
    emailVerified: claimed.emailVerified === true,
  }
  const started = Date.now()
  let outcome: Record<string, unknown>
  try {
    const handler = HANDLERS[type]
    if (!handler) throw new WorkerError('unimplemented', `unknown request type: ${type}`)
    const result = await handler(caller, claimed.payload ?? {})
    // Firestore rejects `undefined`; normalize through JSON.
    outcome = { status: 'done', result: result === undefined ? null : JSON.parse(JSON.stringify(result)) }
  } catch (err) {
    const code = err instanceof WorkerError ? err.code : 'internal'
    const message = err instanceof Error ? err.message : String(err)
    if (code === 'internal') logger.error('[request] handler threw', { requestId, type, err: message })
    // Someone probing the dashboard handlers should show up in the log.
    else if (code === 'permission-denied' && type.startsWith('admin')) {
      logger.warn('[request] admin request refused', { requestId, type, uid: caller.uid })
    }
    const details = err instanceof WorkerError ? err.details : undefined
    outcome = { status: 'error', code, message, ...(details ? { details } : {}) }
  }

  try {
    await ref.update({ ...outcome, finishedAt: FieldValue.serverTimestamp() })
  } catch (err) {
    // The client deleted the doc after timing out — nothing left to report to.
    logger.warn('[request] could not write result (client gave up?)', { requestId, type, err: String(err) })
  }
  // A refusal says why in the log: the client deletes the request doc once it
  // has read the answer, so this line is the only record of what went wrong
  // (handler messages are fixed strings, never the caller's input).
  const why = outcome.status === 'error' ? { code: outcome.code, message: outcome.message } : {}
  logger.info('[request] handled', { requestId, type, uid: caller.uid, status: outcome.status, ...why, ms: Date.now() - started })
}

/** Subscribe to pending requests. Handlers are pure Firestore work (except
 *  regenerateMemo), so they run concurrently rather than queueing behind memos. */
export function watchRequests(): () => void {
  return getFirestore()
    .collection('requests')
    .where('status', '==', 'pending')
    .onSnapshot(
      (snap) => {
        for (const change of snap.docChanges()) {
          if (change.type !== 'added') continue
          processRequest(change.doc.id).catch((err) =>
            logger.error('[request] processing failed', { requestId: change.doc.id, err: String(err) }))
        }
      },
      (err) => {
        logger.error('[request] listener died; exiting so launchd restarts us', { err: String(err) })
        process.exit(1)
      },
    )
}

/** Delete requests nobody collected (client timed out or closed the app). */
export async function purgeStaleRequests(): Promise<void> {
  const db = getFirestore()
  const cutoff = Timestamp.fromMillis(Date.now() - STALE_AFTER_MS)
  const stale = await db.collection('requests').where('createdAt', '<', cutoff).get()
  if (stale.empty) return
  const batch = db.batch()
  stale.forEach((d) => batch.delete(d.ref))
  await batch.commit()
  logger.info('[request] purged stale requests', { deleted: stale.size })
}

/**
 * Startup only: a request still 'processing' was interrupted mid-handler by a
 * crash/restart. Put it back to 'pending' so the listener re-runs it. Each
 * handler commits its writes in one atomic batch, so a re-run either redoes
 * the whole thing or (if the batch had landed) fails a precondition check —
 * e.g. "invite already used" — which is reported back to the client.
 */
export async function requeueInterruptedRequests(): Promise<void> {
  const stuck = await getFirestore().collection('requests').where('status', '==', 'processing').get()
  for (const d of stuck.docs) await d.ref.update({ status: 'pending' })
  if (!stuck.empty) logger.info('[request] requeued interrupted requests', { count: stuck.size })
}
