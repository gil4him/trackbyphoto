// The real ends of the outbox: IndexedDB on the phone, Firebase on the server.

import { ref, uploadBytesResumable, type UploadMetadata } from 'firebase/storage'
import {
  collection, doc, getDocsFromServer, limit, query, serverTimestamp, setDoc, Timestamp, updateDoc, where,
} from 'firebase/firestore'
import { db, storage } from '../firebase'
import {
  fromStored, memoryStore, Outbox, toStored,
  type OutboxBackend, type OutboxItem, type OutboxStore, type Stored, type UploadWatch,
} from './outbox'

const DB_NAME = 'tbp-outbox'
const STORE = 'photos'
/** Voice replies wait in their own database (see voiceOutbox.ts). */
export const VOICE_DB_NAME = 'tbp-voice-outbox'
/** Give up on a silent network call so the outbox can back off and retry. */
export const CALL_TIMEOUT_MS = 30_000

// Stop the SDK's own retrying after 30 s (its default is ten minutes); the
// outbox does the retrying. This does not end a request that is already on
// its way and has gone quiet: sendFile and the outbox's stall watch do that.
storage.maxUploadRetryTime = CALL_TIMEOUT_MS

export function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), CALL_TIMEOUT_MS)),
  ])
}

/**
 * Upload a file in a way the outbox can watch and stop: it hears each time
 * bytes move, and the upload is cancelled when the outbox gives up on it.
 */
export async function sendFile(path: string, blob: Blob, metadata: UploadMetadata, watch: UploadWatch): Promise<void> {
  // Read the bytes first, so a file the phone can no longer read fails here
  // under its own name instead of looking like a bad connection.
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (watch.signal.aborted) throw new Error('upload stalled')
  const task = uploadBytesResumable(ref(storage, path), bytes, metadata)
  const stop = () => { task.cancel() }
  watch.signal.addEventListener('abort', stop, { once: true })
  let moved = -1
  const off = task.on('state_changed', (snap) => {
    if (snap.bytesTransferred !== moved) { moved = snap.bytesTransferred; watch.progress() }
  })
  try {
    await task
  } finally {
    off()
    watch.signal.removeEventListener('abort', stop)
  }
}

const photoPath = (item: OutboxItem) => `photos/${item.uid}/${item.photoId}.${item.ext}`

const firebaseBackend: OutboxBackend = {
  upload: (item, watch) => sendFile(photoPath(item), item.blob, {
    contentType: item.blob.type || 'image/jpeg',
    // Kept on the object for forensics; the worker reads the memo doc.
    customMetadata: { uid: item.uid, photoId: item.photoId, takenAt: new Date(item.takenAtMs).toISOString() },
  }, watch),

  // A plain get() on a missing memo is denied by the rules (they read the
  // doc's patientUid), so look it up with a query the rules can check.
  memoExists: async (item) => {
    const q = query(
      collection(db, 'memos'),
      where('patientUid', '==', item.uid),
      where('photoPath', '==', photoPath(item)),
      limit(1),
    )
    return !(await withTimeout(getDocsFromServer(q), 'memo lookup')).empty
  },

  // Placeholder the UI renders as "메모 작성 중…" until the worker fills it.
  // Shape is enforced by the memos create rule in firestore.rules.
  createMemo: async (item) => {
    await withTimeout(setDoc(doc(db, 'memos', item.photoId), {
      // `patientUid` (not `uid`) is the schema field per the caregiver-share
      // plan. For self-managed accounts the uploader IS the patient.
      patientUid: item.uid,
      photoPath: photoPath(item),
      photoUrl: '',
      takenAt: Timestamp.fromMillis(item.takenAtMs),
      lat: item.lat,
      lng: item.lng,
      place: '',
      activity: '기타',
      memo: '',
      scene: '',
      status: 'pending',
      createdAt: serverTimestamp(),
      tzOffsetMin: item.tzOffsetMin,
      ...(item.tags ? { tags: item.tags } : {}),
    }), 'memo create')
  },

  // needsGeocode asks the worker to turn the coordinates into a place.
  patchGeo: async (photoId, geo) => {
    await withTimeout(updateDoc(doc(db, 'memos', photoId), { lat: geo.lat, lng: geo.lng, needsGeocode: true }), 'location update')
  },
}

function idbStore(dbName: string): OutboxStore {
  const open = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'photoId' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const run = async <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const idb = await open
    return new Promise<T>((resolve, reject) => {
      const req = op(idb.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return {
    put: async (item) => {
      const rec = await toStored(item)
      await run('readwrite', (s) => s.put(rec))
    },
    get: async (id) => {
      const rec = await run('readonly', (s) => s.get(id) as IDBRequest<Stored | OutboxItem | undefined>)
      return rec && fromStored(rec)
    },
    all: async () => (await run('readonly', (s) => s.getAll() as IDBRequest<(Stored | OutboxItem)[]>)).map(fromStored),
    delete: async (id) => { await run('readwrite', (s) => s.delete(id)) },
  }
}

// Without IndexedDB (some private-browsing modes) photos are still sent, but
// only kept for as long as the page stays open.
export function createStore(dbName: string): OutboxStore {
  try {
    if (typeof indexedDB !== 'undefined') return idbStore(dbName)
  } catch (err) {
    console.warn('[outbox] IndexedDB unavailable; photos are kept in memory only', err)
  }
  return memoryStore()
}

export const outbox = new Outbox(createStore(DB_NAME), firebaseBackend)
