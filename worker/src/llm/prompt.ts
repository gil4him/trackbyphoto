// Memo prompt, response parsing, deterministic stub, and tag → category
// heuristic for the local vision model.

// Order matters only for display. 가족/꽃 from the old six-category schema
// are folded into 모임/자연; older memos keep whatever they were stored with.
export const VALID_CATEGORIES = [
  '식사', '카페', '산책', '여행', '출장', '이동', '쇼핑', '휴식', '모임', '운동', '자연', '병원', '기타',
] as const

export interface VisionTags {
  labels: { name: string; confidence: number }[]
  text: string[]
  faceCount: number
}

export interface PromptHints {
  /** HH:MM the photo was taken. */
  timeHint?: string
  /** The area the photo was taken in (see areaOf), not a shop name. */
  placeHint?: string
  /** Where the photo is relative to home (see travel.ts). */
  homeHint?: { km: number; away: boolean }
  /** Text the phone read in the photo (see readableText). */
  textHint?: string[]
}

// The model writes three things per photo:
//   activity  one category word
//   memo      the subject line: short but concrete (what + where)
//   scene     2–3 short, plain sentences for the detail page
// Everything must come from what is visible in the photo; the hints only
// add context (time, place, distance from home) the picture can't show.
export function buildPrompt(hints: PromptHints = {}): string {
  const { timeHint, placeHint, homeHint, textHint } = hints
  const context = [
    `- 시간: ${timeHint || '알 수 없음'}`,
    `- 지역: ${placeHint || '알 수 없음'}`,
    '  → 지역 이름일 뿐이에요. 사진에 보이지 않는 가게·음식·물건을 지역 이름에서 지어내지 마세요.',
  ]
  if (homeHint?.away) {
    context.push(
      `- 집과의 거리: 집에서 약 ${homeHint.km}km 떨어진 곳이에요. 여행이나 출장 중일 가능성이 높아요.`,
      '  → 공항·역·차 안이면 "이동", 회의실·전시장처럼 일하는 모습이면 "출장", 식사·카페·쇼핑이 분명하면 그 카테고리, 그 밖에는 "여행"을 고르세요.',
      '  → memo나 scene에 지명(도시 이름)을 자연스럽게 한 번 넣으세요.',
    )
  } else if (homeHint) {
    context.push(`- 집과의 거리: ${homeHint.km < 2 ? '집 또는 집 근처예요.' : `집에서 약 ${homeHint.km}km 떨어진 곳이에요.`} "여행"·"출장"은 고르지 마세요.`)
  }

  if (textHint?.length) {
    context.push(
      `- 휴대폰이 사진에서 읽은 글자: ${textHint.map((t) => `"${t}"`).join(', ')}`,
      '  → 현수막·간판·안내판의 글자일 수 있어요. 사진에서 실제로 보이는 것만 쓰고, 뜻이 통하지 않는 글자는 무시하세요. 사람 이름으로 쓰지 마세요.',
    )
  }

  return [
    '당신은 사진을 보고 가족에게 전할 짧은 기록을 써 주는 보조 AI입니다.',
    '사진을 찍은 분의 가족이 읽습니다. 세 가지를 작성하세요: activity(카테고리), memo(제목), scene(설명).',
    '',
    '공통 규칙:',
    '- 사진에 실제로 보이는 것만 쓰세요. 보이지 않는 일은 지어내지 마세요.',
    '- 쉬운 한국어 존댓말(~요)로 쓰세요.',
    '- 사람 이름, 관계(딸·친구 등), 건강·약·진단명은 추측하지 마세요.',
    '',
    '배경의 글자:',
    '- 현수막·간판·전광판·안내판이 보이면 적힌 글자를 읽고, 무엇이 적혀 있는지 담으세요 (행사 이름, 역 이름, 날짜 등).',
    '- 현수막이나 간판이 크게 찍혔다면 그것이 사진의 주제예요. memo(제목)에 그 내용을 넣으세요.',
    '- 외국어 문장은 뜻을 한국어로 옮겨 쓰세요 ("The biggest festival" → "가장 큰 축제"). 지명·역·가게·행사 이름은 원문 그대로 써도 돼요 ("Higashi Betsuin 역").',
    '- 또렷이 읽히는 한글·영어·숫자만 인용하세요. 일본어나 한자로 된 글자는 옮겨 적거나 번역하지 말고 "일본어 광고가 붙어 있어요"처럼만 쓰세요.',
    '- 상품·책·서비스를 알리는 광고판과 포스터는 현수막·안내판과 달라요. 내용을 옮기지 말고 "광고판이 보여요"라고만 쓰세요.',
    '',
    'memo (제목 한 줄, 12~22자):',
    '- 사진의 주제를 구체적으로 쓰세요: 무엇을, 어디에서.',
    '- 좋은 예: "공항 편의점에 들렀어요", "된장찌개로 점심 식사", "벚꽃 축제 현수막 앞에서"',
    '- 나쁜 예: "오늘의 한 순간을 담았어요", "즐거운 시간을 보내고 계세요" (무엇인지 알 수 없어요)',
    '',
    'scene (설명, 짧은 문장 2~3개):',
    '- 한 문장은 25자 이내. 한 문장에 한 가지 내용만.',
    '- 첫 문장은 무엇이 보이는지(현수막·간판 글자가 있으면 그것부터), 둘째 문장은 장소나 분위기, 셋째 문장(선택)은 눈에 띄는 한 가지.',
    '- 쉼표로 길게 이어 쓰거나 같은 꾸밈말을 반복하지 마세요.',
    '',
    'activity (정확히 하나):',
    '- 식사: 음식, 식당, 식탁',
    '- 카페: 커피, 차, 디저트, 카페나 푸드코트 테이블에 앉은 모습',
    '- 산책: 동네나 공원을 걷는 길',
    '- 여행: 집에서 멀리 떠난 관광지, 숙소, 낯선 도시',
    '- 출장: 집에서 멀리 떠나 회의실, 전시장, 사무 공간에서 일하는 모습',
    '- 이동: 공항, 역, 터미널, 차·기차·비행기 안, 여행 가방(캐리어)',
    '- 쇼핑: 상품이 진열된 가게, 시장, 마트, 편의점',
    '- 휴식: 집이나 실내에서 쉬는 모습',
    '- 모임: 여러 사람이 함께 있는 자리',
    '- 운동: 운동, 등산, 체육 시설',
    '- 자연: 꽃, 나무, 하늘, 바다, 풍경',
    '- 병원: 병원, 약국',
    '- 기타: 위 어느 것에도 맞지 않을 때만',
    '',
    '예시:',
    '- 식탁 위 찌개와 반찬 → {"activity":"식사","memo":"된장찌개로 점심 식사","scene":"식탁에 찌개와 반찬이 차려져 있어요. 집에서 드시는 점심이에요."}',
    '- 나무가 늘어선 공원길 → {"activity":"산책","memo":"나무가 우거진 공원 산책길","scene":"공원 길을 따라 나무가 늘어서 있어요. 햇살이 좋은 오후예요."}',
    '- 공항 안 편의점 진열대(집에서 900km, 지역: 도코나메시, 일본) → {"activity":"이동","memo":"나고야 공항 편의점에 들렀어요","scene":"공항 안 편의점이에요. 진열대에 간식이 가득해요. 일본 나고야에 도착하셨어요."}',
    '- 낯선 도시의 거리(집에서 900km, 지역: 나고야시, 일본) → {"activity":"여행","memo":"나고야 시내 거리 구경","scene":"일본 나고야의 거리예요. 간판이 늘어선 번화가예요."}',
    '- "제12회 진해 벚꽃 축제 4/1~4/10" 현수막 아래 셀카 → {"activity":"자연","memo":"진해 벚꽃 축제 현수막 앞에서","scene":"제12회 진해 벚꽃 축제를 알리는 현수막이 걸려 있어요. 4월 1일부터 10일까지 열린다고 적혀 있어요. 뒤로 벚나무가 보여요."}',
    '- 벽에 일본어 광고판이 붙은 곳에서 찍은 사진 → {"activity":"기타","memo":"일본어 광고판 앞에서","scene":"뒤에 일본어로 된 큰 광고판이 붙어 있어요. 실내에서 찍은 사진이에요."}',
    '- 사진이 흐려 알 수 없음 → {"activity":"기타","memo":"흐릿하게 찍힌 사진","scene":"사진이 흐려서 잘 보이지 않아요."}',
    '',
    '상황 정보 (참고용, 사진과 어긋나면 사진을 따르세요):',
    ...context,
    '',
    'JSON만 출력하세요. 다른 텍스트 금지:',
    '{"activity":"<카테고리>","memo":"<제목 한 줄>","scene":"<짧은 문장 2~3개>"}',
  ].join('\n')
}

