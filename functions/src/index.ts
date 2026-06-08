/**
 * Cloud Function: onPhotoUploaded
 *
 * Storage trigger that runs when a patient's photo lands at
 *   photos/{uid}/{photoId}.{ext}
 *
 * It reads custom metadata (uid, photoId, takenAt, lat, lng) attached by the
 * client, generates an activity description + a place name, and writes a memo
 * doc to Firestore at memos/{photoId}. The client is subscribed to that
 * collection and renders the memo live.
 *
 * Phase 1 ships with STUBBED AI + reverse geocoding so the end-to-end pipeline
 * works without external API keys. Swap the two stub functions below for
 * Gemini Vision + Kakao Local in Phase 2.
 */

import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { onObjectFinalized } from 'firebase-functions/v2/storage'
import { logger } from 'firebase-functions/v2'

initializeApp()

// Must match the default Storage bucket's region (created via Firebase console).
// Storage bucket is in us-west1, so function must trigger there too.
const REGION = 'us-west1'

// ────────────────────────────────────────────────────────────────────────────
// STUB: AI activity generator. Replace with Gemini Vision call.
//
// Example (Gemini 2.0 Flash via @google/generative-ai):
//   const model = new GoogleGenerativeAI(process.env.GEMINI_KEY!).getGenerativeModel(...)
//   const result = await model.generateContent([{ inlineData: { data: base64, mimeType }}, prompt])
//   return parseResult(result)
// ────────────────────────────────────────────────────────────────────────────
const ACTIVITIES: { cat: string; lines: string[] }[] = [
  { cat: '식사', lines: ['점심 식사 중이에요', '맛있는 한 끼를 드시고 계세요', '따뜻한 식사 시간이에요'] },
  { cat: '산책', lines: ['햇살 좋은 산책 중이에요', '동네를 천천히 걷고 계세요', '산책길에서 한 컷'] },
  { cat: '휴식', lines: ['편안한 휴식 시간이에요', '잠깐 쉬어가는 중이에요', '차 한 잔과 함께 여유로운 시간'] },
  { cat: '가족', lines: ['가족과 함께한 시간이에요', '사랑하는 사람과 함께', '오랜만에 만난 가족'] },
  { cat: '일상', lines: ['오늘의 한 장면', '소중한 일상의 순간', '잔잔하고 평온한 시간'] },
]
function generateActivity(_args: { bucket: string; objectPath: string; contentType?: string }):
  Promise<{ activity: string; category: string }> {
  const a = ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)]
  const line = a.lines[Math.floor(Math.random() * a.lines.length)]
  return Promise.resolve({ activity: line, category: a.cat })
}

/**
 * Pick a coarse category from Vision tags when the device wrote the memo.
 * The model's free-form Korean sentence isn't easy to bucket post-hoc, but
 * the underlying VNClassifyImageRequest labels (English ImageNet-ish names)
 * map cleanly enough. Defaults to 일상.
 */
function categoryFromTags(
  tags: { labels: { name: string; confidence: number }[]; text: string[]; faceCount: number } | null,
): string {
  if (!tags) return '일상'
  const names = tags.labels.map((l) => l.name.toLowerCase()).join(' ')
  if (/food|meal|dish|plate|bowl|drink|beverage|cup|fruit|vegetable/.test(names)) return '식사'
  if (/park|tree|outdoor|street|walk|path|garden|trail|sky|grass/.test(names)) return '산책'
  if (/sofa|bed|chair|tv|television|book|cup|tea|home interior|indoor/.test(names)) return '휴식'
  if (tags.faceCount >= 2) return '가족'
  return '일상'
}

// STUB: reverse geocode. Replace with Kakao Local API call.
const PLACES = ['자택 거실', '동네 공원', '한강공원', '행복요양센터', '근처 카페', '병원 근처', '마트 입구']
function reverseGeocode(lat: number | null, lng: number | null): Promise<string> {
  if (lat == null || lng == null) {
    return Promise.resolve(PLACES[Math.floor(Math.random() * PLACES.length)])
  }
  const i = Math.abs(Math.round((lat + lng) * 1000)) % PLACES.length
  return Promise.resolve(PLACES[i])
}

