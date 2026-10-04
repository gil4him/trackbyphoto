// The parent's voice replies wait on the phone until they are sent, exactly
// like photos: the clip is saved first, then uploaded and announced with
// retries, so "보냈어요 ✓" is true even on a weak connection.
//
// Reuses the photo Outbox with its own database and backend. In an entry,
// `photoId` is the reaction id and `tags` carries { memoId, actorName }.

import { ref, uploadBytes } from 'firebase/storage'
import { collection, doc, getDocsFromServer, limit, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { db, storage } from '../firebase'
import { Outbox, type OutboxBackend, type OutboxItem } from './outbox'
import { createStore, VOICE_DB_NAME, withTimeout } from './outboxBackend'

interface VoiceMeta {
  memoId: string
  actorName: string
}

const meta = (item: OutboxItem) => item.tags as VoiceMeta
const clipPath = (item: OutboxItem) => `voice/${item.uid}/${meta(item).memoId}/${item.photoId}.${item.ext}`

const voiceBackend: OutboxBackend = {
  upload: async (item) => {
    await uploadBytes(ref(storage, clipPath(item)), item.blob, { contentType: item.blob.type || 'audio/webm' })
  },

  // An earlier attempt may have got through without our hearing back.
  memoExists: async (item) => {
    const q = query(
      collection(db, 'reactions'),
      where('patientUid', '==', item.uid),
      where('audioPath', '==', clipPath(item)),
      limit(1),
    )
    return !(await withTimeout(getDocsFromServer(q), 'voice reply lookup')).empty
  },

  // Shape is enforced by the reactions create rule in firestore.rules.
  createMemo: async (item) => {
    await withTimeout(setDoc(doc(db, 'reactions', item.photoId), {
      memoId: meta(item).memoId,
      patientUid: item.uid,
      actorUid: item.uid,
      actorName: meta(item).actorName.slice(0, 40),
      kind: 'voice',
      status: 'pending',
      notified: false,
      audioPath: clipPath(item),
      createdAt: serverTimestamp(),
    }), 'voice reply create')
  },

  patchGeo: async () => {},
}

export const voiceOutbox = new Outbox(createStore(VOICE_DB_NAME), voiceBackend, { geoWaitMs: 0 })

/** Queue a recorded reply. Resolves once it is safely on the phone. */
export async function sendVoice(args: { uid: string; memoId: string; actorName: string; blob: Blob; ext: string }): Promise<void> {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  await voiceOutbox.enqueue({
    photoId: id,
    uid: args.uid,
    blob: args.blob,
    ext: args.ext,
    takenAtMs: Date.now(),
    lat: null,
    lng: null,
    tzOffsetMin: -new Date().getTimezoneOffset(),
    tags: { memoId: args.memoId, actorName: args.actorName } satisfies VoiceMeta,
  })
}
