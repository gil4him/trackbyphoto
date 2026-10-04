import { ref, uploadBytes, deleteObject } from 'firebase/storage'
import { deleteDoc, doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore'
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Geolocation } from '@capacitor/geolocation'
import { OnDeviceVision, type VisionTags } from 'on-device-vision'
import { db, storage } from '../firebase'

export interface Geo { lat: number; lng: number }
export type { VisionTags }

const isNative = Capacitor.isNativePlatform()

/**
 * Get GPS coordinates. Uses Capacitor's native plugin on iOS (better accuracy
 * and a real permission prompt), falls back to the browser Geolocation API in
 * the web view. Asks for a fresh high-accuracy (GPS) fix so the place label
 * names the actual building, not the surrounding cell-tower area. Returns
 * null on denial / unavailable.
 */
export async function getGeo(): Promise<Geo | null> {
  if (isNative) {
    try {
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 })
      return { lat: pos.coords.latitude, lng: pos.coords.longitude }
    } catch {
      return null
    }
  }
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 },
    )
  })
}

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
 * Uploads a photo to Cloud Storage, then creates memos/{photoId} as a
 * 'pending' job. The Mac mini worker picks it up, runs AI + reverse
 * geocoding, and fills in the memo, which the client then sees live.
 * The doc is created only after the upload finishes so the worker never
 * looks for a photo that isn't there yet.
 */
export async function uploadPhoto(opts: {
  uid: string
  file: File
  geo: Geo | null
  takenAt: Date
  tags?: VisionTags | null
}): Promise<{ path: string; photoId: string }> {
  const { uid, file, geo, takenAt, tags } = opts
  const photoId = `${takenAt.getTime()}_${Math.random().toString(36).slice(2, 8)}`
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `photos/${uid}/${photoId}.${ext}`

  await uploadBytes(ref(storage, path), file, {
    contentType: file.type || 'image/jpeg',
    // Kept on the object for forensics; the worker reads the memo doc below.
    customMetadata: {
      uid,
      photoId,
      takenAt: takenAt.toISOString(),
      lat: geo ? String(geo.lat) : '',
      lng: geo ? String(geo.lng) : '',
    },
  })

  // Placeholder the UI renders as "메모 작성 중…" until the worker fills it.
  // Shape is enforced by the memos create rule in firestore.rules.
  await setDoc(doc(db, 'memos', photoId), {
    // `patientUid` (not `uid`) is the schema field per the caregiver-share
    // plan. For self-managed accounts the uploader IS the patient.
    patientUid: uid,
    photoPath: path,
    photoUrl: '',
    takenAt: Timestamp.fromDate(takenAt),
    lat: geo ? geo.lat : null,
    lng: geo ? geo.lng : null,
    place: '',
    activity: '기타',
    memo: '',
    scene: '',
    status: 'pending',
    createdAt: serverTimestamp(),
    ...(tags ? { tags } : {}),
  })

  return { path, photoId }
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