// ────────────────────────────────────────────────────────────────────────────

export const onPhotoUploaded = onObjectFinalized(
  { region: REGION, memory: '256MiB' },
  async (event) => {
    const obj = event.data
    const path = obj.name || ''
    if (!path.startsWith('photos/')) {
      logger.info('skip non-photo upload', { path })
      return
    }

    const meta = obj.metadata || {}
    const uid     = meta.uid as string | undefined
    const photoId = meta.photoId as string | undefined
    const takenAtIso = (meta.takenAt as string) || ''
    const lat = meta.lat ? Number(meta.lat) : null
    const lng = meta.lng ? Number(meta.lng) : null
    // On-device memo from Apple Foundation Models (Layer 2). Empty string
    // means the device couldn't produce one (web client, older iPhone, or
    // Apple Intelligence off) and we should fall back to the stub generator.
    const deviceActivity = ((meta.activity as string) || '').trim()

    if (!uid || !photoId) {
      logger.error('missing metadata', { path, meta })
      return
    }

    // On-device Apple Vision tags (Layer 1). Native iOS clients attach this;
    // web clients leave it empty. Parsing is best-effort — bad JSON shouldn't
    // block memo creation.
    let tags: { labels: { name: string; confidence: number }[]; text: string[]; faceCount: number } | null = null
    const tagsRaw = (meta.tags as string | undefined) || ''
    if (tagsRaw) {
      try {
        tags = JSON.parse(tagsRaw)
      } catch (err) {
        logger.warn('could not parse vision tags', { err, tagsRaw })
      }
    }

    const db = getFirestore()
    const bucket = getStorage().bucket(obj.bucket)
    const file = bucket.file(path)

    // Write a pending placeholder so the client can show "메모 작성 중…" immediately.
    // photoUrl is filled in once we resolve the download token below.
    const memoRef = db.collection('memos').doc(photoId)
    await memoRef.set({
      uid,
      photoPath: path,
      photoUrl: '',
      takenAt: takenAtIso ? Timestamp.fromDate(new Date(takenAtIso)) : Timestamp.now(),
      lat, lng,
      place: '',
      activity: '',
      category: '일상',
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      ...(tags ? { tags } : {}),
    })

    try {
      // The browser fetches the photo via a plain <img src> with no auth header,
      // so Storage rules would 403 it. The Firebase-style download URL bypasses
      // rules when a `token` query param matches a token in the object's
      // metadata. The Web SDK's uploadBytes auto-generates one; reuse it (or
      // mint a new one if missing).
      const [storageMeta] = await file.getMetadata()
      const existingTokens = (storageMeta.metadata as Record<string, string> | undefined)?.firebaseStorageDownloadTokens
      let token = existingTokens?.split(',')[0]
      if (!token) {
        token = crypto.randomUUID()
        await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } })
      }
      const photoUrl = `https://firebasestorage.googleapis.com/v0/b/${obj.bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`

      // If the device already wrote a memo via Foundation Models, trust it
      // verbatim — the whole point of Layer 2 is to keep interpretation
      // on-device. We still pick a category from the (also on-device)
      // Vision tags so the UI can color/group consistently.
      const [generated, place] = await Promise.all([
        deviceActivity
          ? Promise.resolve({ activity: deviceActivity, category: categoryFromTags(tags) })
          : generateActivity({ bucket: obj.bucket, objectPath: path, contentType: obj.contentType }),
        reverseGeocode(lat, lng),
      ])
      const { activity, category } = generated
      const source: 'on-device' | 'cloud-stub' = deviceActivity ? 'on-device' : 'cloud-stub'

      await memoRef.update({
        photoUrl,
        place,
        activity,
        category,
        status: 'ready',
      })
      logger.info('memo ready', { uid, photoId, category, source })
    } catch (err) {
      logger.error('memo generation failed', { err })
      await memoRef.update({ status: 'error' })
    }
  },
)
