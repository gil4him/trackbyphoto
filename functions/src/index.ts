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

interface GeminiResult {
  activity: string
  details: string
  category: string
  /** Token counts + USD estimate, included so the trigger can roll up
   *  spending into admin_daily / admin_totals for the dashboard. */
  cost: { promptTokens: number; outputTokens: number; totalUSD: number }
}

async function generateActivityWithGemini(args: {
  bucket: string
  objectPath: string
  contentType?: string
  timeHint?: string
  placeHint?: string
}): Promise<GeminiResult | null> {
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
      // Slightly more headroom now that we also produce the longer `details`
      // field. Still kept low so the output is consistent across retries.
      generationConfig: { temperature: 0.4, maxOutputTokens: 400, responseMimeType: 'application/json' },
    })

    const prompt = [
      '당신은 인지 저하가 있는 어르신의 사진을 보고 가족에게 보낼 따뜻한 한국어 메모를 작성합니다.',
      '',
      '두 가지를 작성하세요:',
      '1) activity — 한 문장 헤드라인. 15자 내외 (최대 25자). 존댓말. 예: "식사 중이세요", "공원에서 산책하셨어요".',
      '2) details — 2~3문장의 부드러운 설명, 총 80자 내외 (최대 140자). 사진에서 보이는 사람·물건·주변·분위기·시간대를 구체적으로. 추측 금지, 보이는 것만. 존댓말.',
      '',
      '카테고리는 정확히 하나: 식사 / 산책 / 휴식 / 가족 / 일상.',
      '',
      '상황 정보 (참고용, 사진과 어긋나면 무시):',
      `- 시간: ${args.timeHint || '알 수 없음'}`,
      `- 장소: ${args.placeHint || '알 수 없음'}`,
      '',
      'JSON으로만 답하세요:',
      '{"activity": "...", "details": "...", "category": "..."}',
    ].join('\n')

    const result = await model.generateContent([
      { inlineData: { data: base64, mimeType } },
      { text: prompt },
    ])
    const raw = (result.response.text() || '').trim()
    // Model occasionally wraps JSON in a code fence even with the mime hint.
    const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
    const parsed = JSON.parse(cleaned) as { activity?: unknown; details?: unknown; category?: unknown }

    // Gemini 2.0 Flash pricing for ≤128k context (as of 2025-02):
    //   input  $0.10 / 1M tokens
    //   output $0.40 / 1M tokens
    // Photo tokens are folded into promptTokenCount by the model. We log a
    // per-call line tagged "gemini-cost" AND return the numbers so the
    // trigger can roll them up into admin_daily / admin_totals for the
    // /superadmin dashboard.
    const usage = result.response.usageMetadata
    const inTok = usage?.promptTokenCount ?? 0
    const outTok = usage?.candidatesTokenCount ?? 0
    const inUSD = (inTok / 1_000_000) * 0.10
    const outUSD = (outTok / 1_000_000) * 0.40
    const totalUSD = inUSD + outUSD
    if (usage) {
      logger.info('[gemini-cost] usage', {
        tag: 'gemini-cost',
        model: 'gemini-2.0-flash',
        promptTokens: inTok,
        outputTokens: outTok,
        totalTokens: usage.totalTokenCount ?? inTok + outTok,
        inputUSD: Number(inUSD.toFixed(6)),
        outputUSD: Number(outUSD.toFixed(6)),
        totalUSD: Number(totalUSD.toFixed(6)),
      })
    } else {
      logger.warn('[gemini-cost] usageMetadata missing — cannot estimate cost')
    }

    const activity = typeof parsed.activity === 'string' ? parsed.activity.trim() : ''
    const details = typeof parsed.details === 'string' ? parsed.details.trim() : ''
    const categoryRaw = typeof parsed.category === 'string' ? parsed.category.trim() : ''
    if (!activity) {
      logger.warn('[gemini] empty activity in response', { raw })
      return null
    }
    const category = (VALID_CATEGORIES as readonly string[]).includes(categoryRaw)
      ? categoryRaw
      : '일상'
    return {
      activity, details, category,
      cost: { promptTokens: inTok, outputTokens: outTok, totalUSD },
    }
  } catch (err) {
    logger.warn('[gemini] generation failed', { err: String(err) })
    return null
  }
}

