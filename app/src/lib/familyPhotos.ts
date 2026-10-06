// Photos family send to a parent: sending, and the parent's answers.
// Rules: firestore.rules familyPhotos, storage.rules familyPhotos/.

import {
  collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, type Timestamp,
} from 'firebase/firestore'
import { deleteObject, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from '../firebase'
import { shrinkPhoto } from './image'
import type { FamilyPhoto } from '../types'

const ms = (t: unknown) => (t && typeof (t as Timestamp).toMillis === 'function' ? (t as Timestamp).toMillis() : 0)

function fromDoc(id: string, d: Record<string, unknown>): FamilyPhoto {
  const reply = d.reply as { kind: 'heart' | 'comment'; text?: string; at?: unknown } | undefined
  return {
    id,
    patientUid: d.patientUid as string,
    senderUid: d.senderUid as string,
    senderName: (d.senderName as string) || '가족',
    photoPath: d.photoPath as string,
    photoUrl: d.photoUrl as string | undefined,
    caption: (d.caption as string) || '',
    status: d.status === 'ready' ? 'ready' : 'pending',
    createdAtMs: ms(d.createdAt) || Date.now(),
    seenAtMs: d.seenAt ? ms(d.seenAt) || Date.now() : undefined,
    reply: reply ? { kind: reply.kind, text: reply.text, atMs: ms(reply.at) } : undefined,
  }
}

/** Live list of a parent's family photos, newest first. */
export function watchFamilyPhotos(patientUid: string, onChange: (photos: FamilyPhoto[]) => void): () => void {
  const q = query(collection(db, 'familyPhotos'), where('patientUid', '==', patientUid), orderBy('createdAt', 'desc'), limit(60))
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => fromDoc(d.id, d.data()))), (err) => console.warn('[familyPhotos] subscription', err))
}

/** Shrink, upload, and create the record the worker finishes. */
export async function sendFamilyPhoto(a: { patientUid: string; sender: { uid: string; name: string }; file: Blob; caption: string }): Promise<string> {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const photoPath = `familyPhotos/${a.patientUid}/${id}.jpg`
  const blob = await shrinkPhoto(a.file)
  await uploadBytes(ref(storage, photoPath), blob, { contentType: 'image/jpeg' })
  await setDoc(doc(db, 'familyPhotos', id), {
    patientUid: a.patientUid,
    senderUid: a.sender.uid,
    senderName: a.sender.name.slice(0, 40),
    photoPath,
    caption: a.caption.trim().slice(0, 60),
    status: 'pending',
    createdAt: serverTimestamp(),
  })
  return id
}

/** The parent's phone looked at it. */
export function markFamilyPhotoSeen(id: string): Promise<void> {
  return updateDoc(doc(db, 'familyPhotos', id), { seenAt: serverTimestamp() })
}

/** The parent's one reply: a heart, or a short written line. */
export function replyToFamilyPhoto(id: string, reply: { kind: 'heart' } | { kind: 'comment'; text: string }): Promise<void> {
  const body = reply.kind === 'heart'
    ? { kind: 'heart', at: serverTimestamp(), notified: false }
    : { kind: 'comment', text: reply.text.trim().slice(0, 60), at: serverTimestamp(), notified: false }
  return updateDoc(doc(db, 'familyPhotos', id), { reply: body })
}

/** The sender takes a photo back. */
export async function removeFamilyPhoto(p: FamilyPhoto): Promise<void> {
  await deleteDoc(doc(db, 'familyPhotos', p.id))
  await deleteObject(ref(storage, p.photoPath)).catch(() => {})
}
