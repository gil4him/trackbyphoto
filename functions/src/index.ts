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
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret, defineString } from 'firebase-functions/params'
import { logger } from 'firebase-functions/v2'
import { GoogleGenAI } from '@google/genai'
import OpenAI from 'openai'

initializeApp()

// Caregiver-share callables — invite / accept / revoke / role / name-sync.
export { createInvite, acceptInvite, revokeMembership, setMembershipRole, syncCaregiverName } from './caregiver'

// Settings-change audit + elder notification trigger. See audit.ts.
export { onUserSettingsChanged } from './audit'

// Must match the default Storage bucket's region (created via Firebase console).
// Storage bucket is in us-west1, so function must trigger there too.
const REGION = 'us-west1'

// API keys, configured via:
//   firebase functions:secrets:set GEMINI_API_KEY
//   firebase functions:secrets:set OPENAI_API_KEY
// Only the key for the currently selected MODEL needs to be set. When the
// required key is missing the function falls back to the deterministic stub
// so the pipeline keeps working without external setup.
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY')
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY')

// Currently selected vision model. Switch without redeploying code via:
//   firebase functions:config:set ai.model="gpt-4o-mini"
// or set MODEL in functions/.env.<project-id>. Defaults to gemini-2.5-flash,
// the best $/quality ratio for this task per the comparison in the dashboard.
const MODEL = defineString('MODEL', { default: 'gemini-2.5-flash' })

// ────────────────────────────────────────────────────────────────────────────
// Cloud Vision LLM tier.
//
// Runs when the device couldn't produce a memo (web upload, older iPhone, or
// Apple Intelligence off). Downloads the photo bytes from Storage and sends
// them to the configured model with a Korean prompt + time/place context.
// Parses a short Korean sentence + a category. Falls back to the deterministic
// stub below when the API call fails (network, parse error, missing key).
//
// Supports both Gemini and OpenAI via the MODEL env var — the prompt is the
// same, only the SDK call shape differs.
// ────────────────────────────────────────────────────────────────────────────

const VALID_CATEGORIES = ['식사', '산책', '휴식', '가족', '꽃', '기타'] as const

// Per-model pricing in USD per 1M tokens, used for the cost log + dashboard
// roll-up. Image tokens are folded into prompt count by both providers so we
// don't need a separate image-tile calculation.
//
// Sources: ai.google.dev/pricing and openai.com/api/pricing (as of 2025-mid).
// Update when you change models so the dashboard stays honest.
const PRICING: Record<string, { provider: 'gemini' | 'openai'; inPerM: number; outPerM: number }> = {
  // Gemini
  // Note: gemini-2.0-flash was retired by Google (404 on generateContent
  // as of mid-2026). Don't re-add without confirming availability.
  'gemini-2.5-flash': { provider: 'gemini', inPerM: 0.30, outPerM: 2.50 },
  'gemini-2.5-pro':   { provider: 'gemini', inPerM: 1.25, outPerM: 10.00 },
  // OpenAI
  'gpt-4o-mini': { provider: 'openai', inPerM: 0.15, outPerM: 0.60 },
  'gpt-4o':      { provider: 'openai', inPerM: 2.50, outPerM: 10.00 },
  'gpt-4.1-mini': { provider: 'openai', inPerM: 0.40, outPerM: 1.60 },
  'gpt-4.1':      { provider: 'openai', inPerM: 2.00, outPerM: 8.00 },
}

interface LlmResult {
  /** One-word activity category (식사 / 산책 / 휴식 / 가족 / 꽃 / 기타). */
  activity: string
  /** Warm one-sentence memo for the family. ≤25자. */
  memo: string
  /** 2-sentence "그 순간" scene paragraph that paints the moment for distant
   *  family. ~50–100자. May reference one concrete object (food, light, view)
   *  to ground the scene — that's the whole point of having this field
   *  alongside the terse memo. */
  scene: string
  /** Model that produced this result. Recorded onto the counter rollup so
   *  the dashboard can break costs out by model when we switch between
   *  vendors mid-month. */
  model: string
  /** Token counts + USD estimate, included so the trigger can roll up
   *  spending into admin_daily / admin_totals for the dashboard. */
  cost: { promptTokens: number; outputTokens: number; totalUSD: number }
}

