/**
 * Counts of the two growth moments for the 운영실: the store's review prompt
 * was asked for, and 가족·친구에게 알리기 was tapped. One field per event on
 * admin_daily/{YYYY-MM-DD}. The review ask also stamps users/{uid}.lastReviewAskAt,
 * which holds the prompt to once in 90 days per account (app/src/lib/reviewPrompt.ts).
 * firestore.rules keeps a parent's phone from sending this.
 */

import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { WorkerError, type Caller } from '../context.js'

export const GROWTH_EVENTS = ['review_prompt_shown', 'share_tapped'] as const

export async function logGrowthEvent(caller: Caller, data: { event?: unknown }): Promise<{ ok: true }> {
  const event = data?.event
  if (typeof event !== 'string' || !(GROWTH_EVENTS as readonly string[]).includes(event)) {
    throw new WorkerError('invalid-argument', 'unknown event')
  }
  const db = getFirestore()
  const day = new Date().toISOString().slice(0, 10)
  const batch = db.batch()
  batch.set(db.collection('admin_daily').doc(day), { date: day, [event]: FieldValue.increment(1) }, { merge: true })
  if (event === 'review_prompt_shown') {
    batch.set(db.collection('users').doc(caller.uid), { lastReviewAskAt: FieldValue.serverTimestamp() }, { merge: true })
  }
  await batch.commit()
  return { ok: true }
}
