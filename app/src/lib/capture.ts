import { ref, uploadBytes, deleteObject } from 'firebase/storage'
import { deleteDoc, doc } from 'firebase/firestore'
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Geolocation } from '@capacitor/geolocation'
import { db, storage } from '../firebase'

export interface Geo { lat: number; lng: number }

const isNative = Capacitor.isNativePlatform()

/**
 * Get GPS coordinates. Uses Capacitor's native plugin on iOS (better accuracy
 * and a real permission prompt), falls back to the browser Geolocation API in
 * the web view. Returns null on denial / unavailable.
 */
export async function getGeo(): Promise<Geo | null> {
  if (isNative) {
    try {
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 })
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
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 },
    )
  })
}

/**
 * Open the native iOS camera (via Capacitor) and return the captured photo as
 * a File ready for upload. Only call this on a native platform — on web we
 * still use the <input type="file" capture> approach from Home.tsx.
 */
export async function captureNativePhoto(): Promise<File> {
  const photo = await Camera.getPhoto({
    source: CameraSource.Camera,
    resultType: CameraResultType.Uri,
    quality: 85,
    saveToGallery: false,
  })
  if (!photo.webPath) throw new Error('camera returned no path')
  const res = await fetch(photo.webPath)
  const blob = await res.blob()
  const ext = (photo.format || 'jpg').toLowerCase()
  return new File([blob], `photo.${ext}`, { type: blob.type || 'image/jpeg' })
}

/** True when the app is running inside the Capacitor iOS shell. */
export const isNativeApp = isNative

/**
 * Uploads a photo to Cloud Storage with geo + timestamp as custom metadata.
 * The Cloud Function `onPhotoUploaded` reads that metadata, runs AI + reverse
 * geocoding, and writes a Firestore memo doc which the client then sees live.
 */
export async function uploadPhoto(opts: {
  uid: string
  file: File
  geo: Geo | null
  takenAt: Date
}): Promise<{ path: string; photoId: string }> {
  const { uid, file, geo, takenAt } = opts
  const photoId = `${takenAt.getTime()}_${Math.random().toString(36).slice(2, 8)}`
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `photos/${uid}/${photoId}.${ext}`

  await uploadBytes(ref(storage, path), file, {
    contentType: file.type || 'image/jpeg',
    customMetadata: {
      uid,
      photoId,
      takenAt: takenAt.toISOString(),
      lat: geo ? String(geo.lat) : '',
      lng: geo ? String(geo.lng) : '',
    },
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
