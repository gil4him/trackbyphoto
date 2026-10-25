/**
 * adminSendCheckIn — 운영실 D10: 안부 알림 보내기 from 할 일's "3일째 사진이
 * 없어요". For each parent asked about, every active family member gets the
 * owner-approved line (CLAUDE.md, 2026-10-25) in their 알림 list and as a push:
 *
 *   요즘 {이름} 사진이 뜸해요. 3일째 소식이 없는데, 전화 한 통 드려 보시는 건 어때요?
 *
 * A parent is skipped when photos came in the last 72 hours (no longer quiet),
 * when a notice went out for them in the last 72 hours, or when nobody is
 * linked. Every send writes an admin_log row (checkin.send).
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { WorkerError, type Caller } from '../context.js'
import { requireAdmin } from './admin.js'
import { adminLog } from './adminPeople.js'
import { elderName, familyNotice } from './pairing.js'
import { pushToUsers, type PushMessage } from './push.js'

const QUIET_MS = 72 * 3600_000
const MAX_PARENTS = 50

/** Kin words are names in their own right (never 엄마님); others get 님 (app/src/lib/people.ts). */
const KIN = ['엄마', '아빠', '어머니', '아버지', '할머니', '할아버지']
export function addressed(name: string): string {
  const n = name.trim() || '부모님'
  const bare = n.replace(/\s*님$/, '')
  if (KIN.includes(bare) || bare === '부모님') return bare
  return n.endsWith('님') ? n : `${n}님`
}

/** The owner-approved wording (2026-10-25). */
export const checkInLine = (name: string) => `요즘 ${addressed(name)} 사진이 뜸해요. 3일째 소식이 없는데, 전화 한 통 드려 보시는 건 어때요?`

export type SkipReason = 'not-quiet' | 'recent' | 'no-family' | 'not-a-parent'

export interface CheckInDeps { push: (uids: string[], message: PushMessage) => Promise<number> }
const defaultDeps: CheckInDeps = { push: pushToUsers }

export async function adminSendCheckIn(
  caller: Caller,
  data: { patientUids?: unknown },
  deps: CheckInDeps = defaultDeps,
): Promise<{ sent: { patientUid: string; recipients: number }[]; skipped: { patientUid: string; reason: SkipReason }[] }> {
  requireAdmin(caller)
  const uids = Array.isArray(data?.patientUids) ? [...new Set(data.patientUids.filter((u): u is string => typeof u === 'string' && !!u.trim()))] : []
  if (!uids.length) throw new WorkerError('invalid-argument', 'patientUids required')
  if (uids.length > MAX_PARENTS) throw new WorkerError('invalid-argument', `at most ${MAX_PARENTS} parents at once`)

  const db = getFirestore()
  const now = Date.now()
  const sent: { patientUid: string; recipients: number }[] = []
  const skipped: { patientUid: string; reason: SkipReason }[] = []

  for (const patientUid of uids) {
    const user = (await db.doc(`users/${patientUid}`).get()).data()
    if (user?.accountType !== 'managed') { skipped.push({ patientUid, reason: 'not-a-parent' }); continue }
    const recent = await db.collection('memos').where('patientUid', '==', patientUid)
      .where('takenAt', '>=', Timestamp.fromMillis(now - QUIET_MS)).limit(1).get()
    if (!recent.empty) { skipped.push({ patientUid, reason: 'not-quiet' }); continue }

    // Worker-only state (no client can read or write users/{uid}/private).
    const stateRef = db.doc(`users/${patientUid}/private/checkin`)
    const family = (await db.collection('memberships').where('patientUid', '==', patientUid).where('status', '==', 'active').get())
      .docs.map((d) => String(d.get('caregiverUid'))).filter((u) => u && u !== patientUid)
    if (!family.length) { skipped.push({ patientUid, reason: 'no-family' }); continue }

    const claimed = await db.runTransaction(async (tx) => {
      const last = (await tx.get(stateRef)).get('lastSentAt') as Timestamp | undefined
      if (last && now - last.toMillis() < QUIET_MS) return false
      tx.set(stateRef, { lastSentAt: Timestamp.fromMillis(now) }, { merge: true })
      return true
    })
    if (!claimed) { skipped.push({ patientUid, reason: 'recent' }); continue }

    const name = await elderName(patientUid)
    const line = checkInLine(name)
    const batch = db.batch()
    for (const uid of family) batch.set(db.collection('notifications').doc(), familyNotice(uid, patientUid, caller.uid, 'checkin.quiet', line))
    await batch.commit()
    // Best-effort, like every family push: the 알림 list already has it.
    await deps.push(family, { title: 'Daylie', body: line, data: { type: 'checkin.quiet', patientUid } }).catch(() => 0)
    await adminLog(caller.uid, 'checkin.send', patientUid, name, { recipients: family.length })
    sent.push({ patientUid, recipients: family.length })
  }
  return { sent, skipped }
}

