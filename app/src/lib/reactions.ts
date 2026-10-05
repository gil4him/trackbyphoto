// Reactions on a memo: hearts and comments from family, hearts and voice
// replies from the parent. Written straight to Firestore (shape enforced by
// firestore.rules) so they work while the Mac mini is off; the worker then
// announces each one and transcribes voice.

import {
  addDoc, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore'
import { auth, db } from '../firebase'
import type { Reaction } from '../types'

export const COMMENT_MAX = 60
const NAME_MAX = 40

export interface Actor {
  uid: string
  name: string
}

/** The name the rules will accept for a family member: the one in their
 *  sign-in token when it has one, else whatever the app shows. */
export async function familyActor(fallbackName: string): Promise<Actor> {
  const user = auth.currentUser
  if (!user) throw new Error('not signed in')
  const claim = (await user.getIdTokenResult()).claims.name
  const name = (typeof claim === 'string' && claim) || fallbackName || '가족'
  return { uid: user.uid, name: name.slice(0, NAME_MAX) }
}

/** Live reactions for one patient, newest first. */
export function watchReactions(patientUid: string, onChange: (items: Reaction[]) => void): () => void {
  const q = query(
    collection(db, 'reactions'),
    where('patientUid', '==', patientUid),
    orderBy('createdAt', 'desc'),
    limit(300),
  )
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => {
      const data = d.data({ serverTimestamps: 'estimate' })
      return { ...(data as Omit<Reaction, 'id' | 'createdAtMs'>), id: d.id, createdAtMs: data.createdAt?.toMillis?.() ?? Date.now() }
    }))
  }, (err) => console.error('[reactions] subscription error', err))
}

const base = (memoId: string, patientUid: string, actor: Actor) => ({
  memoId,
  patientUid,
  actorUid: actor.uid,
  actorName: actor.name.slice(0, NAME_MAX),
  status: 'ready',
  notified: false,
  createdAt: serverTimestamp(),
})

/** Family: one heart per person per memo (the doc id makes it so). */
export function sendFamilyHeart(memoId: string, patientUid: string, actor: Actor): Promise<void> {
  return setDoc(doc(db, 'reactions', `${memoId}_${actor.uid}`), { ...base(memoId, patientUid, actor), kind: 'heart' })
}

export async function sendComment(memoId: string, patientUid: string, actor: Actor, text: string): Promise<void> {
  const clean = text.trim().slice(0, COMMENT_MAX)
  if (!clean) return
  await addDoc(collection(db, 'reactions'), { ...base(memoId, patientUid, actor), kind: 'comment', text: clean })
}

/** The parent's 고마워요. Every tap is its own heart. */
export async function sendElderHeart(memoId: string, actor: Actor): Promise<void> {
  await addDoc(collection(db, 'reactions'), { ...base(memoId, actor.uid, actor), kind: 'heart' })
}

/** The parent's written answer: a ready-made phrase or a few typed words. */
export async function sendElderComment(memoId: string, actor: Actor, text: string): Promise<void> {
  const clean = text.trim().slice(0, COMMENT_MAX)
  if (!clean) return
  await addDoc(collection(db, 'reactions'), { ...base(memoId, actor.uid, actor), kind: 'comment', text: clean })
}

export function removeReaction(id: string): Promise<void> {
  return deleteDoc(doc(db, 'reactions', id))
}

/** Stamp reactions as seen. Best effort: a missed stamp only re-shows news. */
export function markRead(ids: string[], by: 'elder' | 'family'): void {
  const field = by === 'elder' ? 'readByElderAt' : 'readByFamilyAt'
  for (const id of ids) {
    updateDoc(doc(db, 'reactions', id), { [field]: serverTimestamp() })
      .catch((err) => console.warn('[reactions] read stamp failed', id, err))
  }
}
