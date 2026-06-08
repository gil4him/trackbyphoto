import { ref, uploadBytes, deleteObject } from 'firebase/storage'
import { deleteDoc, doc } from 'firebase/firestore'
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
 * Plausible synthetic Vision tags for browser testing. The native iOS app
 * is now the patient-facing path; the deployed web URL is a dev/preview
 * surface, so we let the browser exercise the template + "trust device
 * memo" code paths without an iPhone. Runs in both `npm run dev` and on
 * the deployed site — guarded only by `!isNative`.
 */
const DEV_FAKE_TAG_SCENARIOS: VisionTags[] = [
  // 식사
  { labels: [{ name: 'food', confidence: 0.92 }, { name: 'plate', confidence: 0.7 }], text: [], faceCount: 0 },
  // 산책
  { labels: [{ name: 'park', confidence: 0.85 }, { name: 'tree', confidence: 0.6 }, { name: 'outdoor', confidence: 0.55 }], text: [], faceCount: 0 },
  // 휴식
  { labels: [{ name: 'sofa', confidence: 0.8 }, { name: 'indoor', confidence: 0.7 }, { name: 'book', confidence: 0.4 }], text: [], faceCount: 0 },
  // 가족 (face count >=2)
  { labels: [{ name: 'outdoor', confidence: 0.65 }], text: [], faceCount: 3 },
  // OCR-bearing case (with food)
  { labels: [{ name: 'food', confidence: 0.8 }], text: ['한정식', '메뉴'], faceCount: 1 },
]

/**
 * Run Apple Vision on a captured photo. On native iOS calls the real
 * plugin; in a browser returns a randomly-picked synthetic VisionTags so
 * the template + on-device-memo flow can be visually exercised without an
 * iPhone. (The deployed web URL is a dev/preview surface, not the patient
 * path.) Returns null only when native Vision actually errors.
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
  if (!isNative) {
    const fake = DEV_FAKE_TAG_SCENARIOS[Math.floor(Math.random() * DEV_FAKE_TAG_SCENARIOS.length)]
    console.log('[web] simulated Vision tags', fake)
    return fake
  }
  return null
}

/**
 * Pick a coarse category from Vision tags. Mirrors the same heuristic the
 * Cloud Function uses for web uploads so both paths produce consistent
 * UI grouping. Defaults to 일상.
 */
function categoryFromTags(tags: VisionTags): string {
  const names = tags.labels.map((l) => l.name.toLowerCase()).join(' ')
  if (/food|meal|dish|plate|bowl|drink|beverage|cup|fruit|vegetable/.test(names)) return '식사'
  if (/park|tree|outdoor|street|walk|path|garden|trail|sky|grass/.test(names)) return '산책'
  if (/sofa|bed|chair|tv|television|book|tea|home interior|indoor/.test(names)) return '휴식'
  if (tags.faceCount >= 2) return '가족'
  return '일상'
}

/**
 * Tier-2 fallback: turn Vision tags into a Korean sentence via templates.
 * Runs on any iPhone (iOS 17+) when Foundation Models isn't available, so
 * older devices still write a real on-device memo instead of leaving the
 * Cloud Function to guess from scratch. Deterministic per photo — same tags
 * pick the same sentence on retry.
 */
const TEMPLATE_PHRASES: Record<string, string[]> = {
  식사: ['식사 중이에요', '식사 시간이에요'],
  산책: ['산책 중이에요', '바깥 공기를 쐬고 계세요'],
  휴식: ['편안히 쉬고 계세요', '여유로운 시간이에요'],
  가족: ['가족과 함께 계세요', '소중한 사람들과 함께'],
  일상: ['오늘의 한 장면', '잔잔한 일상의 순간'],
}
function templateMemo(tags: VisionTags): string {
  const cat = categoryFromTags(tags)
  const list = TEMPLATE_PHRASES[cat] || TEMPLATE_PHRASES['일상']
  // Seed from the tag identity so the same photo always picks the same line.
  const seed = tags.labels.map((l) => l.name).join('|').length + tags.faceCount
  return list[seed % list.length]
}

/**
 * Generate the activity memo, walking down the tier ladder:
 *   1. Apple Foundation Models (iPhone 15 Pro+ on iOS 26+) → warm LLM memo
 *   2. Korean sentence template from Vision tags → works on any iPhone
 *   3. (web / no tags) → empty string, Cloud Function handles it
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
  }
  // Foundation Models is iOS-only; on web (and on native when the LLM is
  // unavailable) we fall through to the Korean sentence template so the
  // memo still comes from the device side.
  return { memo: templateMemo(tags), source: 'template' }
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
  tags?: VisionTags | null
  /**
   * Optional on-device memo from Foundation Models (Layer 2). When present
   * the Cloud Function uses this string verbatim and skips its own template
   * generator. Pass empty/undefined to let the function pick a memo.
   */
  activity?: string | null
  /** Which tier produced the activity above. Persisted onto the memo doc. */
  memoSource?: 'foundation-models' | 'template' | 'cloud-stub' | null
}): Promise<{ path: string; photoId: string }> {
  const { uid, file, geo, takenAt, tags, activity, memoSource } = opts
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
      // Vision tags ride as a JSON string in customMetadata. The Cloud
      // Function parses this and stores it on the memo doc; the 8 KB
      // per-key metadata limit is plenty for our trimmed tag set.
      tags: tags ? JSON.stringify(tags) : '',
      // On-device memo (Foundation Models). Empty string means "function,
      // please generate one." The function never overwrites a non-empty
      // value here.
      activity: activity || '',
      // Which tier wrote the activity. The function persists this on the
      // memo doc so the detail page can render the right AI source badge.
      memoSource: memoSource || '',
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