// Korean memo prompt shared across providers. Lives at module scope so both
// branches see the exact same instructions — makes A/B comparisons fair.
//
// Tone target: a warm caption a family member would smile at. The model
// reports ONE short Korean sentence about what the senior is doing, plus a
// one-word activity category. We deliberately do NOT ask it to list objects,
// colors, counts, or background — those produced clinical descriptions that
// felt cold when family read them.
function buildPrompt(timeHint?: string, placeHint?: string): string {
  return [
    '당신은 어르신의 하루를 가족에게 따뜻하게 전하는 보조 AI입니다.',
    '사진을 보고 세 가지를 작성해 주세요: 한 단어 카테고리(activity), 짧은 캡션(memo), 그리고 그 순간을 묘사하는 두 문장(scene).',
    '',
    '공통 규칙:',
    '- 한국어 존댓말. 따뜻하지만 사실에 가깝게.',
    '- 사람 이름, 사진 속 글자, 건강·약·진단명은 절대 추측하지 마세요.',
    '- 확신이 없으면 일반적으로 적고, 구체적인 사실을 지어내지 마세요.',
    '- 관계 추측 금지("따님과", "친구와" 등 확인되지 않으면 쓰지 마세요).',
    '',
    'memo (한 문장, 25자 이내):',
    '- 무엇을 하고 계신지(활동)에 집중. 가족이 미소 지을 만한 따뜻한 캡션.',
    '- 사물·옷·색깔·배경·개수를 나열하지 마세요. 활동 중심.',
    '',
    'scene (두 문장, 50~100자):',
    '- 그 순간을 가족이 함께 있는 듯 느끼도록 짧게 묘사.',
    '- 시간대 느낌(아침 햇살, 조용한 오후 등), 장소 분위기, 그리고 사진에서 보이는 구체적인 한 가지(음식, 빛, 창밖 풍경, 꽃 등)를 자연스럽게 한 번만 언급.',
    '- 분위기 한 단어로 끝낼 수도 있어요(여유로운, 평온한, 따뜻한 등).',
    '- 사물 나열·개수·색깔 나열 금지. 한 가지 앵커만.',
    '',
    'activity 카테고리(정확히 하나): 식사 / 산책 / 휴식 / 가족 / 꽃 / 기타',
    '',
    '사진이 흐리거나 활동이 불분명하면:',
    '  {"activity":"기타","memo":"오늘의 한 순간을 담았어요.","scene":"오늘 하루의 작은 한 장면이에요."}',
    '',
    '예시:',
    '- 식탁 위 음식과 수저 → {"activity":"식사","memo":"맛있는 식사를 하고 계세요.","scene":"식탁 위에 따뜻한 음식이 차려져 있어요. 점심시간의 여유로운 한 장면이에요."}',
    '- 나무가 있는 공원길 → {"activity":"산책","memo":"공원에서 산책 중이세요.","scene":"나무가 우거진 산책로를 천천히 걷고 계세요. 햇살이 부드럽게 비치는 오후예요."}',
    '- 소파와 텔레비전 → {"activity":"휴식","memo":"거실에서 편안히 쉬고 계세요.","scene":"소파에 기대어 잠시 쉬어가는 시간이에요. 조용하고 평온한 분위기예요."}',
    '- 사람들이 모여 웃고 있는 모습 → {"activity":"가족","memo":"가족과 즐거운 시간을 보내고 계세요.","scene":"가까운 사람들과 함께 모여 계세요. 따뜻한 분위기가 느껴져요."}',
    '- 화분의 꽃 → {"activity":"꽃","memo":"예쁜 꽃을 보고 계세요.","scene":"활짝 핀 꽃 가까이에서 바라보고 계세요. 봄날의 산뜻한 한 컷이에요."}',
    '',
    '상황 정보 (참고용, 사진과 어긋나면 무시):',
    `- 시간: ${timeHint || '알 수 없음'}`,
    `- 장소: ${placeHint || '알 수 없음'}`,
    '',
    'JSON만 출력하세요. 다른 텍스트 금지:',
    '{"activity":"<한 단어 카테고리>","memo":"<짧고 따뜻한 한 문장>","scene":"<두 문장의 따뜻한 장면 묘사>"}',
  ].join('\n')
}

function parseModelResponse(raw: string): { activity: string; memo: string; scene: string } | null {
  // Both providers occasionally wrap JSON in a code fence even with the
  // response-format hint.
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as { activity?: unknown; memo?: unknown; scene?: unknown }
    const activityRaw = typeof parsed.activity === 'string' ? parsed.activity.trim() : ''
    const memo = typeof parsed.memo === 'string' ? parsed.memo.trim() : ''
    // scene is optional in the response — when a model briefly drops it we
    // still accept the memo. The UI hides the section when empty so this
    // degrades gracefully.
    const scene = typeof parsed.scene === 'string' ? parsed.scene.trim() : ''
    if (!memo) return null
    // Snap the activity to one of the known categories. The model can drift
    // ("점심" instead of "식사") so we coerce — anything unrecognized falls
    // back to 기타 rather than polluting the dashboard with one-off buckets.
    const activity = (VALID_CATEGORIES as readonly string[]).includes(activityRaw)
      ? activityRaw
      : '기타'
    return { activity, memo, scene }
  } catch {
    return null
  }
}

