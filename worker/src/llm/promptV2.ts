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
  nearestPlaceLines,
  tidyMemo,
  tidyScene,
  VALID_CATEGORIES,
  type PromptHints,
} from './prompt.js'
import { momentLines } from './moment.js'

// ── see(): the photo as facts ───────────────────────────────────────────────

/** What the vision model saw. Every word of the memo must trace back here or to a hook. */
export interface Seen {
  activity: string
  /** Up to three short Korean nouns: what the picture is of. */
  subjects: string[]
  /** One phrase for where / what kind of place. */
  setting: string
  /** One plain sentence of what the picture shows, for the scene. */
  description: string
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
    description: { type: 'string' },
    signText: { type: 'array', items: { type: 'string' } },
    peopleCount: { type: 'integer', minimum: 0 },
  },
  required: ['activity', 'subjects', 'setting', 'description', 'signText', 'peopleCount'],
}

/** The 상황 정보 lines v1 gives the model (the when without the guessing), for see(). */
export function contextLines(hints: PromptHints): string[] {
  const { placeHint, homeHint, textHint, nearHint } = hints
  const lines = [
    ...momentLines(hints, { guess: false }),
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
    '- subjects: 사진의 주제가 되는 것 최대 3개. 짧은 한국어 명사로 ("된장찌개", "벚나무", "여행 가방"). 뒤에 우연히 찍힌 건물·차·상점처럼 뜻 없는 배경은 넣지 마세요.',
    '- setting: 어디인지, 어떤 자리인지 한 구절로 ("집 식탁", "공원 산책길", "공항 안 편의점").',
    '- description: 사진에 보이는 모습을 쉬운 한국어 한 문장(30자 이내)으로 ("식탁에 찌개와 반찬이 차려져 있어요").',
    '- signText: 현수막·간판·전광판·안내판·로고·상품에 적힌 글자를 보이는 그대로, 하나씩 모두 (영어·숫자도 그대로: "DAISO", "SMBC", "Higashi Betsuin"). 광고 문구 전체는 말고 이름·제목만. 없으면 빈 배열.',
    '  → 휴대폰이 읽은 글자(아래 상황 정보) 중 사진에서 실제로 보이는 것은 그대로 signText에 넣으세요.',
    '  → 현수막이나 간판이 크게 찍혔다면 그것이 사진의 주제예요: subjects 첫 자리에 "현수막"·"간판"을 두고, 적힌 글자를 signText에 넣으세요.',
    '- peopleCount: 사진에 보이는 사람 수. 없으면 0.',
    '',
    '규칙:',
    '- 보이지 않는 것은 적지 마세요. 사람 이름, 관계, 건강 상태는 추측하지 마세요.',
    '- 지역 이름만 보고 가게·음식·물건을 지어내지 마세요.',
    '- 노을·일출·밤 같은 시간대는 상황 정보의 찍은 때를 따르세요. 빛의 색만 보고 적지 마세요.',
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
    '{"activity":"<카테고리>","subjects":["..."],"setting":"...","description":"...","signText":["..."],"peopleCount":0}',
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
  const description = typeof parsed.description === 'string' ? parsed.description.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
  if (FOREIGN_SCRIPT.test(setting) || FOREIGN_SCRIPT.test(description)) return null
  if (subjects.length === 0 && !setting) return null
  const n = Number(parsed.peopleCount)
  return {
    activity,
    subjects,
    setting,
    description,
    signText: list(parsed.signText, SIGN_MAX),
    peopleCount: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
  }
}

// ── write(): the memo from the facts, one hook and a style ──────────────────

export type WriteStyle = 'plain' | 'warm' | 'playful'

/** Two examples per style; none of them the old "○○로 점심 식사" pattern. */
export const STYLE_EXAMPLES: Record<WriteStyle, { label: string; note: string; examples: string[] }> = {
  plain: { label: '담백하게', note: '있는 그대로, 꾸밈말 없이.', examples: ['공원 길을 걸으셨어요', '집에서 된장찌개를 드셨어요'] },
  warm: { label: '다정하게', note: '가족이 읽고 마음이 놓이게, 따뜻한 한마디를 얹어서.', examples: ['아침 볕을 맞으며 공원을 걸으셨어요', '따끈한 된장찌개로 든든하게 드셨어요'] },
  playful: { label: '재치있게', note: '가볍게 웃음이 나게, 놀리지는 말고.', examples: ['오늘 아침도 공원 산책 출석 완료', '된장찌개 앞에서 숟가락부터 드셨어요'] },
}

export interface WriteInput {
  seen: Seen
  /** The context pack's hooks, each with its id; the writer may use at most one. */
  hooks: { id: string; text: string }[]
  /** Titles the memo must not start like. */
  recentTitles: string[]
  style: WriteStyle
  hints?: Pick<PromptHints, 'timeHint' | 'placeHint' | 'homeHint' | 'dayHint' | 'sunHint' | 'todayHint' | 'placeFull' | 'weather'>
}

export const WRITE_SCHEMA = {
  type: 'object',
  // guess first: the writer reasons (facts + when + where → what the parent was doing) before the title.
  properties: { guess: { type: 'string' }, memo: { type: 'string' }, scene: { type: 'string' }, hookId: { type: 'string' } },
  required: ['guess', 'memo', 'scene', 'hookId'],
}

export function buildWritePrompt({ seen, hooks, recentTitles, style, hints = {} }: WriteInput): string {
  const st = STYLE_EXAMPLES[style] ?? STYLE_EXAMPLES.warm
  const where = [
    hints.placeHint ? `지역 ${hints.placeHint}` : '',
    hints.homeHint?.away
      ? `집에서 약 ${hints.homeHint.km}km 떨어진 곳 (여행이나 출장 중)`
      : hints.homeHint ? (hints.homeHint.km < 2 ? '집 또는 집 근처' : `집에서 약 ${hints.homeHint.km}km`) : '',
  ].filter(Boolean).join(' · ')
  return [
    '당신은 부모님이 찍은 사진 한 장으로, 그 순간 부모님이 무엇을 하고 계셨는지 가족에게 알려 주는 짧은 기록을 쓰는 보조 AI입니다.',
    '사진은 이미 다른 AI가 보고 아래 "사실"로 적어 두었어요. 풍경을 묘사하지 말고, 사실·찍은 때·장소·오늘 앞선 사진을 엮어 "이때 무엇을 하고 계셨을지" 가장 그럴듯하게 짐작해 쓰세요.',
    '',
    '사실 (사진에서 본 것):',
    // 기타 is the category for "none of the above"; written out, the model reads it as a guitar.
    `- 활동: ${seen.activity === '기타' ? '(정해진 분류 없음)' : seen.activity}`,
    `- 보이는 것: ${seen.subjects.length ? seen.subjects.join(', ') : '(없음)'}`,
    `- 장소: ${seen.setting || '(알 수 없음)'}`,
    ...(seen.description ? [`- 모습: ${seen.description}`] : []),
    `- 읽히는 글자: ${seen.signText.length ? seen.signText.map((t) => `"${t}"`).join(', ') : '(없음)'}`,
    `- 사람: ${seen.peopleCount}명`,
    ...(where ? [`- 곳: ${where}`] : []),
    ...nearestPlaceLines(hints.placeFull),
    '',
    '때와 흐름 (찍은 때는 사실이에요):',
    ...momentLines(hints),
    '',
    '이야기 (덧붙일 수 있는 것 — 최대 하나만, 자연스럽게 어울릴 때만. 쓰면 그 id를 hookId에 적고, 안 쓰면 hookId는 빈 문자열):',
    ...(hooks.length ? hooks.map((h) => `- [${h.id}] ${h.text}`) : ['- (없음)']),
    '',
    'guess (먼저 쓰세요, 한 줄): 보이는 것 + 찍은 때 + 곳 + 앞선 사진 → 그때 하고 계셨을 일.',
    '- 예: "공원길·나무 + 월요일 아침 7시 + 집 근처 → 아침 산책 중"',
    '- 예: "탑승구 + 오전 + 집에서 900km, 앞서 공항 도착 → 탑승을 기다리는 중"',
    '',
    '규칙:',
    '- 사실과 이야기 목록에 없는 물건·음식·가게·숫자·지명은 지어내지 마세요. 하지만 무엇을 하고 계셨는지는 위 단서를 엮어 짐작해 써도 돼요.',
    '- 단서가 약하면 확실한 행동으로 쓰세요: "길가의 꽃을 찍으셨어요", "창밖을 보셨어요".',
    '- 아침·점심·저녁·밤, 노을·일출은 "때와 흐름"을 따르세요. 아침 사진에 노을·석양·저녁이라고 쓰면 틀린 거예요.',
    '- 사람 이름, 관계(가족·딸·친구 등), 건강·약·진단명은 추측하지 마세요. 사람이 여럿이어도 누구인지는 모르는 거예요 ("일행과 함께"라고 쓰세요).',
    '- "시간을 보내셨어요"처럼 무엇을 하셨는지 알 수 없는 말은 쓰지 마세요.',
    '- 사진을 찍은 분을 "남자분"·"여자분"·"남성"·"여성"·"어르신"이라 부르지 마세요. 주어 없이 "~하셨어요"로 쓰세요.',
    '- 기분이나 감상을 덧붙이지 마세요 ("즐거운 하루였어요", "잘 지내고 계세요", "시간이 흐르네요" 같은 말 금지). 말투는 단어 고르기로만 살리세요.',
    '- 쉬운 한국어 존댓말(~요)로, 사진을 찍은 분을 높여서 쓰세요.',
    '- memo: 한 줄, 12~24자. 부모님이 그때 하신 일이 드러나고, 동사로 끝나요 ("걸으셨어요", "드셨어요", "들르셨어요", "기다리는 중이에요"). 따옴표 없이.',
    '- 읽히는 글자에 가게·역·행사 이름이 있으면 제목에 그 이름을 그대로 넣으세요 ("DAISO 매장에 들르셨어요", "Higashi Betsuin 역에서 내리셨어요").',
    '- "…모습", "…풍경", "…셀카", "…사진이에요"처럼 사진을 설명하는 말로 끝내지 마세요.',
    '- 이야기를 쓰기로 했다면 그 내용이 제목이나 설명에 실제로 드러나야 해요. 드러나지 않으면 hookId는 빈 문자열.',
    '- 명소·관광지나 일부러 배경으로 담은 곳이면 그 이름을 제목 맨 앞에 두고 "!"로 끝내세요 ("불국사에 다녀오셨어요!"). 명소가 아니면 "!"를 쓰지 마세요.',
    '- scene: 그날을 기억하게 하는 한 줄 일기 (1문장, 많아야 2문장, 50자 이내). 기억의 고리 1~2개(날씨·기온의 실제 값, 요일·명절, 시간대, 여행지, 앞선 사진과의 흐름) + 하신 일 ("맑고 따뜻한 일요일, 점심을 드시고 나와 일행과 기념사진을 남기셨어요"). 제목을 되풀이하지 마세요.',
    '- 날씨는 "때와 흐름"의 실제 값만 쓰세요. 값이 없으면 날씨를 쓰지 마세요.',
    '- 물건을 나열하거나 묘사하는 문장 금지: "식탁 위에 물잔이 놓여 있어요", "나무가 늘어서 있어요", "뒤로 상점들이 보여요", "흰색 차가 주차되어 있어요". "~가 놓여 있어요", "~가 보여요"로 끝나는 문장은 쓰지 않아요.',
    ...(recentTitles.length ? [`- 최근 제목과 같은 식으로 시작하지 마세요: ${recentTitles.map((t) => `"${t}"`).join(', ')}`] : []),
    '',
    `말투 (${st.label}): ${st.note}`,
    ...st.examples.map((e) => `- 예: "${e}"`),
    '',
    'JSON만 출력하세요. 다른 텍스트 금지:',
    '{"guess":"<단서 → 하고 계셨을 일>","memo":"<제목 한 줄>","scene":"<짧은 문장 2~3개>","hookId":"<쓴 이야기의 id, 없으면 빈 문자열>"}',
  ].join('\n')
}

export interface Written {
  memo: string
  scene: string
  hookId: string | null
  /** The writer's one-line reasoning; not stored. */
  guess?: string
}

/** The memo out of the writer's JSON; null when unusable (no title, or a foreign script in it). */
export function parseWriteResponse(raw: string): Written | null {
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    return null
  }
  const memo = typeof parsed.memo === 'string' ? tidyMemo(parsed.memo) : ''
  if (!memo || FOREIGN_SCRIPT.test(memo)) return null
  const scene = typeof parsed.scene === 'string' ? tidyScene(parsed.scene) : ''
  // The model sometimes echoes the id in brackets or template braces: [nth], ${streak}, {{today}}.
  const id = typeof parsed.hookId === 'string' ? (parsed.hookId.match(/[a-z]+/i)?.[0] ?? '') : ''
  const hookId = id && !/^(null|none|없음)$/i.test(id) ? id : null
  const guess = typeof parsed.guess === 'string' ? parsed.guess.replace(/\s+/g, ' ').trim().slice(0, 160) : ''
  return guess ? { memo, scene, hookId, guess } : { memo, scene, hookId }
}
