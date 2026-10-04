/**
 * "오늘 아직 사진이 없어요": on plans that include it, each family member is
 * told once when the parent has taken no photo by the evening. Runs from the
 * digest scheduler at the parent's digest hour. Never sent to the parent.
 */

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { logger } from '../log.js'
import type { PushMessage } from './push.js'

export interface CheckinArgs {
  patientUid: string
  patientName: string
  /** YYYYMMDD on the parent's clock. */
  dayKey: string
  dayStart: Date
  now: Date
  recipients: string[]
  push: (uids: string[], message: PushMessage) => Promise<unknown>
}

/** Returns how many family members were told (0 when there are photos, or everyone already was). */
export async function checkIn({ patientUid, patientName, dayKey, dayStart, now, recipients, push }: CheckinArgs): Promise<number> {
  const db = getFirestore()
  const today = await db.collection('memos')
    .where('patientUid', '==', patientUid)
    .where('takenAt', '>=', Timestamp.fromDate(dayStart))
    .where('takenAt', '<=', Timestamp.fromDate(now))
    .orderBy('takenAt', 'desc')
    .limit(1)
    .get()
  if (!today.empty) return 0

  const message = `오늘 아직 ${patientName}님의 사진이 없어요`
  const told: string[] = []
  for (const recipientUid of recipients) {
    try {
      // The id makes it once a day per person, however often this runs.
      await db.doc(`notifications/checkin_${patientUid}_${dayKey}_${recipientUid}`).create({
        recipientUid,
        patientUid,
        actorUid: 'worker',
        type: 'checkin.no_photo',
        message,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      })
      told.push(recipientUid)
    } catch (err) {
      if ((err as { code?: number }).code !== 6) throw err // 6 = already exists
    }
  }
  if (told.length) {
    await push(told, { title: '오늘하루', body: message, data: { type: 'checkin.no_photo', patientUid } })
    logger.info('[checkin] no photo today', { patientUid, told: told.length })
  }
  return told.length
}
