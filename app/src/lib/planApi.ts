// The plan sheet's calls: changing a plan (through the worker), and what is
// kept for a parent (read straight from Firestore, as the photo list is).

import {
  collection, getCountFromServer, getDocs, limit, orderBy, query, Timestamp, where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { startCheckout } from './payments'
import { callWorker } from './worker'
import type { Memory, PlanReason } from './plan'
import type { PlanTier, Reaction } from '../types'

export interface ChangePlanResult {
  tier: PlanTier
  changed: boolean
  /** Voice replies the family can now hear. */
  unlockedVoices: number
}

/** Put a parent on a plan. The worker checks who is asking and confirms the payment. */
export async function changePlan(patientUid: string, tier: PlanTier, source: PlanReason['kind']): Promise<ChangePlanResult> {
  const checkout = await startCheckout({ patientUid, tier })
  // `source` is which of the sheet's doors was used; the worker keeps it on the audit entry.
  return callWorker<ChangePlanResult>('changePlan', { patientUid, tier, source, ...(checkout.token ? { paymentToken: checkout.token } : {}) })
}

const memosOf = (patientUid: string) => [collection(db, 'memos'), where('patientUid', '==', patientUid)] as const

/** How many photos are kept for a parent, and when the oldest was taken. */
export async function loadMemory(patientUid: string): Promise<Memory> {
  const [base, mine] = memosOf(patientUid)
  const [total, oldest] = await Promise.all([
    getCountFromServer(query(base, mine)),
    getDocs(query(base, mine, orderBy('takenAt', 'asc'), limit(1))),
  ])
  const takenAt = oldest.docs[0]?.get('takenAt') as Timestamp | undefined
  return { count: total.data().count, oldestMs: takenAt?.toMillis() ?? null }
}

/** Photos taken before `beforeMs`: what a plan that keeps less would let go. */
export async function countPhotosBefore(patientUid: string, beforeMs: number): Promise<number> {
  const [base, mine] = memosOf(patientUid)
  return (await getCountFromServer(query(base, mine, where('takenAt', '<', Timestamp.fromMillis(beforeMs))))).data().count
}

/** Every voice reply a parent has left, newest first (목소리 앨범). */
export async function loadVoiceReplies(patientUid: string, max = 500): Promise<Reaction[]> {
  const snap = await getDocs(query(
    collection(db, 'reactions'),
    where('patientUid', '==', patientUid),
    where('kind', '==', 'voice'),
    orderBy('createdAt', 'desc'),
    limit(max),
  ))
  return snap.docs.map((d) => {
    const data = d.data()
    return { ...(data as Omit<Reaction, 'id' | 'createdAtMs'>), id: d.id, createdAtMs: data.createdAt?.toMillis?.() ?? 0 }
  })
}
