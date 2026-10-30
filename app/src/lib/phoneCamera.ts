// The phone's own camera (Capacitor Camera): open it, turn its answer into a
// File, and tell a closed camera from a refused one. Nothing else is imported
// here so the parent's screen logic can be tested without the native shell.

import { Camera, CameraDirection, CameraResultType, CameraSource, type ImageOptions, type Photo } from '@capacitor/camera'

/**
 * The parent's camera (owner decision, 2026-10-30): full native quality,
 * pixels redrawn upright (correctOrientation), a copy kept in the phone's
 * Photos like any camera shot. No width/height: the plugin would save the
 * resized image to Photos too; the upload is shrunk in shrinkPhoto.
 */
export const PARENT_CAMERA: ImageOptions = {
  source: CameraSource.Camera,
  resultType: CameraResultType.Uri,
  quality: 92,
  correctOrientation: true,
  saveToGallery: true,
  direction: CameraDirection.Rear,
}

/**
 * Open the phone's camera and return the photo as a File plus the local path
 * that Apple Vision can analyze. On the web the plugin falls back to an
 * <input type="file" capture>. The full edition's Home uses the defaults; the
 * parent's screen passes PARENT_CAMERA.
 */
export async function captureNativePhoto(opts: Partial<ImageOptions> = {}): Promise<{ file: File; path: string }> {
  const photo = await Camera.getPhoto({
    source: CameraSource.Camera,
    resultType: CameraResultType.Uri,
    quality: 85,
    // Also keep a copy in the Photos app like a normal camera shot. The first
    // save asks for Photos "add" permission (NSPhotoLibraryAddUsageDescription);
    // if it's declined the save is skipped and the upload still proceeds.
    saveToGallery: true,
    ...opts,
  })
  return photoFromResult(photo)
}

/** The plugin's answer (fresh, or restored after Android killed the app) as a File. */
export async function photoFromResult(photo: Photo): Promise<{ file: File; path: string }> {
  if (!photo.webPath) throw new Error('camera returned no path')
  const res = await fetch(photo.webPath)
  const blob = await res.blob()
  const ext = (photo.format || 'jpg').toLowerCase()
  const file = new File([blob], `photo.${ext}`, { type: blob.type || 'image/jpeg' })
  // Prefer the file:// path for Vision; webPath works as a fallback because
  // the Swift loader knows how to unwrap _capacitor_file_ URLs.
  return { file, path: photo.path || photo.webPath }
}

const said = (err: unknown) => String((err as { message?: unknown })?.message ?? err)
/** The parent closed the camera without a photo ("User cancelled photos app"). */
export const isCameraCancel = (err: unknown): boolean => /cancel/i.test(said(err))
/** The phone refused the camera ("User denied access to camera"). */
export const isCameraDenied = (err: unknown): boolean => /denied/i.test(said(err))