function logCost(model: string, inTok: number, outTok: number): { totalUSD: number } {
  const p = PRICING[model]
  if (!p) {
    logger.warn('[gemini-cost] no pricing entry for model — cost not recorded', { model })
    return { totalUSD: 0 }
  }
  const inUSD = (inTok / 1_000_000) * p.inPerM
  const outUSD = (outTok / 1_000_000) * p.outPerM
  const totalUSD = inUSD + outUSD
  // Keep the [gemini-cost] tag for backward compat with existing log filters
  // even when the model is OpenAI — it's "the cost log" regardless of vendor.
  logger.info('[gemini-cost] usage', {
    tag: 'gemini-cost',
    model,
    promptTokens: inTok,
    outputTokens: outTok,
    totalTokens: inTok + outTok,
    inputUSD: Number(inUSD.toFixed(6)),
    outputUSD: Number(outUSD.toFixed(6)),
    totalUSD: Number(totalUSD.toFixed(6)),
  })
  return { totalUSD }
}

// Resolve the active model. Priority:
//   1. admin_config/global.model (set live from the /superadmin picker)
//   2. MODEL env var (deploy-time default)
// Cached for 60s so we don't hit Firestore on every photo, but still pick up
// dashboard changes within a minute. Cold-start always re-reads.
let _modelCache: { value: string; expiresAt: number } | null = null
async function resolveModel(): Promise<string> {
  const now = Date.now()
  if (_modelCache && _modelCache.expiresAt > now) return _modelCache.value
  let chosen = MODEL.value()
  try {
    const snap = await getFirestore().collection('admin_config').doc('global').get()
    const override = (snap.exists ? (snap.data()?.model as string | undefined) : undefined)?.trim()
    if (override && PRICING[override]) chosen = override
  } catch (err) {
    logger.warn('[llm] admin_config read failed; using env MODEL', { err: String(err) })
  }
  _modelCache = { value: chosen, expiresAt: now + 60_000 }
  return chosen
}

// Dispatcher — reads MODEL, downloads the photo once, then hands off to the
// right provider. Returns null on any failure so the trigger falls back to
// the stub.
async function generateActivityWithLLM(args: {
  bucket: string
  objectPath: string
  contentType?: string
  timeHint?: string
  placeHint?: string
}): Promise<LlmResult | null> {
  const modelName = await resolveModel()
  const pricing = PRICING[modelName]
  if (!pricing) {
    logger.error('[llm] unknown MODEL — add to PRICING table', { model: modelName })
    return null
  }

  // Pull photo bytes once (shared between providers).
  let base64: string
  let mimeType: string
  try {
    const bucket = getStorage().bucket(args.bucket)
    const file = bucket.file(args.objectPath)
    const [buffer] = await file.download()
    mimeType = args.contentType || 'image/jpeg'
    base64 = buffer.toString('base64')
  } catch (err) {
    logger.warn('[llm] photo download failed', { err: String(err) })
    return null
  }

  const prompt = buildPrompt(args.timeHint, args.placeHint)

  if (pricing.provider === 'gemini') {
    return generateWithGemini(modelName, base64, mimeType, prompt)
  } else {
    return generateWithOpenAI(modelName, base64, mimeType, prompt)
  }
}

