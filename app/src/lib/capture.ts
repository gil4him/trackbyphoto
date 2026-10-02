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
 * a File plus the local path that Apple Vision can analyze. Only call this on
 * a native platform — on web we still use the <input type="file" capture>
 * approach from Home.tsx.
 */
export async function captureNativePhoto(): Promise<{ file: File; path: string }> {
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
  const file = new File([blob], `photo.${ext}`, { type: blob.type || 'image/jpeg' })
  // Prefer the file:// path for Vision; webPath works as a fallback because
  // the Swift loader knows how to unwrap _capacitor_file_ URLs.
  return { file, path: photo.path || photo.webPath }
}

/**
 * Run Apple Vision on a captured photo. On native iOS calls the real
 * plugin. On web we return null so the upload skips the on-device tier
 * and lets the Mac mini worker's local vision model generate the memo
 * from the actual photo bytes — real AI on the deployed URL, not synthetic
 * tags.
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

/**
 * Pick a coarse activity category from Vision tags. Mirrors the same
 * heuristic the Mac mini worker uses for web uploads so both paths produce
 * consistent UI grouping. Defaults to 기타.
 */
function categoryFromTags(tags: VisionTags): string {
  const names = tags.labels.map((l) => l.name.toLowerCase()).join(' ')
  if (/food|meal|dish|plate|bowl|drink|beverage|cup|fruit|vegetable/.test(names)) return '식사'
  if (/park|tree|outdoor|street|walk|path|garden|trail|sky|grass/.test(names)) return '산책'
  if (/flower|blossom|petal|bouquet|rose|tulip/.test(names)) return '꽃'
  if (/sofa|bed|chair|tv|television|book|tea|home interior|indoor/.test(names)) return '휴식'
  if (tags.faceCount >= 2) return '가족'
  return '기타'
}

/**
 * Tier-2 fallback: turn Vision tags into a warm Korean sentence via templates.
 * Runs on any iPhone (iOS 17+) when Foundation Models isn't available, so
 * older devices still write a real on-device memo instead of leaving the
 * worker to guess from scratch. Deterministic per photo — same tags
 * pick the same sentence on retry. Phrases mirror the warm-caption tone the
 * Foundation-Models prompt asks for.
 */
const TEMPLATE_PHRASES: Record<string, string[]> = {
  식사: ['맛있는 식사를 하고 계세요.', '식사 시간이에요.'],
  산책: ['공원에서 산책 중이세요.', '바깥 공기를 쐬고 계세요.'],
  휴식: ['거실에서 편안히 쉬고 계세요.', '여유로운 시간을 보내고 계세요.'],
  가족: ['가족과 즐거운 시간을 보내고 계세요.', '함께하는 시간이에요.'],
  꽃: ['예쁜 꽃을 보고 계세요.'],
  기타: ['오늘의 한 순간을 담았어요.'],
}
function templateMemo(tags: VisionTags): string {
  const cat = categoryFromTags(tags)
  const list = TEMPLATE_PHRASES[cat] || TEMPLATE_PHRASES['기타']
  // Seed from the tag identity so the same photo always picks the same line.
  const seed = tags.labels.map((l) => l.name).join('|').length + tags.faceCount
  return list[seed % list.length]
}

/**
 * Generate the activity memo on the device. Walks down the on-device ladder:
 *   1. Apple Foundation Models (iPhone 15 Pro+ on iOS 26+) → warm LLM memo
 *   2. Korean sentence template from Vision tags → works on any iPhone
 *   3. (web / no tags / both failed) → empty string; the Mac mini worker
 *      runs its local vision model on the photo bytes itself.
 * Returns the memo + which tier produced it (caller can log this).
 */
export async function generateActivityMemo(
  tags: VisionTags | null,
  hints?: { timeHint?: string; placeHint?: string },
): Promise<{ memo: string; source: 'foundation-models' | 'template' | 'none' }> {
  if (!tags) return { memo: '', source: 'none' }
  if (isNative) {
    try {
      const result = await OnDeviceVision.generateMemo({
        tags,
        timeHint: hints?.timeHint,
        placeHint: hints?.placeHint,
      })
      if (result.memo) return { memo: result.memo, source: 'foundation-models' }
    } catch (err) {
      console.warn('[generateActivityMemo] Foundation Models failed', err)
    }
    // Foundation Models unavailable but we have real Vision tags — write a
    // templated sentence so the device still ships a memo, even when offline.
    return { memo: templateMemo(tags), source: 'template' }
  }
  // Web path: no on-device memo; let the Mac mini worker's local model
  // produce the real AI memo from the photo bytes.
  return { memo: '', source: 'none' }
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
  /**
   * Optional on-device memo sentence from Foundation Models (Layer 2). When
   * present the worker uses this string verbatim and skips its own
   * local-LLM call. Pass empty/undefined to let the worker write one.
   */
  memo?: string | null
  /** Which tier produced the memo above. Persisted onto the memo doc. */
  memoSource?: 'foundation-models' | 'template' | null
}): Promise<{ path: string; photoId: string }> {
  const { uid, file, geo, takenAt, tags, memo, memoSource } = opts
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
    // On-device memo + tier. Empty means "worker, please write one."
    deviceMemo: memo || '',
    deviceMemoSource: memoSource || '',
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