/**
 * The part of a place label that is safe to tell the model: the area
 * ("센트럴시티, 서초구"), without the leading name. That name is whatever shop
 * or building the map has nearest the coordinates ("리김밥 · …"), and the
 * model takes it for what the photo shows ("김밥을 드시고 계세요").
 */
export function areaOf(place: string): string {
  const i = place.indexOf(' · ')
  return i >= 0 ? place.slice(i + 3) : place
}

const TEXT_HINT_MAX = 10

/**
 * The lines of on-phone OCR worth showing the model. Apple Vision is only
 * asked for Korean and English, so other scripts come back as noise
 * ("페CCC#아!!"); keep lines that are mostly letters and contain a real word.
 */
export function readableText(lines: string[] | undefined): string[] {
  const out: string[] = []
  for (const raw of lines ?? []) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (line.length < 3 || line.length > 60) continue
    const letters = (line.match(/[A-Za-z가-힣]/g) ?? []).length
    const clean = (line.match(/[A-Za-z가-힣0-9 .,&'/:~()-]/g) ?? []).length
    const hasWord = /[A-Za-z]{3,}|[가-힣]{2,}/.test(line)
    if (hasWord && letters / line.length >= 0.5 && clean / line.length >= 0.9 && !out.includes(line)) out.push(line)
    if (out.length === TEXT_HINT_MAX) break
  }
  return out
}

const MEMO_MAX = 40
const SCENE_MAX_SENTENCES = 3

/** One line, no stray quotes; an over-long title is cut at its first sentence. */
function tidyMemo(raw: string): string {
  let memo = raw.replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '')
  if (memo.length > MEMO_MAX) {
    const first = memo.match(/^.*?[.!?。]/)?.[0] ?? memo
    memo = first.length > MEMO_MAX ? `${first.slice(0, MEMO_MAX - 1)}…` : first
  }
  return memo
}

// Kana and Chinese characters. The model reads these badly and "translates"
// them into things the sign doesn't say, and the family can't read them.
const FOREIGN_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff]/

