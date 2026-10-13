// Memo v2: two calls instead of one. see() reads the photo into plain facts
// at temperature 0; write() turns those facts, the day's context (context.ts)
// and the family's chosen style into the memo at a higher temperature. v1
// (prompt.ts buildPrompt) stays as it is: the fallback and the baseline.
// Nothing in here touches Firestore.

import {
  AD_BOARD_RULE,
  CATEGORY_LINES,
  FOREIGN_SCRIPT,
  JAPANESE_RULE_LOCAL,
  tidyMemo,
  tidyScene,
  VALID_CATEGORIES,
  type PromptHints,
} from './prompt.js'

// ── see(): the photo as facts ───────────────────────────────────────────────

/** What the vision model saw. Every word of the memo must trace back here or to a hook. */
export interface Seen {
  activity: string
  /** Up to three short Korean nouns: what the picture is of. */
  subjects: string[]
  /** One phrase for where / what kind of place. */
  setting: string
  /** Text actually readable in the photo (signs, banners); never ad copy. */
  signText: string[]
  peopleCount: number
}

export const SEE_SCHEMA = {
  type: 'object',
  properties: {
    activity: { type: 'string', enum: [...VALID_CATEGORIES] },
    subjects: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    setting: { type: 'string' },
    signText: { type: 'array', items: { type: 'string' } },
    peopleCount: { type: 'integer', minimum: 0 },
  },
  required: ['activity', 'subjects', 'setting', 'signText', 'peopleCount'],
}

/** The 상황 정보 lines v1 gives the model, reused word for word. */
export function contextLines({ timeHint, placeHint, homeHint, textHint, nearHint }: PromptHints): string[] {
  const lines = [
    `- 시간: ${timeHint || '알 수 없음'}`,
    `- 지역: ${placeHint ? (nearHint ? `${placeHint} 근처 (이 사진은 위치가 없어, 몇 분 안에 찍은 다른 사진의 위치예요)` : placeHint) : '알 수 없음'}`,
    '  → 지역 이름일 뿐이에요. 사진에 보이지 않는 가게·음식·물건을 지역 이름에서 지어내지 마세요.',
  ]
  if (homeHint?.away) {
    lines.push(
      homeHint.homeArea
        ? `- 집과의 거리: 집(${homeHint.homeArea})에서 약 ${homeHint.km}km 떨어진 곳이에요. 여행이나 출장 중일 가능성이 높아요.`
        : `- 집과의 거리: 집에서 약 ${homeHint.km}km 떨어진 곳이에요. 여행이나 출장 중일 가능성이 높아요.`,
      '  → 공항·역·차 안이면 "이동", 회의실·전시장처럼 일하는 모습이면 "출장", 식사·카페·쇼핑이 분명하면 그 카테고리, 그 밖에는 "여행"을 고르세요.',
      '  → 정장·넥타이·재킷 차림이거나 사원증·명찰(목걸이)을 걸고 있으면 "출장"일 가능성이 높아요.',
    )
  } else if (homeHint) {
    lines.push(`- 집과의 거리: ${homeHint.km < 2 ? '집 또는 집 근처예요.' : `집에서 약 ${homeHint.km}km 떨어진 곳이에요.`} "여행"·"출장"은 고르지 마세요.`)
  }
  if (textHint?.length) {
    lines.push(
      `- 휴대폰이 사진에서 읽은 글자: ${textHint.map((t) => `"${t}"`).join(', ')}`,
      '  → 현수막·간판·안내판의 글자일 수 있어요. 사진에서 실제로 보이는 것만 쓰고, 뜻이 통하지 않는 글자는 무시하세요. 사람 이름으로 쓰지 마세요.',
    )
  }
  return lines
}

export function buildSeePrompt(hints: PromptHints = {}): string {
  return [
    '당신은 사진을 보고 사실만 적는 보조 AI입니다. 글을 꾸미지 말고, 사진에 실제로 보이는 것만 JSON으로 적으세요.',
    '',
    '적을 것:',
    '- activity: 아래 목록에서 정확히 하나.',
    '- subjects: 사진의 주제가 되는 것 최대 3개. 짧은 한국어 명사로 ("된장찌개", "벚나무", "여행 가방").',
    '- setting: 어디인지, 어떤 자리인지 한 구절로 ("집 식탁", "공원 산책길", "공항 안 편의점").',
    '- signText: 현수막·간판·전광판·안내판에서 또렷이 읽히는 글자. 없으면 빈 배열.',
    '- peopleCount: 사진에 보이는 사람 수. 없으면 0.',
    '',
    '규칙:',
    '- 보이지 않는 것은 적지 마세요. 사람 이름, 관계, 건강 상태는 추측하지 마세요.',
    '- 지역 이름만 보고 가게·음식·물건을 지어내지 마세요.',
    JAPANESE_RULE_LOCAL,
    AD_BOARD_RULE.replace('"광고판이 보여요"라고만 쓰세요', 'subjects에 "광고판"이라고만 적고 signText에는 넣지 마세요'),
    '- 외국어 문장은 뜻을 한국어로 옮겨 적으세요. 지명·역·가게·행사 이름은 원문 그대로 둬도 돼요.',
    '',
    'activity (정확히 하나):',
    ...CATEGORY_LINES,
    '',
    '상황 정보 (참고용, 사진과 어긋나면 사진을 따르세요):',
    ...contextLines(hints),
    '',
    'JSON만 출력하세요. 다른 텍스트 금지:',
    '{"activity":"<카테고리>","subjects":["..."],"setting":"...","signText":["..."],"peopleCount":0}',
  ].join('\n')
}

const SUBJECTS_MAX = 3
const SIGN_MAX = 6
const SHORT_MAX = 40

const short = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, SHORT_MAX) : '')

/** The facts out of the model's JSON; null when there is no usable answer. */
export function parseSeeResponse(raw: string): Seen | null {
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    return null
  }
  const activityRaw = short(parsed.activity)
  const activity = (VALID_CATEGORIES as readonly string[]).includes(activityRaw) ? activityRaw : '기타'
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v.map(short).filter((s) => s && !FOREIGN_SCRIPT.test(s)) : []).slice(0, max)
  const subjects = list(parsed.subjects, SUBJECTS_MAX)
  const setting = short(parsed.setting)
  if (FOREIGN_SCRIPT.test(setting)) return null
  if (subjects.length === 0 && !setting) return null
  const n = Number(parsed.peopleCount)
  return {
    activity,
    subjects,
    setting,
    signText: list(parsed.signText, SIGN_MAX),
    peopleCount: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
  }
}

// write() follows in step 3.
export { tidyMemo, tidyScene }
