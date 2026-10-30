import { ref, deleteObject } from 'firebase/storage'
import { collection, deleteDoc, doc, getDocs, query, where } from 'firebase/firestore'
import { Capacitor } from '@capacitor/core'
import { OnDeviceVision, type VisionTags } from 'on-device-vision'
import { db, storage } from '../firebase'
import { findFix, recentFix } from './location'
import { shrinkPhoto } from './image'
import { outbox } from './outboxBackend'

export type { VisionTags }

const isNative = Capacitor.isNativePlatform()

// The camera itself (open it, read its answer) lives in phoneCamera.ts;
// Home still imports it from here.
export { captureNativePhoto } from './phoneCamera'

/**
 * Run Apple Vision on a captured photo (native iOS only; null on web). The
 * tags ride along on the memo doc as a hint; the memo itself is always
 * written by the worker's vision model from the actual photo.
 */
export async function analyzePhotoTags(path: string | undefined): Promise<VisionTags | null> {
  if (isNative && path) {
    try {
      const result = await OnDeviceVision.analyze({ path })
      return result.tags
    } catch (err) {
      console.warn('[analyzePhotoTags] Vision failed', err)
      return null
    }
  }
  return null
}

/** True when the app is running inside the Capacitor iOS shell. */
export const isNativeApp = isNative

/**
 * Record a photo that was just taken. It is shrunk and put in the on-phone
 * outbox, which uploads it and creates memos/{photoId} as a 'pending' job for
 * the worker — straight away on a good connection, later on a bad one. The
 * location is attached as soon as the phone finds it, even after sending.
 * Returns once the photo is safely stored on the phone.
 */
export async function savePhoto(opts: { uid: string; file: File; nativePath?: string }): Promise<{ photoId: string }> {
  const { uid, file, nativePath } = opts
  const takenAt = new Date()
  const photoId = `${takenAt.getTime()}_${Math.random().toString(36).slice(2, 8)}`
  const here = recentFix()
  const [blob, tags] = await Promise.all([shrinkPhoto(file), analyzePhotoTags(nativePath)])
  const shrunk = blob !== file
  await outbox.enqueue({
    photoId,
    uid,
    blob,
    ext: shrunk ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase(),
    takenAtMs: takenAt.getTime(),
    lat: here?.lat ?? null,
    lng: here?.lng ?? null,
    tzOffsetMin: -takenAt.getTimezoneOffset(),
    tags,
  })
  if (!here) {
    void findFix()
      .then((geo) => (geo ? outbox.attachGeo(photoId, geo) : undefined))
      .catch((err) => console.warn('[capture] could not attach location', err))
  }
  return { photoId }
}

/**
 * Deletes a memo: removes the Firestore doc first (so it disappears from the
 * UI immediately) then the underlying Storage object. A missing Storage
 * object is treated as success since the doc is what the user sees. Reactions
 * on the memo are removed too.
 */
export async function deleteMemo(opts: { memoId: string; photoPath: string }) {
  await deleteDoc(doc(db, 'memos', opts.memoId))
  try {
    await deleteObject(ref(storage, opts.photoPath))
  } catch (err) {
    // Already gone or never uploaded — don't surface this to the user.
    console.warn('[deleteMemo] storage object delete failed', err)
  }
  // Hearts, comments and voice replies on the photo go with it. Best effort:
  // a voice clip can only be removed from Storage by the parent's own account.
  try {
    const patientUid = opts.photoPath.split('/')[1]
    const left = await getDocs(query(collection(db, 'reactions'), where('patientUid', '==', patientUid), where('memoId', '==', opts.memoId)))
    await Promise.all(left.docs.map(async (d) => {
      const audioPath = d.data().audioPath as string | undefined
      await deleteDoc(d.ref)
      if (audioPath) await deleteObject(ref(storage, audioPath)).catch(() => {})
    }))
  } catch (err) {
    console.warn('[deleteMemo] reactions not removed', err)
  }
}