async function generateWithGemini(
  modelName: string,
  base64: string,
  mimeType: string,
  prompt: string,
): Promise<LlmResult | null> {
  const apiKey = GEMINI_API_KEY.value()
  if (!apiKey) {
    logger.warn('[gemini] GEMINI_API_KEY unset; skipping cloud Vision tier')
    return null
  }
  try {
    const ai = new GoogleGenAI({ apiKey })
    // Modern @google/genai SDK — unlike legacy @google/generative-ai v0.24,
    // this one actually forwards `thinkingConfig` to the REST API. Gemini 2.5
    // series enables "thinking" by default; thinkingBudget=0 disables it so
    // the entire maxOutputTokens budget is spent on the visible JSON instead
    // of being burned on reasoning tokens (which produced truncated output
    // like raw="{\n  \"activity" on the legacy SDK).
    const result = await ai.models.generateContent({
      model: modelName,
      contents: [
        { inlineData: { data: base64, mimeType } },
        { text: prompt },
      ],
      config: {
        // Low temp = more grounded, less floral. Each lift toward 1 made the
        // output measurably more generic in spot checks.
        temperature: 0.2,
        // Bumped to accommodate the scene field (~80자 ≈ ~250 output tokens
        // after JSON overhead and Korean tokenization).
        maxOutputTokens: 1500,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    })
    const raw = (result.text || '').trim()
    const parsed = parseModelResponse(raw)
    if (!parsed) {
      // Stringify the full response so firebase-functions' logger doesn't
      // silently drop nested fields (finishReason, usageMetadata, etc).
      logger.warn('[gemini] empty/invalid response', {
        raw,
        responseDump: JSON.stringify(result, null, 2),
      })
      return null
    }
    const usage = result.usageMetadata
    const inTok = usage?.promptTokenCount ?? 0
    const outTok = usage?.candidatesTokenCount ?? 0
    const { totalUSD } = logCost(modelName, inTok, outTok)
    return { ...parsed, model: modelName, cost: { promptTokens: inTok, outputTokens: outTok, totalUSD } }
  } catch (err) {
    logger.warn('[gemini] generation failed', { err: String(err) })
    return null
  }
}

async function generateWithOpenAI(
  modelName: string,
  base64: string,
  mimeType: string,
  prompt: string,
): Promise<LlmResult | null> {
  const apiKey = OPENAI_API_KEY.value()
  if (!apiKey) {
    logger.warn('[openai] OPENAI_API_KEY unset; skipping cloud Vision tier')
    return null
  }
  try {
    const client = new OpenAI({ apiKey })
    // Chat Completions w/ image_url + base64 data URL is the simplest path
    // that works across gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini.
    const dataUrl = `data:${mimeType};base64,${base64}`
    const result = await client.chat.completions.create({
      model: modelName,
      temperature: 0.2,
      // Bumped to accommodate the scene field (~80자 ≈ ~250 output tokens
      // after JSON overhead and Korean tokenization).
      max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    })
    const raw = result.choices[0]?.message?.content?.trim() || ''
    const parsed = parseModelResponse(raw)
    if (!parsed) {
      logger.warn('[openai] empty/invalid response', { raw })
      return null
    }
    const usage = result.usage
    const inTok = usage?.prompt_tokens ?? 0
    const outTok = usage?.completion_tokens ?? 0
    const { totalUSD } = logCost(modelName, inTok, outTok)
    return { ...parsed, model: modelName, cost: { promptTokens: inTok, outputTokens: outTok, totalUSD } }
  } catch (err) {
    logger.warn('[openai] generation failed', { err: String(err) })
    return null
  }
}

// Final-fallback stub used when Gemini is unreachable or unconfigured.
// Memos + scenes here mirror the warm tone the LLM prompt asks for, so when
// we fall back the user can't tell something went wrong.
const STUB_ACTIVITIES: { cat: string; memos: string[]; scenes: string[] }[] = [
  {
    cat: '식사',
    memos: ['맛있는 식사를 하고 계세요.', '따뜻한 한 끼를 드시고 계세요.', '식사 시간이에요.'],
    scenes: [
      '식탁 위에 따뜻한 음식이 차려져 있어요. 여유로운 식사 시간이에요.',
      '정성스레 차린 한 끼 앞에 앉아 계세요. 평온한 한 장면이에요.',
    ],
  },
  {
    cat: '산책',
    memos: ['공원에서 산책 중이세요.', '햇살 아래 걷고 계세요.', '바깥 공기를 쐬고 계세요.'],
    scenes: [
      '바깥 공기를 쐬며 천천히 걷고 계세요. 햇살이 부드러운 시간이에요.',
      '나뭇잎이 흔들리는 산책길을 걷고 계세요. 편안한 분위기가 느껴져요.',
    ],
  },
  {
    cat: '휴식',
    memos: ['거실에서 편안히 쉬고 계세요.', '잠깐 쉬어가는 시간이에요.', '여유로운 시간을 보내고 계세요.'],
    scenes: [
      '잠시 자리에 앉아 한숨 돌리고 계세요. 조용하고 평온한 분위기예요.',
      '편안한 자리에서 쉬어가는 시간이에요. 따뜻한 빛이 감도는 한 장면이에요.',
    ],
  },
  {
    cat: '가족',
    memos: ['가족과 즐거운 시간을 보내고 계세요.', '함께하는 시간이에요.'],
    scenes: [
      '가까운 사람들과 함께 모여 계세요. 따뜻한 분위기가 느껴져요.',
      '함께 모인 자리에서 시간을 보내고 계세요. 편안한 한 장면이에요.',
    ],
  },
  {
    cat: '꽃',
    memos: ['예쁜 꽃을 보고 계세요.', '꽃과 함께한 순간이에요.'],
    scenes: [
      '활짝 핀 꽃 가까이에서 바라보고 계세요. 산뜻한 한 컷이에요.',
      '꽃이 피어 있는 자리에서 잠시 멈춰 계세요. 부드러운 분위기예요.',
    ],
  },
  {
    cat: '기타',
    memos: ['오늘의 한 순간을 담았어요.'],
    scenes: ['오늘 하루의 작은 한 장면이에요.'],
  },
]
function stubActivity(): { activity: string; memo: string; scene: string } {
  const a = STUB_ACTIVITIES[Math.floor(Math.random() * STUB_ACTIVITIES.length)]
  return {
    activity: a.cat,
    memo: a.memos[Math.floor(Math.random() * a.memos.length)],
    scene: a.scenes[Math.floor(Math.random() * a.scenes.length)],
  }
}

/**
 * Pick a coarse activity category from Vision tags when the device wrote the
 * memo. The Foundation-Models sentence isn't easy to bucket post-hoc, but the
 * underlying VNClassifyImageRequest labels (English ImageNet-ish names) map
 * cleanly enough. Defaults to 기타.
 */
function categoryFromTags(
  tags: { labels: { name: string; confidence: number }[]; text: string[]; faceCount: number } | null,
): string {
  if (!tags) return '기타'
  const names = tags.labels.map((l) => l.name.toLowerCase()).join(' ')
  if (/food|meal|dish|plate|bowl|drink|beverage|cup|fruit|vegetable/.test(names)) return '식사'
  if (/park|tree|outdoor|street|walk|path|garden|trail|sky|grass/.test(names)) return '산책'
  if (/flower|blossom|petal|bouquet|rose|tulip/.test(names)) return '꽃'
  if (/sofa|bed|chair|tv|television|book|tea|home interior|indoor/.test(names)) return '휴식'
  if (tags.faceCount >= 2) return '가족'
  return '기타'
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
  address?: {
    region_1depth_name?: string
    region_2depth_name?: string
    region_3depth_name?: string
    address_name?: string
  }
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

  // Region_2depth ("강남구", "성남시") gives the city/gu suffix that family
  // members will recognize. Pair it with the most specific name we have
  // (building → dong → road) so the output is "성모병원, 강남구".
  const city = doc.address?.region_2depth_name?.trim()
  const join = (name: string) => (city && city !== name ? `${name}, ${city}` : name)

  const building = doc.road_address?.building_name?.trim()
  if (building) return join(building)
  const dong = doc.address?.region_3depth_name?.trim()
  if (dong) return join(dong)
  const road = doc.road_address?.address_name?.trim()
  if (road) return road
  if (city) return city
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

  // Always pair the specific name with the surrounding city / town / state
  // so guardians get both context lines: "Starbucks, San Francisco" rather
  // than just "Starbucks". Falls back gracefully when only one part is
  // available.
  const cityish = a.city || a.town || a.village || a.suburb || a.state
  const join = (name: string) => (cityish && cityish !== name ? `${name}, ${cityish}` : name)

  // Prefer a specific named feature (cafe, park, building) over the broader
  // neighborhood/city.
  const specific = a.amenity || a.shop || a.leisure || a.tourism || a.building || a.park
  if (specific) return join(specific)
  const local = a.neighbourhood || a.suburb || a.quarter
  if (local) return join(local)
  if (cityish) return cityish
  if (a.road) return join(a.road)
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
  model: string | null
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
    // Per-model breakdown so the dashboard can show contribution per model
    // when MODEL has been flipped mid-month (e.g., gemini-2.5-flash → gpt-4o
    // for A/B). Stored under nested map keys (model dot is escaped in safeKey).
    if (args.model) {
      const mdl = safeKey(args.model)
      totalsUpdate[`byModel.${mdl}.calls`] = inc(1)
      totalsUpdate[`byModel.${mdl}.usd`] = inc(cost.totalUSD)
      dailyUpdate[`byModel.${mdl}.calls`] = inc(1)
      dailyUpdate[`byModel.${mdl}.usd`] = inc(cost.totalUSD)
    }
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
    // Both keys are listed so MODEL can be flipped between Gemini and OpenAI
    // via env var without redeploying. Only the one matching the active
    // MODEL is actually read.
    secrets: [GEMINI_API_KEY, OPENAI_API_KEY],
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
    // On-device memo sentence from Apple Foundation Models (Layer 2). Empty
    // string means the device couldn't produce one (web client, older iPhone,
    // or Apple Intelligence off) and we should fall back to the cloud LLM /
    // stub. The device only produces the warm sentence; we derive the
    // one-word activity category from Vision tags below.
    const deviceMemo = ((meta.memo as string) || '').trim()
    // The tier that produced deviceMemo on the device. Persisted onto the
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
    // Only a brand-new upload should notify caregivers — a retrigger on the
    // same Storage path must not re-fire the notice.
    const wasNew = !existing.exists
    if (!existingHumanEdited) {
      await memoRef.set({
        // `patientUid` (not `uid`) is the schema field per the caregiver-share
        // plan (TrackByPhoto-Plan.md Appendix A). For self-managed accounts
        // the elder uploads their own photos, so the uploader's uid IS the
        // patientUid. Once caregiver-uploads ship, the caller will set the
        // patient explicitly in storage metadata.
        patientUid: uid,
        photoPath: path,
        photoUrl: '',
        takenAt: takenAtIso ? Timestamp.fromDate(new Date(takenAtIso)) : Timestamp.now(),
        lat, lng,
        place: '',
        activity: '기타',
        memo: '',
        scene: '',
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

      // Pick the memo tier:
      //   1. Device memo (Apple Foundation Models / template) — trust the
      //      warm sentence verbatim. Activity category is derived from
      //      Vision tags since the device LLM doesn't bucket.
      //   2. Cloud vision LLM (Gemini or OpenAI via MODEL env) — produces
      //      both activity + memo.
      //   3. Deterministic stub (LLM unreachable / unconfigured).
      let activity: string
      let memo: string
      // scene is empty when the device tier produced the memo (Foundation
      // Models only writes the short headline). Cloud LLM + stub both fill it.
      let scene: string = ''
      let memoSource: string
      // Token + USD for this run, or null when no LLM call happened
      // (device tier or stub). Used for the admin counter roll-up.
      let geminiCost: LlmResult['cost'] | null = null
      let cloudModel: string | null = null
      if (deviceMemo) {
        memo = deviceMemo
        activity = categoryFromTags(tags)
        memoSource = deviceMemoSource || 'foundation-models'
      } else {
        const timeHint = takenAtIso ? new Date(takenAtIso).toTimeString().slice(0, 5) : undefined
        const cloud = await generateActivityWithLLM({
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
          memo = cloud.memo
          scene = cloud.scene
          memoSource = 'cloud-vision'
          geminiCost = cloud.cost
          cloudModel = cloud.model
        } else {
          const stub = stubActivity()
          activity = stub.activity
          memo = stub.memo
          scene = stub.scene
          memoSource = 'cloud-stub'
        }
      }

      // Skip activity/memo/memoSource when a guardian has already corrected
      // the memo. photoUrl + place are still safe to refresh (they're
      // factual, not interpretation).
      const update: Record<string, unknown> = { photoUrl, place, status: 'ready' }
      if (!existingHumanEdited) {
        update.activity = activity
        update.memo = memo
        update.scene = scene
        update.memoSource = memoSource
        // Persisted onto the memo so the dashboard's recent-memos list can
        // show which model produced each entry (useful while A/B testing).
        if (cloudModel) update.model = cloudModel
      }
      await memoRef.update(update)

      // Notify each active caregiver that a new photo is in. One notification
      // doc per caregiver, addressed via recipientUid so it shows on their feed
      // + app-icon badge. Best-effort — never fail the memo over a notice.
      if (wasNew) {
        try {
          const cgs = await db.collection('memberships')
            .where('patientUid', '==', uid)
            .where('status', '==', 'active')
            .get()
          if (!cgs.empty) {
            const patientName = (await db.collection('users').doc(uid).get()).data()?.patientName as string || '사용자'
            const notifyBatch = db.batch()
            cgs.forEach((d) => {
              notifyBatch.set(db.collection('notifications').doc(), {
                recipientUid: d.data().caregiverUid,
                patientUid: uid,
                actorUid: uid,
                type: 'photo.new',
                message: `${patientName}님이 새 사진을 올렸어요`,
                memoId: photoId,
                read: false,
                createdAt: FieldValue.serverTimestamp(),
              })
            })
            await notifyBatch.commit()
          }
        } catch (err) {
          logger.warn('[notify] caregiver photo notice failed', { err: String(err) })
        }
      }

      // Roll up dashboard counters. Don't let a counter failure mark the
      // memo as 'error' — the user-visible result is fine. byCategory is
      // keyed off the activity (which is the one-word category in the new
      // schema), preserving the dashboard's existing breakdown shape.
      try {
        await bumpAdminCounters({ category: activity, memoSource, model: cloudModel, geminiCost })
      } catch (err) {
        logger.warn('[admin-counters] failed to bump', { err: String(err) })
      }

      logger.info('memo ready', {
        uid, photoId, activity, memoSource,
        preservedHumanEdit: existingHumanEdited,
      })
    } catch (err) {
      logger.error('memo generation failed', { err })
      await memoRef.update({ status: 'error' })
    }
  },
)

// ────────────────────────────────────────────────────────────────────────────
// regenerateMemo — admin-only HTTPS callable.
//
// Re-runs a single memo through the currently active model and returns the
// new output WITHOUT persisting. The dashboard uses this for A/B testing:
// shows old (stored) vs new (just generated) side-by-side so you can decide
// whether the new model/prompt is actually an improvement before keeping it.
//
// Returns the cost so the admin can see what a single regen would have cost.
// ────────────────────────────────────────────────────────────────────────────

const ADMIN_EMAIL = 'zymer4him@gmail.com'

export const regenerateMemo = onCall(
  {
    region: REGION,
    memory: '512MiB',
    timeoutSeconds: 60,
    secrets: [GEMINI_API_KEY, OPENAI_API_KEY],
  },
  async (request) => {
    const callerEmail = request.auth?.token?.email
    if (callerEmail !== ADMIN_EMAIL) {
      throw new HttpsError('permission-denied', 'admin only')
    }
    const memoId = (request.data?.memoId as string | undefined)?.trim()
    if (!memoId) {
      throw new HttpsError('invalid-argument', 'memoId required')
    }

    const db = getFirestore()
    const snap = await db.collection('memos').doc(memoId).get()
    if (!snap.exists) {
      throw new HttpsError('not-found', `memo ${memoId} not found`)
    }
    const memo = snap.data()!
    const photoPath = memo.photoPath as string | undefined
    if (!photoPath) {
      throw new HttpsError('failed-precondition', 'memo has no photoPath')
    }

    // Resolve the storage bucket from the path. The Cloud Function trigger
    // uses event.data.bucket; here we use the default app bucket since regen
    // is always for already-stored memos in the project's bucket.
    const bucket = getStorage().bucket()
    const file = bucket.file(photoPath)
    const [storageMeta] = await file.getMetadata()
    const contentType = storageMeta.contentType || 'image/jpeg'

    const takenAtIso = memo.takenAt?.toDate?.().toISOString()
    const timeHint = takenAtIso ? new Date(takenAtIso).toTimeString().slice(0, 5) : undefined
    const placeHint = (memo.place as string | undefined) || undefined

    const result = await generateActivityWithLLM({
      bucket: bucket.name,
      objectPath: photoPath,
      contentType,
      timeHint,
      placeHint,
    })
    if (!result) {
      throw new HttpsError('internal', 'LLM call failed; check function logs')
    }

    return {
      memoId,
      old: {
        activity: (memo.activity as string) || '',
        memo: (memo.memo as string) || '',
        scene: (memo.scene as string) || '',
        memoSource: (memo.memoSource as string) || '',
        model: (memo.model as string) || '',
      },
      new: {
        activity: result.activity,
        memo: result.memo,
        scene: result.scene,
        model: result.model,
      },
      cost: result.cost,
    }
  },
)

// ────────────────────────────────────────────────────────────────────────────
// backfillPatientUid — one-shot admin migration.
//
// The caregiver-share schema renamed `memos.uid` → `memos.patientUid` so
// the field name matches semantic intent (the patient the memo belongs to,
// not the uploader's auth uid — which for self-managed accounts happen to be
// the same value). This callable walks every memo doc lacking `patientUid`
// and copies `uid` into it.
//
// Idempotent: docs already carrying `patientUid` are skipped, so re-running
// is a no-op. Run once from /superadmin after deploy; can be safely deleted
// from the codebase a few weeks later once we're sure no legacy docs remain.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// backfillMemoSchema — one-shot admin migration.
//
// The tone refresh switched the memo schema from
//   { activity: "<Korean sentence>", details: "<longer>", category: "<one-word>" }
// to
//   { activity: "<one-word category>", memo: "<warm sentence>" }
//
// This callable walks every memo doc lacking a `memo` field and:
//   1. Moves the old sentence (data.activity) into `memo`.
//   2. Maps old data.category → new activity (one-word). `일상` becomes `기타`
//      since the category is gone in the new schema; the other four
//      (식사/산책/휴식/가족) carry over 1:1.
//   3. Deletes the legacy `details` and old-meaning `category` fields.
//
// Idempotent: docs already carrying a `memo` string are skipped, so re-running
// is a no-op. Run once from /superadmin after deploy.
// ────────────────────────────────────────────────────────────────────────────

const LEGACY_CATEGORY_MAP: Record<string, string> = {
  '식사': '식사',
  '산책': '산책',
  '휴식': '휴식',
  '가족': '가족',
  '꽃':   '꽃',
  '일상': '기타',  // dropped category — map to 기타
  '기타': '기타',
}

interface BackfillMemoStats {
  scanned: number
  migrated: number
  alreadyOk: number
  skippedEmpty: number
}

export const backfillMemoSchema = onCall(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 540,
  },
  async (request): Promise<BackfillMemoStats> => {
    const callerEmail = request.auth?.token?.email
    if (callerEmail !== ADMIN_EMAIL) {
      throw new HttpsError('permission-denied', 'admin only')
    }
    const db = getFirestore()
    const snap = await db.collection('memos').get()
    let scanned = 0
    let migrated = 0
    let alreadyOk = 0
    let skippedEmpty = 0

    let batch = db.batch()
    let batchCount = 0
    const flush = async () => {
      if (batchCount === 0) return
      await batch.commit()
      batch = db.batch()
      batchCount = 0
    }

    for (const docSnap of snap.docs) {
      scanned++
      const data = docSnap.data() as {
        activity?: unknown
        memo?: unknown
        details?: unknown
        category?: unknown
      }

      // Already migrated: has a `memo` string and no legacy fields.
      const hasNewMemo = typeof data.memo === 'string'
      const hasLegacyFields = data.details !== undefined || data.category !== undefined
      if (hasNewMemo && !hasLegacyFields) { alreadyOk++; continue }

      // A doc with no activity sentence AND no legacy category is too empty to
      // confidently migrate (probably an aborted pending doc). Mark it 기타/''
      // anyway so it conforms to the new schema and the UI renders sanely.
      const legacyActivity = typeof data.activity === 'string' ? data.activity : ''
      const legacyCategory = typeof data.category === 'string' ? data.category : ''
      if (!legacyActivity && !legacyCategory && !hasNewMemo) {
        skippedEmpty++
        batch.update(docSnap.ref, {
          activity: '기타',
          memo: '',
          details: FieldValue.delete(),
          category: FieldValue.delete(),
        })
        batchCount++
        if (batchCount >= 400) await flush()
        continue
      }

      const newMemo = hasNewMemo ? (data.memo as string) : legacyActivity
      const newActivity = LEGACY_CATEGORY_MAP[legacyCategory] || '기타'

      batch.update(docSnap.ref, {
        activity: newActivity,
        memo: newMemo,
        details: FieldValue.delete(),
        category: FieldValue.delete(),
      })
      batchCount++
      migrated++
      if (batchCount >= 400) await flush()
    }
    await flush()

    logger.info('[backfill] memo schema done', { scanned, migrated, alreadyOk, skippedEmpty })
    return { scanned, migrated, alreadyOk, skippedEmpty }
  },
)

export const backfillPatientUid = onCall(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 540,
  },
  async (request) => {
    const callerEmail = request.auth?.token?.email
    if (callerEmail !== ADMIN_EMAIL) {
      throw new HttpsError('permission-denied', 'admin only')
    }
    const db = getFirestore()
    const snap = await db.collection('memos').get()
    let scanned = 0
    let migrated = 0
    let alreadyOk = 0
    let skippedNoUid = 0

    // Batched writes — Firestore caps a batch at 500 ops; we chunk
    // defensively at 400 to leave headroom.
    let batch = db.batch()
    let batchCount = 0
    const flush = async () => {
      if (batchCount === 0) return
      await batch.commit()
      batch = db.batch()
      batchCount = 0
    }

    for (const docSnap of snap.docs) {
      scanned++
      const data = docSnap.data() as { uid?: string; patientUid?: string }
      if (data.patientUid) { alreadyOk++; continue }
      if (!data.uid) { skippedNoUid++; continue }
      batch.update(docSnap.ref, { patientUid: data.uid })
      batchCount++
      migrated++
      if (batchCount >= 400) await flush()
    }
    await flush()

    logger.info('[backfill] patientUid done', { scanned, migrated, alreadyOk, skippedNoUid })
    return { scanned, migrated, alreadyOk, skippedNoUid }
  },
)
