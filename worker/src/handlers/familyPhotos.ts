/**
 * Photos family send to a parent (familyPhotos/{id}).
 *
 * A family member uploads the photo and creates the record as 'pending'.
 * This finishes it: a plain link the parent's phone and the family can show
 * (the same download-token link memos use) and status 'ready'. While the
 * `familyPhotos` switch is off, records stay pending and no screen shows
 * them.
 *
 * The parent's phone leaves one reply on a photo (a heart or a short written
 * line). The sender is told once per reply, in the app and by push: a
 * parent's answer is what the sender is waiting for.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import { downloadLink } from '../storageLinks.js'
import { flagOn } from '../plans.js'
import { pushToUsers, type PushMessage } from './push.js'

export interface FamilyPhotoDeps {
  /** A plain link to the photo; null when the file isn't there. */
  linkTo: (photoPath: string) => Promise<string | null>
  push?: (uids: string[], message: PushMessage) => Promise<unknown>
}

export const defaultFamilyPhotoDeps: FamilyPhotoDeps = {
  linkTo: downloadLink,
}

/** Give a pending photo its link. Returns what happened. */
export async function readyFamilyPhoto(id: string, deps: FamilyPhotoDeps = defaultFamilyPhotoDeps): Promise<'ready' | 'off' | 'no-file' | 'skipped'> {
  if (!(await flagOn('familyPhotos'))) return 'off'
  const db = getFirestore()
  const ref = db.collection('familyPhotos').doc(id)
  const data = (await ref.get()).data()
  if (!data || data.status !== 'pending') return 'skipped'
  const photoUrl = await deps.linkTo(data.photoPath as string)
  if (!photoUrl) {
    // The record arrived before the upload finished (or the upload failed);
    // the next pass picks it up again.
    return 'no-file'
  }
  await ref.update({ photoUrl, status: 'ready', readyAt: FieldValue.serverTimestamp() })
  logger.info('[familyPhoto] ready', { id, patientUid: data.patientUid, senderUid: data.senderUid })
  return 'ready'
}

/** Tell the sender about the parent's reply, once. */
export async function announceFamilyPhotoReply(id: string, deps: FamilyPhotoDeps = defaultFamilyPhotoDeps): Promise<boolean> {
  const db = getFirestore()
  const ref = db.collection('familyPhotos').doc(id)
  const data = (await ref.get()).data()
  const reply = data?.reply as { kind?: string; text?: string; notified?: boolean } | undefined
  if (!data || !reply || reply.notified !== false) return false
  const patientUid = data.patientUid as string
  const senderUid = data.senderUid as string
  const patientName = ((await db.doc(`users/${patientUid}`).get()).data()?.patientName as string) || '부모님'
  const message = reply.kind === 'comment' && reply.text
    ? `${patientName}님이 보낸 사진에 답장했어요: “${reply.text}”`
    : `${patientName}님이 보낸 사진에 ❤️를 보냈어요`

  const told = await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data()
    if (!fresh || (fresh.reply as { notified?: boolean } | undefined)?.notified !== false) return false
    tx.update(ref, { 'reply.notified': true })
    tx.set(db.collection('notifications').doc(), {
      recipientUid: senderUid,
      patientUid,
      actorUid: patientUid,
      type: 'familyPhoto.reply',
      message,
      familyPhotoId: id,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    })
    return true
  })
  if (!told) return false
  await (deps.push ?? pushToUsers)([senderUid], { title: '오늘하루', body: message, data: { type: 'familyPhoto.reply', patientUid, familyPhotoId: id } })
  logger.info('[familyPhoto] reply announced', { id, patientUid, senderUid, kind: reply.kind })
  return true
}

const RETRY_MS = 30_000

/** Pending photos and un-announced replies, as they appear. Returns how to stop. */
export function watchFamilyPhotos(deps: FamilyPhotoDeps = defaultFamilyPhotoDeps): () => void {
  const db = getFirestore()
  const pending = new Set<string>()
  const die = (what: string) => (err: unknown) => {
    logger.error(`[familyPhoto] ${what} listener died; exiting so launchd restarts us`, { err: String(err) })
    process.exit(1)
  }
  const ready = async (id: string) => {
    try {
      const outcome = await readyFamilyPhoto(id, deps)
      if (outcome === 'no-file' || outcome === 'off') pending.add(id); else pending.delete(id)
    } catch (err) {
      logger.warn('[familyPhoto] could not finish a photo; will retry', { id, err: String(err) })
      pending.add(id)
    }
  }
  const unsubPending = db.collection('familyPhotos').where('status', '==', 'pending').onSnapshot((snap) => {
    for (const change of snap.docChanges()) {
      if (change.type === 'removed') pending.delete(change.doc.id)
      else void ready(change.doc.id)
    }
  }, die('pending'))
  const unsubReplies = db.collection('familyPhotos').where('reply.notified', '==', false).onSnapshot((snap) => {
    for (const change of snap.docChanges()) {
      if (change.type !== 'removed') {
        announceFamilyPhotoReply(change.doc.id, deps).catch((err) => logger.warn('[familyPhoto] reply not announced', { id: change.doc.id, err: String(err) }))
      }
    }
  }, die('reply'))
  // Photos whose file wasn't there yet, or that arrived while the switch was off.
  const timer = setInterval(() => { for (const id of [...pending]) void ready(id) }, RETRY_MS)
  return () => { unsubPending(); unsubReplies(); clearInterval(timer) }
}
