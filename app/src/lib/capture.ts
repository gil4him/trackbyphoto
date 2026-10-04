import { ref, deleteObject } from 'firebase/storage'
import { deleteDoc, doc } from 'firebase/firestore'
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { OnDeviceVision, type VisionTags } from 'on-device-vision'
import { db, storage } from '../firebase'
import { findFix, recentFix } from './location'
import { shrinkPhoto } from './image'
import { outbox } from './outboxBackend'

export type { VisionTags }

const isNative = Capacitor.isNativePlatform()

/**
 * Open the native iOS camera (via Capacitor) and return the captured photo as
 * a File plus the local path that Apple Vision can analyze. Only call this on
 * a native platform — on web we still use the <input type="file" capture>
 * approach from Home.tsx.
 */
export async function captureNativePhoto(): Promise<{ file: File; path: string }> {
  const photo = await Camera.getPhoto({
    source: CameraSource.Camera,
    resultType: CameraResultType.Uri,
    quality: 85,
    // Also keep a copy in the Photos app like a normal camera shot. The first
    // save asks for Photos "add" permission (NSPhotoLibraryAddUsageDescription);
    // if it's declined the save is skipped and the upload still proceeds.
    saveToGallery: true,
  })
  if (!photo.webPath) throw new Error('camera returned no path')
  const res = await fetch(photo.webPath)
  const blob = await res.blob()
  const ext = (photo.format || 'jpg').toLowerCase()
  const file = new File([blob], `photo.${ext}`, { type: blob.type || 'image/jpeg' })
  // Prefer the file:// path for Vision; webPath works as a fallback because
  // the Swift loader knows how to unwrap _capacitor_file_ URLs.
  return { file, path: photo.path || photo.webPath }
}

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
 * object is treated as success since the doc is what the user sees.
 */
export async function deleteMemo(opts: { memoId: string; photoPath: string }) {
  await deleteDoc(doc(db, 'memos', opts.memoId))
  try {
    await deleteObject(ref(storage, opts.photoPath))
  } catch (err) {
    // Already gone or never uploaded — don't surface this to the user.
    console.warn('[deleteMemo] storage object delete failed', err)
  }
}
