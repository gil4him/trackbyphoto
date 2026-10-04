// The real ends of the outbox: IndexedDB on the phone, Firebase on the server.

import { ref, uploadBytes } from 'firebase/storage'
import {
  collection, doc, getDocsFromServer, limit, query, serverTimestamp, setDoc, Timestamp, updateDoc, where,
} from 'firebase/firestore'
import { db, storage } from '../firebase'
import { memoryStore, Outbox, type OutboxBackend, type OutboxItem, type OutboxStore } from './outbox'

const DB_NAME = 'tbp-outbox'
const STORE = 'photos'
/** Give up on a silent network call so the outbox can back off and retry. */
const CALL_TIMEOUT_MS = 30_000

// Fail an upload after 30 s without progress; the SDK's own default keeps
// retrying for ten minutes, which would hold up every photo behind it.
storage.maxUploadRetryTime = CALL_TIMEOUT_MS

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), CALL_TIMEOUT_MS)),
  ])
}

const photoPath = (item: OutboxItem) => `photos/${item.uid}/${item.photoId}.${item.ext}`

const firebaseBackend: OutboxBackend = {
  upload: async (item) => {
    await uploadBytes(ref(storage, photoPath(item)), item.blob, {
      contentType: item.blob.type || 'image/jpeg',
      // Kept on the object for forensics; the worker reads the memo doc.
      customMetadata: { uid: item.uid, photoId: item.photoId, takenAt: new Date(item.takenAtMs).toISOString() },
    })
  },

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

function idbStore(): OutboxStore {
  const open = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
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
    put: async (item) => { await run('readwrite', (s) => s.put(item)) },
    get: (id) => run('readonly', (s) => s.get(id) as IDBRequest<OutboxItem | undefined>),
    all: () => run('readonly', (s) => s.getAll() as IDBRequest<OutboxItem[]>),
    delete: async (id) => { await run('readwrite', (s) => s.delete(id)) },
  }
}

// Without IndexedDB (some private-browsing modes) photos are still sent, but
// only kept for as long as the page stays open.
function createStore(): OutboxStore {
  try {
    if (typeof indexedDB !== 'undefined') return idbStore()
  } catch (err) {
    console.warn('[outbox] IndexedDB unavailable; photos are kept in memory only', err)
  }
  return memoryStore()
}

export const outbox = new Outbox(createStore(), firebaseBackend)
