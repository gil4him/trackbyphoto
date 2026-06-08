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
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions/v2'
import { GoogleGenerativeAI } from '@google/generative-ai'

initializeApp()

// Must match the default Storage bucket's region (created via Firebase console).
// Storage bucket is in us-west1, so function must trigger there too.
const REGION = 'us-west1'

// Gemini API key, configured via:
//   firebase functions:secrets:set GEMINI_API_KEY
// (Get a key at https://aistudio.google.com/apikey.) When unset, the function
// gracefully falls back to the stub generator so the pipeline keeps working
// without external setup.
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY')

// ────────────────────────────────────────────────────────────────────────────
// Cloud Vision LLM tier — Gemini 2.0 Flash.
//
// Runs when the device couldn't produce a memo (web upload, older iPhone, or
// Apple Intelligence off). Downloads the photo bytes from Storage and sends
// them to Gemini Flash with a Korean prompt + time/place context. Parses a
// single short Korean sentence + a category. Falls back to the deterministic
// stub below when the API call fails (network, parse error, missing key).
// ────────────────────────────────────────────────────────────────────────────

const VALID_CATEGORIES = ['식사', '산책', '휴식', '가족', '일상'] as const

async function generateActivityWithGemini(args: {
  bucket: string
  objectPath: string
  contentType?: string
  timeHint?: string
  placeHint?: string
}): Promise<{ activity: string; category: string } | null> {
  const apiKey = GEMINI_API_KEY.value()
  if (!apiKey) {
    logger.warn('[gemini] GEMINI_API_KEY unset; skipping cloud Vision tier')
    return null
  }

  try {
    // Pull the photo bytes via the Admin SDK (bypasses Storage rules).
    const bucket = getStorage().bucket(args.bucket)
    const file = bucket.file(args.objectPath)
    const [buffer] = await file.download()
    const mimeType = args.contentType || 'image/jpeg'
    const base64 = buffer.toString('base64')

    const ai = new GoogleGenerativeAI(apiKey)
    const model = ai.getGenerativeModel({
      model: 'gemini-2.0-flash',
      // Tighten determinism a bit — we want consistent short outputs, not
      // creative variation.
      generationConfig: { temperature: 0.4, maxOutputTokens: 200, responseMimeType: 'application/json' },
    })

    const prompt = [
      '당신은 인지 저하가 있는 어르신의 사진을 보고 가족에게 보낼 짧고 따뜻한 한국어 메모를 작성합니다.',
      '',
      '규칙:',
      '- 한국어 한 문장만, 15자 내외 (최대 25자).',
      '- 존댓말 사용 (예: "드시고 계세요", "산책하셨어요").',
      '- 사진에서 확실히 보이는 것만 표현하세요. 추측은 피하세요.',
      '- 카테고리는 다음 중 정확히 하나: 식사 / 산책 / 휴식 / 가족 / 일상.',
      '',
      '상황 정보 (참고용, 사진과 어긋나면 무시):',
      `- 시간: ${args.timeHint || '알 수 없음'}`,
      `- 장소: ${args.placeHint || '알 수 없음'}`,
      '',
      'JSON으로만 답하세요:',
      '{"activity": "...", "category": "..."}',
    ].join('\n')

    const result = await model.generateContent([
      { inlineData: { data: base64, mimeType } },
      { text: prompt },
    ])
    const raw = (result.response.text() || '').trim()
    // Model occasionally wraps JSON in a code fence even with the mime hint.
    const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
    const parsed = JSON.parse(cleaned) as { activity?: unknown; category?: unknown }

    const activity = typeof parsed.activity === 'string' ? parsed.activity.trim() : ''
    const categoryRaw = typeof parsed.category === 'string' ? parsed.category.trim() : ''
    if (!activity) {
      logger.warn('[gemini] empty activity in response', { raw })
      return null
    }
    const category = (VALID_CATEGORIES as readonly string[]).includes(categoryRaw)
      ? categoryRaw
      : '일상'
    return { activity, category }
  } catch (err) {
    logger.warn('[gemini] generation failed', { err: String(err) })
    return null
  }
}

// Final-fallback stub used when Gemini is unreachable or unconfigured.
const STUB_ACTIVITIES: { cat: string; lines: string[] }[] = [
  { cat: '식사', lines: ['점심 식사 중이에요', '맛있는 한 끼를 드시고 계세요', '따뜻한 식사 시간이에요'] },
  { cat: '산책', lines: ['햇살 좋은 산책 중이에요', '동네를 천천히 걷고 계세요', '산책길에서 한 컷'] },
  { cat: '휴식', lines: ['편안한 휴식 시간이에요', '잠깐 쉬어가는 중이에요', '차 한 잔과 함께 여유로운 시간'] },
  { cat: '가족', lines: ['가족과 함께한 시간이에요', '사랑하는 사람과 함께', '오랜만에 만난 가족'] },
  { cat: '일상', lines: ['오늘의 한 장면', '소중한 일상의 순간', '잔잔하고 평온한 시간'] },
]
function stubActivity(): { activity: string; category: string } {
  const a = STUB_ACTIVITIES[Math.floor(Math.random() * STUB_ACTIVITIES.length)]
  return { activity: a.lines[Math.floor(Math.random() * a.lines.length)], category: a.cat }
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

// Reverse geocoding via Kakao Local API.
//
// Set the key at deploy time by creating `functions/.env.trackbyphoto-app`:
//   KAKAO_REST_KEY=<your kakao rest api key>
// (`.env.{projectId}` is the Firebase v2 convention; the file is gitignored.)
//
// When the key is missing or the API call fails, we fall back to a small
// deterministic stub so the function keeps working without external setup.
const STUB_PLACES = ['자택 거실', '동네 공원', '한강공원', '행복요양센터', '근처 카페', '병원 근처', '마트 입구']
function stubPlace(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) {
    return STUB_PLACES[Math.floor(Math.random() * STUB_PLACES.length)]
  }
  const i = Math.abs(Math.round((lat + lng) * 1000)) % STUB_PLACES.length
  return STUB_PLACES[i]
}