/** Collapse whitespace, drop sentences that copy Japanese/Chinese text, and
 *  keep at most three sentences. */
function tidyScene(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim()
  // A sentence ends where Korean text meets a full stop; a period inside a
  // quoted sign ("Sta.", "jejuair.com") is not an ending.
  const sentences = text.split(/(?<=[가-힣][.!?])\s+/)
  return sentences
    .filter((s) => !FOREIGN_SCRIPT.test(s))
    .slice(0, SCENE_MAX_SENTENCES)
    .map((s) => s.trim())
    .join(' ')
}

export function parseModelResponse(raw: string): { activity: string; memo: string; scene: string } | null {
  // Models occasionally wrap JSON in a code fence even with the
  // response-format hint.
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as { activity?: unknown; memo?: unknown; scene?: unknown }
    const activityRaw = typeof parsed.activity === 'string' ? parsed.activity.trim() : ''
    const memo = typeof parsed.memo === 'string' ? tidyMemo(parsed.memo) : ''
    // scene is optional in the response — when a model briefly drops it we
    // still accept the memo. The UI falls back to the title when it's empty.
    const scene = typeof parsed.scene === 'string' ? tidyScene(parsed.scene) : ''
    // A title quoting Japanese/Chinese text is rejected so the caller retries.
    if (!memo || FOREIGN_SCRIPT.test(memo)) return null
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

// Final-fallback stub, used when the local model fails repeatedly on a photo.
// It never claims to know what the photo shows: a neutral line, plus a
// category only when the phone's own Vision tags point at one.
export function stubActivity(tags?: VisionTags | null): { activity: string; memo: string; scene: string } {
  return { activity: categoryFromTags(tags), memo: '사진을 기록했어요.', scene: '' }
}

/**
 * A photo kept without a memo from the model (handlers/usage.ts). It reads as
 * a normal entry: nothing in it says a step was skipped.
 */
export function storedOnlyMemo(tags?: VisionTags | null): { activity: string; memo: string; scene: string } {
  return { activity: categoryFromTags(tags), memo: '사진을 남겼어요', scene: '' }
}

/**
 * Pick a coarse category from the phone's Vision tags (English
 * VNClassifyImageRequest names). Only used for the stub. Defaults to 기타.
 */
export function categoryFromTags(
  tags: VisionTags | null | undefined,
): string {
  if (!tags) return '기타'
  const names = tags.labels.map((l) => l.name.toLowerCase()).join(' ')
  if (/food|meal|dish|plate|bowl|fruit|vegetable/.test(names)) return '식사'
  if (/coffee|tea|drink|beverage|cup|dessert/.test(names)) return '카페'
  if (/luggage|suitcase|airport|airplane|train|vehicle|car_interior/.test(names)) return '이동'
  if (/flower|blossom|petal|bouquet|rose|tulip|sky|sea|ocean|mountain|landscape/.test(names)) return '자연'
  if (/park|tree|outdoor|street|walk|path|garden|trail|grass/.test(names)) return '산책'
  if (/sofa|bed|chair|tv|television|book|home interior|indoor/.test(names)) return '휴식'
  if (tags.faceCount >= 2) return '모임'
  return '기타'
}

// ────────────────────────────────────────────────────────────────────────────
// Digest: a few sentences about a day, a week or a month, from its memos.
// ────────────────────────────────────────────────────────────────────────────

export type DigestSpan = 'daily' | 'weekly' | 'monthly'

export interface DigestPromptArgs {
  span: DigestSpan
  /** One line per photo, oldest first: "09:40 산책 · 나무가 우거진 공원 산책길 · 서초동". */
  lines: string[]
}

/** Lines sent to the model; a long week or month is thinned evenly. */
export const DIGEST_MAX_LINES = 60

const SPAN_WORDS: Record<DigestSpan, { when: string; what: string }> = {
  daily: { when: '오늘', what: '하루' },
  weekly: { when: '이번 주에', what: '한 주' },
  monthly: { when: '지난달에', what: '한 달' },
}

function thin(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines
  return Array.from({ length: max }, (_, i) => lines[Math.floor((i * lines.length) / max)])
}

export function buildDigestPrompt({ span, lines }: DigestPromptArgs): string {
  const { when, what } = SPAN_WORDS[span]
  return [
    `아래는 부모님이 ${when} 찍은 사진마다 적어 둔 기록이에요. 이 기록만 보고, 가족에게 전할 ${what} 요약을 써 주세요.`,
    '',
    '규칙:',
    '- 2~3문장으로 쓰세요. 한 문장은 40자 이내.',
    '- 기록에 적힌 내용만 쓰세요. 적혀 있지 않은 일, 기분, 이유는 지어내지 마세요.',
    '- 쉬운 한국어 존댓말(~요)로, 부모님을 높여서 쓰세요 ("산책하셨어요", "드셨어요").',
    '- 사람 이름, 관계(딸·친구 등), 건강·약·진단명은 추측하지 마세요.',
    '- 시간 순서대로 쓰고, 비슷한 기록은 하나로 묶으세요.',
    '- 사진이 몇 장인지, "기록"이나 "사진"이라는 말은 쓰지 마세요.',
    '',
    '예시:',
    '{"summary":"오전에 공원을 산책하고 시장에 다녀오셨어요. 점심은 집에서 된장찌개를 드셨어요. 오후에는 카페에서 커피를 드시며 쉬셨어요."}',
    '',
    '기록:',
    ...thin(lines, DIGEST_MAX_LINES).map((l) => `- ${l}`),
    '',
    'JSON 형식 {"summary": "..."} 으로만 답하세요.',
  ].join('\n')
}

const SUMMARY_MAX = 300

/** The summary out of the model's JSON: one paragraph, at most three sentences. */
export function parseSummary(raw: string): string | null {
  let text: unknown
  try {
    text = (JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { summary?: unknown }).summary
  } catch {
    return null
  }
  if (typeof text !== 'string') return null
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  const sentences = flat.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [flat]
  const kept = sentences.slice(0, 3).join(' ')
  return kept.length > SUMMARY_MAX ? `${kept.slice(0, SUMMARY_MAX - 1)}…` : kept
}
