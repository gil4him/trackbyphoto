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

const VALID_CATEGORIES = ['식사', '산책', '휴식', '가족', '일상'] as const

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
  activity: string
  details: string
  category: string
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
function buildPrompt(timeHint?: string, placeHint?: string): string {
  return [
    '당신은 가족이 어르신의 사진을 보고 무엇을 하셨는지 빠르게 알 수 있도록 한국어 메모를 작성하는 보조 AI입니다.',
    '',
    '원칙:',
    '- 사진에 실제로 보이는 것만 적으세요. 보이지 않는 감정·관계·이유는 추측 금지.',
    '- 일반론·상투어 금지. 다음 표현은 절대 사용하지 마세요: "소중한 순간", "잔잔한", "오늘의 한 장면", "행복하게", "사랑하는".',
    '- 어르신 본인이 사진에 없을 수도 있어요. 그러면 무엇을 보고 계셨는지 또는 무엇을 촬영하셨는지를 적으세요.',
    '- 존댓말. 사실 위주, 따뜻하되 단정함보다 정확함이 우선.',
    '',
    'activity (한 줄, 12~22자): 무엇을 하시는지 또는 무엇을 찍으셨는지를 구체적으로.',
    '  좋은 예: "공원 벤치에 앉아 계세요" / "테이블 위 김치찌개 한 그릇" / "창밖 단풍을 보고 계세요"',
    '  나쁜 예: "오늘의 한 장면" / "소중한 시간" / "휴식 중이세요"(맥락 없음)',
    '',
    'details (2~3문장, 80~140자): 사진에서 보이는 것을 구체적으로.',
    '  포함: 주요 사물, 사람 수, 실내/실외, 빛(낮·저녁·실내등), 색감, 자세.',
    '  제외: 감정 추측, 관계 추측("따님과", "친구와" 등 확인되지 않으면 금지).',
    '',
    'category: 식사 / 산책 / 휴식 / 가족 / 일상 중 정확히 하나.',
    '  식사 — 음식이 사진의 주제',
    '  산책 — 야외에서 이동·걷기',
    '  휴식 — 실내에서 앉아 있거나 쉬는 모습',
    '  가족 — 사람이 둘 이상 함께 있는 모습',
    '  일상 — 위 어디에도 속하지 않는 사물·풍경·정물',
    '',
    '상황 정보 (참고용, 사진과 어긋나면 무시):',
    `- 시간: ${timeHint || '알 수 없음'}`,
    `- 장소: ${placeHint || '알 수 없음'}`,
    '',
    'JSON만 출력하세요. 다른 텍스트 금지:',
    '{"activity":"...","details":"...","category":"..."}',
  ].join('\n')
}

function parseModelResponse(raw: string): { activity: string; details: string; category: string } | null {
  // Both providers occasionally wrap JSON in a code fence even with the
  // response-format hint.
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as { activity?: unknown; details?: unknown; category?: unknown }
    const activity = typeof parsed.activity === 'string' ? parsed.activity.trim() : ''
    const details = typeof parsed.details === 'string' ? parsed.details.trim() : ''
    const categoryRaw = typeof parsed.category === 'string' ? parsed.category.trim() : ''
    if (!activity) return null
    const category = (VALID_CATEGORIES as readonly string[]).includes(categoryRaw)
      ? categoryRaw
      : '일상'
    return { activity, details, category }
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
        maxOutputTokens: 1024,
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
      max_tokens: 400,
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
      //   2. Cloud vision LLM (Gemini or OpenAI via MODEL env) — produces both
      //      activity + details.
      //   3. Deterministic stub (LLM unreachable / unconfigured).
      let activity: string
      let details: string = ''
      let category: string
      let memoSource: string
      // Token + USD for this run, or null when no LLM call happened
      // (device tier or stub). Used for the admin counter roll-up.
      let geminiCost: LlmResult['cost'] | null = null
      let cloudModel: string | null = null
      if (deviceActivity) {
        activity = deviceActivity
        category = categoryFromTags(tags)
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
          details = cloud.details
          category = cloud.category
          memoSource = 'cloud-vision'
          geminiCost = cloud.cost
          cloudModel = cloud.model
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
        // Persisted onto the memo so the dashboard's recent-memos list can
        // show which model produced each entry (useful while A/B testing).
        if (cloudModel) update.model = cloudModel
      }
      await memoRef.update(update)

      // Roll up dashboard counters. Don't let a counter failure mark the
      // memo as 'error' — the user-visible result is fine.
      try {
        await bumpAdminCounters({ category, memoSource, model: cloudModel, geminiCost })
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
        details: (memo.details as string) || '',
        category: (memo.category as string) || '',
        memoSource: (memo.memoSource as string) || '',
        model: (memo.model as string) || '',
      },
      new: {
        activity: result.activity,
        details: result.details,
        category: result.category,
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