interface KakaoCoord2AddressDoc {
  address?: { region_3depth_name?: string; address_name?: string }
  road_address?: { address_name?: string; building_name?: string }
}
interface KakaoCoord2AddressResponse {
  documents?: KakaoCoord2AddressDoc[]
}

async function reverseGeocode(lat: number | null, lng: number | null): Promise<string> {
  if (lat == null || lng == null) return stubPlace(null, null)

  const apiKey = process.env.KAKAO_REST_KEY || ''
  if (!apiKey) return stubPlace(lat, lng)

  try {
    const url = `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lng}&y=${lat}`
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${apiKey}` } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as KakaoCoord2AddressResponse
    const doc = data.documents?.[0]
    if (!doc) throw new Error('no documents')

    // Prefer the building name when present (e.g., "성모병원") — most
    // recognizable to family. Otherwise fall through to the dong/eup/myeon
    // name ("역삼동") which is short and matches Korean conversational style.
    // Last resort is the road address.
    const building = doc.road_address?.building_name?.trim()
    if (building) return building
    const dong = doc.address?.region_3depth_name?.trim()
    if (dong) return dong
    const road = doc.road_address?.address_name?.trim()
    if (road) return road
    throw new Error('no usable address fields')
  } catch (err) {
    logger.warn('reverseGeocode: Kakao API failed, using stub', { err: String(err), lat, lng })
    return stubPlace(lat, lng)
  }
}

// ────────────────────────────────────────────────────────────────────────────

export const onPhotoUploaded = onObjectFinalized(
  {
    region: REGION,
    // Gemini call buffers the image + serialized base64 in memory; 512MiB
    // covers typical iPhone JPEGs comfortably.
    memory: '512MiB',
    timeoutSeconds: 90,
    secrets: [GEMINI_API_KEY],
  },
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
    // The tier that produced deviceActivity on the device. Persisted onto the
    // memo doc so the detail page can render the right source badge.
    const deviceMemoSource = ((meta.memoSource as string) || '').trim()

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
    //
    // On retrigger (rare — same Storage path finalizing twice), respect any
    // guardian edit already in place: don't clobber humanEdited memos.
    const memoRef = db.collection('memos').doc(photoId)
    const existing = await memoRef.get()
    const existingHumanEdited = existing.exists && existing.data()?.humanEdited === true
    if (!existingHumanEdited) {
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
    }

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

      // Resolve the place first so we can pass it as a hint to Gemini.
      const place = await reverseGeocode(lat, lng)
      const usingRealPlace = !!process.env.KAKAO_REST_KEY

      // Pick the activity tier:
      //   1. Device memo (Apple Foundation Models / template) — trust verbatim.
      //   2. Gemini 2.0 Flash Vision on the photo itself.
      //   3. Deterministic stub (Gemini unreachable / unconfigured).
      let activity: string
      let category: string
      let memoSource: string
      if (deviceActivity) {
        activity = deviceActivity
        category = categoryFromTags(tags)
        memoSource = deviceMemoSource || 'foundation-models'
      } else {
        const timeHint = takenAtIso ? new Date(takenAtIso).toTimeString().slice(0, 5) : undefined
        const cloud = await generateActivityWithGemini({
          bucket: obj.bucket,
          objectPath: path,
          contentType: obj.contentType,
          timeHint,
          // Only pass place when it's a real geocode — feeding stub names
          // ("자택 거실") into the prompt would just mislead the model.
          placeHint: usingRealPlace ? place : undefined,
        })
        if (cloud) {
          activity = cloud.activity
          category = cloud.category
          memoSource = 'cloud-vision'
        } else {
          const stub = stubActivity()
          activity = stub.activity
          category = stub.category
          memoSource = 'cloud-stub'
        }
      }

      // Skip activity/category/memoSource when a guardian has already corrected
      // the memo. photoUrl + place are still safe to refresh (they're factual,
      // not interpretation).
      const update: Record<string, unknown> = { photoUrl, place, status: 'ready' }
      if (!existingHumanEdited) {
        update.activity = activity
        update.category = category
        update.memoSource = memoSource
      }
      await memoRef.update(update)
      logger.info('memo ready', {
        uid, photoId, category, memoSource,
        preservedHumanEdit: existingHumanEdited,
      })
    } catch (err) {
      logger.error('memo generation failed', { err })
      await memoRef.update({ status: 'error' })
    }
  },
)