// Final-fallback stub used when Gemini is unreachable or unconfigured.
const STUB_ACTIVITIES: { cat: string; lines: string[]; details: string[] }[] = [
  {
    cat: '식사',
    lines: ['점심 식사 중이세요', '맛있는 한 끼를 드시고 계세요', '따뜻한 식사 시간이에요'],
    details: ['음식이 놓인 식탁 앞에 앉아 식사를 즐기고 계세요. 잘 드시고 계신 모습이에요.'],
  },
  {
    cat: '산책',
    lines: ['햇살 좋은 산책 중이세요', '동네를 천천히 걷고 계세요', '산책길에서 한 컷'],
    details: ['바깥 공기를 쐬며 걸으시는 중이에요. 주변이 평화로워 보여요.'],
  },
  {
    cat: '휴식',
    lines: ['편안한 휴식 시간이에요', '잠깐 쉬어가는 중이세요', '차 한 잔과 함께 여유로운 시간'],
    details: ['편안하게 자리에 앉아 쉬고 계세요. 여유로운 분위기예요.'],
  },
  {
    cat: '가족',
    lines: ['가족과 함께한 시간이에요', '사랑하는 사람과 함께', '오랜만에 만난 가족'],
    details: ['소중한 사람들과 함께 시간을 보내고 계세요. 표정이 밝아 보여요.'],
  },
  {
    cat: '일상',
    lines: ['오늘의 한 장면', '소중한 일상의 순간', '잔잔하고 평온한 시간'],
    details: ['평범하지만 소중한 일상의 한 장면이에요.'],
  },
]
function stubActivity(): { activity: string; details: string; category: string } {
  const a = STUB_ACTIVITIES[Math.floor(Math.random() * STUB_ACTIVITIES.length)]
  return {
    activity: a.lines[Math.floor(Math.random() * a.lines.length)],
    details: a.details[Math.floor(Math.random() * a.details.length)],
    category: a.cat,
  }
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

// Reverse geocoding.
//
// Strategy:
//  1. If coords look Korean (lat 33–39, lng 124–132) AND a Kakao REST key is
//     set, hit Kakao Local — best Korean building/dong names. Set the key via
//     `functions/.env.trackbyphoto-app` (KAKAO_REST_KEY=...).
//  2. Otherwise hit OpenStreetMap Nominatim — free, no API key, global
//     coverage. Pulls a short, human-readable name from the address parts.
//  3. If everything fails, return '' so the UI shows "위치 정보 없음" rather
//     than a fake Korean place name. (Previously a stub list of Korean
//     locations was returned even for US coords, which is what produced the
//     "한강공원 in USA" bug.)

function isLikelyKorea(lat: number, lng: number): boolean {
  return lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132
}

interface KakaoCoord2AddressDoc {
  address?: { region_3depth_name?: string; address_name?: string }
  road_address?: { address_name?: string; building_name?: string }
}
interface KakaoCoord2AddressResponse {
  documents?: KakaoCoord2AddressDoc[]
}

async function reverseGeocodeKakao(lat: number, lng: number, apiKey: string): Promise<string> {
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
}

interface NominatimResponse {
  display_name?: string
  address?: {
    amenity?: string
    shop?: string
    leisure?: string
    tourism?: string
    building?: string
    park?: string
    road?: string
    neighbourhood?: string
    suburb?: string
    quarter?: string
    village?: string
    town?: string
    city?: string
    state?: string
    country?: string
  }
}

async function reverseGeocodeNominatim(lat: number, lng: number): Promise<string> {
  // Nominatim usage policy requires a real User-Agent identifying the app.
  // Korean-language results when available (Accept-Language: ko, en).
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'TrackByPhoto/1.0 (https://trackbyphoto.web.app)',
      'Accept-Language': 'ko,en',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as NominatimResponse
  const a = data.address || {}

  // Prefer a specific named feature (a cafe, park, building) over the broader
  // city/state. Family members want "Starbucks" or "Central Park", not "New
  // York, NY". Fall back to neighborhood → city when no feature is named.
  const specific = a.amenity || a.shop || a.leisure || a.tourism || a.building || a.park
  if (specific) return specific
  const local = a.neighbourhood || a.suburb || a.quarter || a.village || a.town
  if (local && a.city) return `${local}, ${a.city}`
  if (local) return local
  if (a.city) return a.city
  if (a.road) return a.road
  if (data.display_name) {
    // Nominatim's display_name is a long comma-separated chain; first two
    // parts are usually the most specific and recognizable.
    return data.display_name.split(',').slice(0, 2).map((s) => s.trim()).join(', ')
  }
  throw new Error('no usable address fields')
}

async function reverseGeocode(lat: number | null, lng: number | null): Promise<string> {
  if (lat == null || lng == null) return ''

  const kakaoKey = process.env.KAKAO_REST_KEY || ''
  if (kakaoKey && isLikelyKorea(lat, lng)) {
    try {
      return await reverseGeocodeKakao(lat, lng, kakaoKey)
    } catch (err) {
      logger.warn('[reverseGeocode] Kakao failed; falling back to Nominatim', { err: String(err), lat, lng })
    }
  }

  try {
    return await reverseGeocodeNominatim(lat, lng)
  } catch (err) {
    logger.warn('[reverseGeocode] Nominatim failed; returning empty', { err: String(err), lat, lng })
    return ''
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Admin dashboard counters.
//
// Every successful memo bumps two atomic Firestore counters:
//   admin_totals/global             — ever-growing roll-up across the app
//   admin_daily/{YYYY-MM-DD}        — one doc per UTC day for the trend chart
//
// Both are written via FieldValue.increment so concurrent uploads from
// multiple devices don't race. The /superadmin page reads these and the
// recent memos collection to render the dashboard.
// ────────────────────────────────────────────────────────────────────────────

function utcDateKey(d: Date): string {
  // YYYY-MM-DD in UTC. We want the dashboard "today" to mean "today on the
  // server" so the doc id is stable regardless of which timezone runs the
  // function. (us-west1 ≈ UTC-8.)
  return d.toISOString().slice(0, 10)
}

async function bumpAdminCounters(args: {
  category: string
  memoSource: string
  geminiCost: { promptTokens: number; outputTokens: number; totalUSD: number } | null
}) {
  const db = getFirestore()
  const day = utcDateKey(new Date())
  const inc = (n: number) => FieldValue.increment(n)
  const safeKey = (s: string) => s.replace(/[.~/[\]#\s]/g, '_') || 'unknown'
  const cat = safeKey(args.category)
  const src = safeKey(args.memoSource)
  const cost = args.geminiCost

  const totalsUpdate: Record<string, unknown> = {
    memos: inc(1),
    [`byCategory.${cat}`]: inc(1),
    [`bySource.${src}`]: inc(1),
    lastMemoAt: FieldValue.serverTimestamp(),
  }
  const dailyUpdate: Record<string, unknown> = {
    date: day,
    memos: inc(1),
    [`byCategory.${cat}`]: inc(1),
    [`bySource.${src}`]: inc(1),
  }
  if (cost) {
    totalsUpdate.geminiCalls = inc(1)
    totalsUpdate.geminiPromptTokens = inc(cost.promptTokens)
    totalsUpdate.geminiOutputTokens = inc(cost.outputTokens)
    totalsUpdate.geminiUSD = inc(cost.totalUSD)
    dailyUpdate.geminiCalls = inc(1)
    dailyUpdate.geminiPromptTokens = inc(cost.promptTokens)
    dailyUpdate.geminiOutputTokens = inc(cost.outputTokens)
    dailyUpdate.geminiUSD = inc(cost.totalUSD)
  }

  // set({merge:true}) so the docs are created on first run without a
  // separate initialization step.
  await Promise.all([
    db.collection('admin_totals').doc('global').set(totalsUpdate, { merge: true }),
    db.collection('admin_daily').doc(day).set(dailyUpdate, { merge: true }),
  ])
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
        details: '',
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

      // Pick the activity tier:
      //   1. Device memo (Apple Foundation Models / template) — trust verbatim.
      //      No `details` from this tier yet — device LLM only produces the
      //      short headline. Leave details empty.
      //   2. Gemini 2.0 Flash Vision — produces both activity + details.
      //   3. Deterministic stub (Gemini unreachable / unconfigured).
      let activity: string
      let details: string = ''
      let category: string
      let memoSource: string
      // Token + USD for this run, or null when no Gemini call happened
      // (device tier or stub). Used for the admin counter roll-up.
      let geminiCost: GeminiResult['cost'] | null = null
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
          // Place is now always a real geocode (Kakao or Nominatim) or ''.
          // Only pass when non-empty so the model isn't told 알 수 없음 twice.
          placeHint: place || undefined,
        })
        if (cloud) {
          activity = cloud.activity
          details = cloud.details
          category = cloud.category
          memoSource = 'cloud-vision'
          geminiCost = cloud.cost
        } else {
          const stub = stubActivity()
          activity = stub.activity
          details = stub.details
          category = stub.category
          memoSource = 'cloud-stub'
        }
      }

      // Skip activity/details/category/memoSource when a guardian has already
      // corrected the memo. photoUrl + place are still safe to refresh
      // (they're factual, not interpretation).
      const update: Record<string, unknown> = { photoUrl, place, status: 'ready' }
      if (!existingHumanEdited) {
        update.activity = activity
        update.details = details
        update.category = category
        update.memoSource = memoSource
      }
      await memoRef.update(update)

      // Roll up dashboard counters. Don't let a counter failure mark the
      // memo as 'error' — the user-visible result is fine.
      try {
        await bumpAdminCounters({ category, memoSource, geminiCost })
      } catch (err) {
        logger.warn('[admin-counters] failed to bump', { err: String(err) })
      }

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
