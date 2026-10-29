// The plan sheet's calls: changing a plan (through the worker), and what is
// kept for a parent (read straight from Firestore, as the photo list is).

import {
  collection, getCountFromServer, getDocs, limit, orderBy, query, Timestamp, where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { restorePurchases, startCheckout } from './payments'
import { callWorker } from './worker'
import type { Memory, PlanReason } from './plan'
import type { PlanTier, Reaction } from '../types'

export interface ChangePlanResult {
  tier: PlanTier
  changed: boolean
  /** Voice replies the family can now hear. */
  unlockedVoices: number
  /** When the free trial this purchase started ends (epoch ms); null when it
   *  started none. Workers older than the trial leave it out. */
  trialEndsAt: number | null
}

/** Put a parent on a plan. `live`: the store takes the payment first; the
 *  worker then checks who is asking and confirms the purchase. */
export async function changePlan(patientUid: string, tier: PlanTier, source: PlanReason['kind'], live = false): Promise<ChangePlanResult> {
  const checkout = await startCheckout({ patientUid, tier }, live)
  // `source` is which of the sheet's doors was used; the worker keeps it on the audit entry.
  return callWorker<ChangePlanResult>('changePlan', { patientUid, tier, source, ...(checkout.token ? { paymentToken: checkout.token } : {}) })
}

/** 구매 복원: ask the store what this person already pays for, then put the
 *  parent on it. Null when there is nothing to restore. */
export async function restorePlan(patientUid: string): Promise<{ tier: PlanTier; result: ChangePlanResult } | null> {
  const { tier, token } = await restorePurchases()
  if (!tier || !token) return null
  const result = await callWorker<ChangePlanResult>('changePlan', { patientUid, tier, source: 'settings', paymentToken: token })
  return { tier, result }
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
