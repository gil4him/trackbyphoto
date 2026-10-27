// Memo prompt, response parsing, deterministic stub, and tag → category
// heuristic for the local vision model.

import { momentLines } from './moment.js'

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
  /** homeArea: home's area name, only when away. */
  homeHint?: { km: number; away: boolean; homeArea?: string }
  /** Text the phone read in the photo (see readableText). */
  textHint?: string[]
  /** The place hint came from another photo taken within minutes, not from
   *  this one (it had no location). */
  nearHint?: boolean
  /** Cloud prompt only: the whole place label, nearest shop or building
   *  included ("くら寿司 · 니시신주쿠, 신주쿠구"), and the coordinates. */
  placeFull?: string
  coords?: { lat: number; lng: number }
  /** memoDiary flag: scene is a short diary entry (3–5 sentences) that opens
   *  with dateHint and the area, instead of 2–3 descriptive sentences. */
  diary?: boolean
  /** "10월 18일 오후" on the photographer's clock (travel.ts localDateHint). */
  dateHint?: string
  /** Day of the week on the photographer's calendar, with the holiday when
   *  there is one ("월요일", "추석 목요일"). See llm/moment.ts. */
  dayHint?: string
  /** Sunrise and sunset that day at that spot, HH:MM on the same clock. */
  sunHint?: { rise: string; set: string }
  /** Earlier photos today, oldest first: "06:20 · 이동 · 공항에 도착하셨어요 · 중구". */
  todayHint?: string[]
  /** The weather there that hour, from WeatherKit (weather.ts); never guessed. */
  weather?: import('../weather.js').Weather
  /** The parent's language (users/{patientUid}.geoLang, travel.ts
   *  resolveGeoLang). 'en' writes the whole prompt — rules, examples and
   *  context lines — in English (buildPromptEn); anything else keeps the
   *  Korean prompt exactly as it was. `activity` stays a Korean category
   *  word in both. */
  lang?: PromptLang
}

/** The language of a memo's text. Place names already use the same two
 *  values (geocode.ts GeoLang). */
export type PromptLang = 'ko' | 'en'

/** 'cloud' is the prompt for Gemini, which reads Japanese and knows places;
 *  the local model keeps the stricter one. */
export type PromptVariant = 'local' | 'cloud'

export const JAPANESE_RULE_LOCAL = '- 또렷이 읽히는 한글·영어·숫자만 인용하세요. 일본어나 한자로 된 글자는 옮겨 적거나 번역하지 말고 "일본어 광고가 붙어 있어요"처럼만 쓰세요.'
const JAPANESE_RULE_CLOUD = '- 일본어·한자 간판과 안내판도 읽을 수 있으면 뜻을 한국어로 옮기세요. 역·가게·지명은 한국어 발음으로 쓰세요 ("新宿駅" → "신주쿠역").'
/** Cloud only: one Korean spelling for a foreign shop name, so the same place
 *  doesn't read "Han Yang Restaurant" in one memo and "한양식당" in the next. */
const SHOP_NAME_RULE_CLOUD = '- 영어 가게·식당 이름은 가족이 읽기 쉽게 한글로 쓰세요 ("Han Yang Restaurant" → "한양식당", "Costco" → "코스트코"). 한글 간판이 있으면 그 이름 그대로.'

// The model writes four things per photo:
//   guess     its reasoning, one line: photo + time + place + earlier photos
//             → what the parent was most likely doing (not stored)
//   activity  one category word
//   memo      the subject line: what the parent did, ending in a verb
//   scene     2–3 short, plain sentences for the detail page
// The memo is about the parent's moment, not a description of the picture:
// objects, food and shops must still be visible (or in the hints), but what
// the parent was doing is a best guess from everything known.
export const AD_BOARD_RULE = '- 상품·책·서비스를 알리는 광고판과 포스터는 현수막·안내판과 달라요. 내용을 옮기지 말고 "광고판이 보여요"라고만 쓰세요.'

/** The 13 categories with the one-line description the model gets for each (v1 and v2 share them). */
export const CATEGORY_LINES = [
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
]

// memoDiary: the scene is a short diary entry for the moment. It describes
// the moment, never speaks as the photographer (no 나/저) and names nobody.
// Its warmth comes from what is visible; smells, tastes and feelings can't
// be seen, so they are not written. The opening "10월 18일 오후, 강남에서."
// is put on in code (diaryScene): asked to write it, gemma4:e4b left it out
// on 12 of 16 real photos.
const DIARY_SCENE_LINES = [
  'scene (그 순간의 짧은 일기, 3~4문장):',
  '- 날짜와 지역은 앱이 맨 앞에 붙여요. scene에는 날짜·지역을 쓰지 말고, 사진에 보이는 것부터 바로 쓰세요.',
  '- "~에서 찍은 사진이에요"로 시작하지 마세요. 무엇이 보이는지로 시작하세요 (현수막·간판 글자가 있으면 그것부터).',
  '- 가운데 문장들은 사진에 보이는 것: 무엇이, 어디에, 어떤 모습인지.',
  '- 마지막 문장은 보이는 것에서 나오는 따뜻한 한 줄로 끝내도 좋아요 ("든든하고 따뜻한 한 끼예요").',
  '- 한 문장은 40자 이내. 쉼표로 길게 이어 쓰거나 같은 꾸밈말을 반복하지 마세요.',
  '- "나", "저", "제가" 같은 1인칭으로 쓰지 마세요. 사진을 찍은 분이 쓴 글처럼 쓰지 말고, 그 순간을 담담하게 적어 주세요.',
  '- 냄새, 맛, 소리, 기분처럼 사진으로 알 수 없는 것은 쓰지 마세요 ("향이 가득해요", "맛있게 드셨어요", "즐거우셨어요" 금지).',
  '- 사진이 흐리거나 무엇인지 알 수 없으면 1문장만 쓰세요.',
]

const DIARY_EXAMPLES = [
  '- 식탁 위 돌솥밥과 반찬 → {"activity":"식사","memo":"곤드레돌솥밥으로 점심","scene":"김이 오르는 돌솥 한 그릇이 식탁에 놓여 있어요. 반찬도 정갈하게 차려져 있어요. 든든하고 따뜻한 한 끼예요."}',
  '- 나무가 늘어선 공원길 → {"activity":"산책","memo":"나무가 우거진 공원 산책길","scene":"길을 따라 나무가 늘어서 있어요. 나뭇잎 사이로 햇살이 비쳐요. 천천히 걷기 좋은 길이에요."}',
  '- 공항 안 편의점 진열대(집에서 900km, 지역: 도코나메시, 일본) → {"activity":"이동","memo":"나고야 공항 편의점에 들렀어요","scene":"공항 안 편의점에 들르셨어요. 진열대에 간식이 가득 놓여 있어요. 일본 나고야에서의 먼 길이 시작됐어요."}',
  '- 차 안에서 두 분이 웃으며 찍은 셀카 → {"activity":"이동","memo":"차 안에서 함께 찍은 사진","scene":"차 안에서 두 분이 카메라를 보며 웃고 있어요. 창으로 햇빛이 들어와요. 함께 가는 길이 환해 보여요."}',
  '- "제12회 진해 벚꽃 축제 4/1~4/10" 현수막 아래 셀카 → {"activity":"자연","memo":"진해 벚꽃 축제 현수막 앞에서","scene":"제12회 진해 벚꽃 축제를 알리는 현수막이 걸려 있어요. 4월 1일부터 10일까지 열린다고 적혀 있어요. 뒤로 벚나무가 보여요."}',
  '- 벽에 일본어 광고판이 붙은 실내 → {"activity":"기타","memo":"일본어 광고판 앞에서","scene":"뒤에 일본어로 된 큰 광고판이 붙어 있어요. 실내의 밝은 조명 아래예요."}',
  '- 사진이 흐려 알 수 없음 → {"activity":"기타","memo":"흐릿하게 찍힌 사진","scene":"사진이 흐려서 잘 보이지 않아요."}',
]

/** The diary's opening, built in code so it is always there and right:
 *  "10월 18일 오후, 잠실동에서." from the date hint and the area's first part. */
export function diaryOpener(dateHint?: string, placeHint?: string, lang: PromptLang = 'ko'): string {
  const area = (placeHint || '').split(',')[0].trim()
  if (lang === 'en') {
    // "October 18, afternoon, in Jamsil." (dateHint from travel.ts dateHintAt).
    if (dateHint && area) return `${dateHint}, in ${area}.`
    if (dateHint) return `${dateHint}.`
    return area ? `In ${area}.` : ''
  }
  if (dateHint && area) return `${dateHint}, ${area}에서.`
  if (dateHint) return `${dateHint}.`
  return area ? `${area}에서.` : ''
}

/** A diary scene as stored: the opener, then what the model wrote. */
export function diaryScene(scene: string, hints: Pick<PromptHints, 'dateHint' | 'placeHint' | 'lang'>): string {
  const opener = diaryOpener(hints.dateHint, hints.placeHint, hints.lang)
  return [opener, scene].filter(Boolean).join(' ')
}

/**
 * The nearest shop or building on the map ("Han Yang Restaurant · Buena Park,
 * 미국"), as a clue to what the parent was doing there: lunchtime in front of
 * a restaurant is lunch. Framed as a GPS guess, never as what the photo shows,
 * and the model may not invent its menu or goods (the old failure: "리김밥" →
 * "김밥을 드시고 계세요"). The local model reads no Japanese, so a name in
 * kana or kanji is left out for it.
 */
export function nearestPlaceLines(placeFull: string | undefined, variant: PromptVariant = 'local', lang: PromptLang = 'ko'): string[] {
  if (!placeFull || !placeFull.includes(' · ')) return []
  if (variant === 'local' && FOREIGN_SCRIPT.test(placeFull)) return []
  if (lang === 'en') {
    return [
      `- Nearest place on the map: ${placeFull}`,
      '  → This is the nearest shop or building GPS could find. It can be tens of meters off.',
      '  → When the photo (a shopfront, a sign, the inside of a shop, food) and the time fit this place, they went there. Put its name in the title (in front of a restaurant at lunchtime → "Lunch at ○○").',
      '  → Never invent this place\'s menu, goods or food when they are not in the photo. When a sign in the photo says somewhere else, follow the photo.',
    ]
  }
  return [
    `- 지도에서 가장 가까운 곳: ${placeFull}`,
    '  → GPS로 찾은 가장 가까운 가게·건물이에요. 수십 m 오차가 있을 수 있어요.',
    '  → 사진(건물 앞, 간판, 가게 안, 음식)과 찍은 때가 이곳과 맞으면 이곳에 가신 거예요. 이름을 제목에 넣으세요 (점심때 식당 앞 → "○○에 점심 드시러 가셨어요").',
    '  → 이곳의 메뉴·상품·음식은 사진에 보이지 않으면 지어내지 마세요. 사진 속 간판이 다른 곳이면 사진을 따르세요.',
  ]
}

export function buildPrompt(hints: PromptHints = {}, variant: PromptVariant = 'local'): string {
  // English families get the same memory diary in English; everyone else the
  // Korean prompt below, unchanged.
  if (hints.lang === 'en') return buildPromptEn(hints, variant)
  const { placeHint, homeHint, textHint, nearHint, placeFull, coords, diary } = hints
  const cloud = variant === 'cloud'
  const context = [
    ...momentLines(hints),
    `- 지역: ${placeHint ? (nearHint ? `${placeHint} 근처 (이 사진은 위치가 없어, 몇 분 안에 찍은 다른 사진의 위치예요)` : placeHint) : '알 수 없음'}`,
    '  → 지역 이름일 뿐이에요. 사진에 보이지 않는 가게·음식·물건을 지역 이름에서 지어내지 마세요.',
  ]
  if (homeHint?.away) {
    context.push(
      homeHint.homeArea
        ? `- 집과의 거리: 집(${homeHint.homeArea})에서 약 ${homeHint.km}km 떨어진 곳이에요. 여행이나 출장 중일 가능성이 높아요.`
        : `- 집과의 거리: 집에서 약 ${homeHint.km}km 떨어진 곳이에요. 여행이나 출장 중일 가능성이 높아요.`,
      ...(homeHint.homeArea ? [`  → 집은 ${homeHint.homeArea}, 지금은 다른 지역이에요. 일하는 모습이면 "출장", 구경하는 모습이면 "여행"이에요.`] : []),
      '  → 공항·역·차 안이면 "이동", 회의실·전시장처럼 일하는 모습이면 "출장", 식사·카페·쇼핑이 분명하면 그 카테고리, 그 밖에는 "여행"을 고르세요.',
      '  → 정장·넥타이·재킷 차림이거나 사원증·명찰(목걸이)을 걸고 있으면 "출장"일 가능성이 높아요.',
      '  → 사람이 안 보여도 노트북·서류가 놓인 책상, 사무실처럼 일하는 공간이면 "출장"을 고르세요.',
      '  → memo나 scene에 지명(도시 이름)을 자연스럽게 한 번 넣으세요.',
    )
  } else if (homeHint) {
    context.push(`- 집과의 거리: ${homeHint.km < 2 ? '집 또는 집 근처예요.' : `집에서 약 ${homeHint.km}km 떨어진 곳이에요.`} "여행"·"출장"은 고르지 마세요.`)
  }

  if (!nearHint) context.push(...nearestPlaceLines(placeFull, variant))
  if (cloud && coords) {
    context.push(
      `- 좌표: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
      '  → 이 좌표 근처의 유명한 역·거리·명소를 알고 있고 사진과 맞으면 이름을 넣어 구체적으로 쓰세요.',
    )
  }
  if (textHint?.length) {
    context.push(
      `- 휴대폰이 사진에서 읽은 글자: ${textHint.map((t) => `"${t}"`).join(', ')}`,
      '  → 현수막·간판·안내판의 글자일 수 있어요. 사진에서 실제로 보이는 것만 쓰고, 뜻이 통하지 않는 글자는 무시하세요. 사람 이름으로 쓰지 마세요.',
    )
  }

  return [
    '당신은 부모님이 휴대폰으로 찍은 사진 한 장을 보고, 그 순간 부모님이 무엇을 하고 계셨는지 가족에게 알려 주는 보조 AI입니다.',
    '사진은 부모님이 직접 찍었어요. 풍경을 묘사하는 글이 아니라, 사진·찍은 때·장소·오늘 앞선 사진을 모두 엮어 "이때 무엇을 하고 계셨을지" 가장 그럴듯하게 짐작해 쓰는 글이에요.',
    '네 가지를 작성하세요: guess(짐작), activity(카테고리), memo(제목), scene(설명).',
    '',
    'guess (먼저 쓰세요, 한 줄):',
    '- 보이는 것 + 찍은 때 + 장소(집 근처인지, 멀리 왔는지) + 오늘 앞선 사진 → 그때 하고 계셨을 일.',
    '- 예: "공원길·나무 + 월요일 아침 7시 + 집 근처 → 아침 산책 중"',
    '- 예: "식탁 위 칼국수 + 점심때 + 시내 식당가 → 점심 식사"',
    '- 예: "탑승구·비행기 + 오전 + 집에서 900km, 앞서 공항 도착 → 탑승을 기다리는 중"',
    '',
    '공통 규칙:',
    '- 사진에 없는 물건·음식·가게·사람을 지어내지 마세요. 하지만 부모님이 무엇을 하고 계셨는지는 위 단서를 엮어 짐작해 써도 돼요.',
    '- 단서가 약하면 확실한 행동으로 쓰세요: "길가의 꽃을 찍으셨어요", "창밖을 보셨어요". 사진을 찍으셨다는 것은 언제나 사실이에요.',
    '- 찍은 때(아침·점심·저녁·밤, 노을·일출)는 아래 상황 정보가 정답이에요. 사진의 빛이나 색만 보고 시간대를 바꾸지 마세요.',
    '- 쉬운 한국어 존댓말(~요)로, 부모님을 높여서 쓰세요. 주어("어르신", "남성분" 등) 없이 "~하셨어요"로 쓰세요.',
    '- 사람 이름, 관계(가족·딸·친구 등), 건강·약·진단명은 추측하지 마세요. 여러 사람이 함께면 "일행과 함께"라고 쓰세요.',
    '- "아름다운", "평화로운", "여유로운" 같은 꾸밈말이나 기분·감상을 덧붙이지 마세요.',
    '- 가게·건물 이름은 사진에서 읽히거나 아래 상황 정보에 있을 때만 쓰세요.',
    ...(cloud ? ['- 좌표로 아는 지역·역·거리 이름은 써도 돼요.'] : []),
    '',
    '배경의 글자:',
    '- 현수막·간판·전광판·안내판이 보이면 적힌 글자를 읽고 활용하세요 (행사 이름, 역 이름, 가게 이름 등).',
    '- 현수막이나 간판이 크게 찍혔다면 그곳에 가신 거예요. 하신 일과 함께 제목에 넣으세요 ("진해 벚꽃 축제에 가셨어요").',
    '- 외국어 문장은 뜻을 한국어로 옮겨 쓰세요 ("The biggest festival" → "가장 큰 축제"). 지명·역·가게·행사 이름은 원문 그대로 써도 돼요 ("Higashi Betsuin 역").',
    cloud ? JAPANESE_RULE_CLOUD : JAPANESE_RULE_LOCAL,
    ...(cloud ? [SHOP_NAME_RULE_CLOUD] : []),
    AD_BOARD_RULE,
    '',
    'memo (제목 한 줄, 12~24자) — 하신 일 + 장소:',
    '- 부모님이 그때 하신 일과 장소를 쓰세요. 동사로 끝나요 ("~하셨어요", "~드셨어요", "~다녀오셨어요").',
    '- 명소·관광지, 또는 일부러 배경으로 담은 곳(이름난 건물·풍경·조형물)이 보이면 그 이름을 맨 앞에 두고 반갑게 "!"로 끝내세요: "불국사에 다녀오셨어요!", "해운대 바다를 보러 가셨어요!". 명소가 아니면 "!"를 쓰지 마세요.',
    '- 메뉴판·그릇·간판에서 음식이나 가게 이름이 읽히면 넣으세요 ("한양식당에서 곤드레돌솥밥을 드셨어요").',
    '- 좋은 예: "아침 일찍 동네 공원을 걸으셨어요", "점심으로 칼국수를 드셨어요", "공항에서 탑승을 기다리셨어요"',
    '- 나쁜 예: "나무가 우거진 공원 산책길" (하신 일이 없어요), "아름다운 노을 풍경" (사진 묘사예요), "오늘의 한 순간", "시간을 보내셨어요" (무엇을 하셨는지 알 수 없어요)',
    '',
    ...(diary ? DIARY_SCENE_LINES : [
      'scene (그날을 기억하게 하는 한 줄 일기, 1문장 · 많아야 2문장 · 50자 이내):',
      '- 기억의 고리 1~2개 + 하신 일을 자연스럽게 한 문장으로 쓰세요. 기억의 고리: 날씨·기온(상황 정보의 실제 값), 요일·명절·특별한 날, 시간대, 집에서 먼 여행지, 오늘 앞선 사진과의 흐름.',
      '- 예: "맑고 따뜻한 일요일, 점심을 드시고 나와 일행과 기념사진을 남기셨어요." / "비가 내리는 쌀쌀한 월요일 아침, 우산을 쓰고 출근길에 나서셨어요."',
      '- 제목을 그대로 되풀이하지 말고, 제목에 없는 그날의 맥락을 더하세요.',
      '- 사진 묘사는 명소나 일부러 담은 배경일 때만 짧게 쓰세요 ("다보탑 앞에서"). 물건·배경을 나열하는 문장은 금지예요: "식탁 위에 물잔이 놓여 있어요", "나무가 늘어서 있어요", "뒤로 상점들이 보여요", "흰색 차가 주차되어 있어요". "~가 놓여 있어요", "~가 보여요"로 끝나는 문장은 쓰지 않아요.',
      '- 날씨는 상황 정보의 실제 값만 쓰세요. 값이 없으면 날씨를 쓰지 말고, 사진의 빛이나 하늘을 보고 날씨를 짐작하지 마세요.',
      '- 기분·감상("즐거운", "맛있는", "행복한", "예쁜")은 지어내지 마세요. 하신 일을 꾸미는 말("편안하게", "여유롭게", "즐겁게", "맛있게")도 쓰지 마세요.',
    ]),
    '',
    'activity (정확히 하나, 하고 계셨던 일 기준):',
    ...CATEGORY_LINES,
    '',
    '예시:',
    ...(diary ? DIARY_EXAMPLES : [
      '- 식탁 위 찌개와 반찬, 화요일 12:20, 비 9°C, 집 → {"guess":"찌개와 반찬 + 점심때 + 집 → 집에서 점심 식사","activity":"식사","memo":"집에서 된장찌개로 점심을 드셨어요","scene":"비가 내리는 쌀쌀한 화요일, 집에서 따끈하게 점심을 드셨어요."}',
      '- 나무가 늘어선 공원길, 월요일 07:10, 맑음 17°C, 집에서 1km → {"guess":"공원길 + 이른 아침 + 집 근처 → 아침 산책","activity":"산책","memo":"아침 일찍 동네 공원을 걸으셨어요","scene":"맑고 선선한 월요일 아침, 하루를 시작하며 공원을 한 바퀴 걸으셨어요."}',
      '- 식당 안, 돌솥밥과 "곤드레돌솥" 메뉴, 일요일 13:10, 맑음 24°C, 가장 가까운 곳: 한양식당 → {"guess":"돌솥밥 + 메뉴판 + 일요일 점심 + 한양식당 → 일행과 점심 식사","activity":"식사","memo":"한양식당에서 곤드레돌솥밥을 드셨어요","scene":"맑고 따뜻한 일요일 점심, 일행과 함께 식사하셨어요."}',
      '- 식당 건물 앞에 여러 사람, 일요일 13:40, 맑음 24°C, 앞선 사진: 13:00 한양식당에서 식사 → {"guess":"식당 앞 + 점심 직후 + 앞서 식사 → 식사를 마치고 나와 기념사진","activity":"모임","memo":"한양식당에서 점심 드시고 사진을 남기셨어요","scene":"맑고 따뜻한 일요일, 점심을 드시고 나와 일행과 기념사진을 찍으셨어요."}',
      '- 다보탑 앞 셀카, 토요일 10:20, 맑음 16°C, 집에서 300km(지역: 경주시) → {"guess":"다보탑 + 경주 + 집에서 멀리 → 불국사 여행","activity":"여행","memo":"불국사에 다녀오셨어요!","scene":"선선한 가을 토요일 아침, 경주 불국사 다보탑 앞에서 사진을 남기셨어요."}',
      '- 공항 안 편의점, 금요일 10:40, 날씨 알 수 없음, 집에서 900km(지역: 도코나메시, 일본) → {"guess":"공항 편의점 + 오전 + 일본 나고야 → 도착해서 간식을 고름","activity":"이동","memo":"나고야 공항 편의점에 들르셨어요","scene":"금요일 오전, 일본 나고야에 도착해 공항에서 간식을 고르셨어요."}',
      '- 단서가 거의 없는 실내 사진, 수요일 15:00 → {"guess":"실내, 단서 부족 → 실내에서 사진을 찍으심","activity":"기타","memo":"실내에서 사진을 찍으셨어요","scene":"수요일 오후, 실내에서 사진 한 장을 남기셨어요."}',
      '- 사진이 흐려 알 수 없음 → {"guess":"흐려서 단서 없음","activity":"기타","memo":"흐릿하게 찍힌 사진","scene":"사진이 흐려서 잘 보이지 않아요."}',
    ]),
    '',
    '상황 정보 (찍은 때는 사실, 나머지는 참고용 — 보이는 것이 어긋나면 사진을 따르세요):',
    ...context,
    '',
    'JSON만 출력하세요. 다른 텍스트 금지:',
    '{"guess":"<단서 → 하고 계셨을 일>","activity":"<카테고리>","memo":"<제목 한 줄>","scene":"<그날을 기억하게 하는 한 줄 일기>"}',
  ].join('\n')
}

// ────────────────────────────────────────────────────────────────────────────
// The English prompt (lang: 'en'), for a family whose language is English
// (users/{patientUid}.geoLang === 'en', travel.ts resolveGeoLang).
//
// Same memory diary as the Korean prompt, rule for rule, in English: only
// memo (the title) and scene (the one-line diary) are English. `activity`
// stays one of the Korean words in VALID_CATEGORIES, because the app maps
// those keys to its own styles and English labels — so the model is told to
// copy the Korean word exactly and never translate it.
//
// The tone is the CEO's (CLAUDE.md, 2026-10-27); changing it needs the CEO's
// approval, exactly like the Korean prompt.
// ────────────────────────────────────────────────────────────────────────────

export const JAPANESE_RULE_LOCAL_EN = '- Quote only letters you can read clearly in the Latin alphabet, in Korean, or numbers. Never transcribe or translate Japanese or Chinese characters; say only that they are there ("a sign in Japanese is on the wall").'
const JAPANESE_RULE_CLOUD_EN = '- You may read Japanese and Chinese signs and notices and give their meaning in English. Write stations, shops and place names in the Latin alphabet ("新宿駅" → "Shinjuku Station").'
/** Cloud only: one spelling for a shop name, so the same place does not read
 *  "한양식당" in one memo and "Hanyang Restaurant" in the next. */
const SHOP_NAME_RULE_CLOUD_EN = '- Write shop and restaurant names in the Latin alphabet so the family can read them ("한양식당" → "Hanyang Restaurant", "코스트코" → "Costco"). Keep the name on the sign when it is already in the Latin alphabet.'
export const AD_BOARD_RULE_EN = '- An advertising board or poster for a product, a book or a service is not the same as a banner or a notice. Do not pass on what it says; write only "an advertising board is up".'

/** The 13 categories: the Korean key the app stores, with an English gloss. */
export const CATEGORY_LINES_EN = [
  '- 식사 (a meal): food, a restaurant, a dining table',
  '- 카페 (a cafe): coffee, tea, dessert, sitting at a cafe or food-court table',
  '- 산책 (a walk): walking the neighborhood or a park',
  '- 여행 (a trip): a tourist spot, a hotel or an unfamiliar city far from home',
  '- 출장 (a business trip): working in a meeting room, an exhibition hall or an office far from home',
  '- 이동 (getting there): an airport, a station, a terminal, inside a car, a train or a plane, a suitcase',
  '- 쇼핑 (shopping): a shop with goods on display, a market, a supermarket, a convenience store',
  '- 휴식 (resting): resting at home or indoors',
  '- 모임 (a gathering): several people together',
  '- 운동 (exercise): exercise, hiking, a sports facility',
  '- 자연 (nature): flowers, trees, the sky, the sea, a landscape',
  '- 병원 (a clinic): a hospital, a pharmacy',
  '- 기타 (other): only when none of the above fits',
]

const DIARY_SCENE_LINES_EN = [
  'scene (a short diary of that moment, 3 or 4 sentences):',
  '- The app puts the date and the area in front. Do not write the date or the area in the scene; start with what is in the photo.',
  '- Do not open with "This is a photo taken at …". Open with what can be seen (the words on a banner or a sign first, when there are any).',
  '- The middle sentences are what is in the photo: what is there, where, how it looks.',
  '- The last sentence may be one warm line that follows from what is visible ("a hearty, warm meal").',
  '- Keep every sentence short. Do not run clauses together with commas or repeat the same adjective.',
  '- Never write "I", "we" or "you". Do not write as the person who took the photo; set the moment down plainly.',
  '- Never write a smell, a taste, a sound or a feeling, which a photo cannot show ("it smells wonderful", "they enjoyed it", "they had a lovely time" are forbidden).',
  '- When the photo is blurred or impossible to make out, write one sentence only.',
]

const DIARY_EXAMPLES_EN = [
  '- a stone pot of rice and side dishes on the table → {"activity":"식사","memo":"Gondre rice bowl for lunch","scene":"A steaming stone pot of rice sits on the table. The side dishes are neatly laid out. A hearty, warm meal."}',
  '- a park path lined with trees → {"activity":"산책","memo":"A walk down the park path","scene":"Trees line the path on both sides. Sunlight comes through the leaves. A good path to walk slowly."}',
  '- a convenience store inside an airport (560 miles from home, area: Tokoname, Japan) → {"activity":"이동","memo":"Stopped at the Nagoya airport store","scene":"A stop at the convenience store inside the airport. The shelves are full of snacks. The long way to Nagoya has begun."}',
  '- the photo is too blurred to tell → {"activity":"기타","memo":"A blurred photo","scene":"The photo is too blurred to make out."}',
]

/** Miles for an English family (CLAUDE.md: distances in English are miles),
 *  kept as coarse as the km hint it comes from. */
function milesFrom(km: number): number {
  const mi = km * 0.621371
  return mi < 10 ? Math.max(1, Math.round(mi)) : Math.round(mi / 10) * 10
}

/** The home-distance block of the English context. */
function homeLinesEn(homeHint: NonNullable<PromptHints['homeHint']>): string[] {
  const miles = milesFrom(homeHint.km)
  if (!homeHint.away) {
    return [`- Distance from home: ${homeHint.km < 2 ? 'at home, or close to home.' : `about ${miles} miles from home.`} Do not choose "여행" or "출장".`]
  }
  return [
    homeHint.homeArea
      ? `- Distance from home: about ${miles} miles from home (${homeHint.homeArea}). They are most likely on a trip or a business trip.`
      : `- Distance from home: about ${miles} miles from home. They are most likely on a trip or a business trip.`,
    ...(homeHint.homeArea ? [`  → Home is ${homeHint.homeArea}; this is somewhere else. Working → "출장", looking around → "여행".`] : []),
    '  → An airport, a station or inside a car → "이동"; a meeting room or an exhibition hall, anything that looks like work → "출장"; a clear meal, cafe or shopping → that category; anything else → "여행".',
    '  → A suit, a tie or a jacket, or a badge or a lanyard, most likely means "출장".',
    '  → With nobody in the picture, a desk with a laptop or papers, or a room that looks like an office, is "출장".',
    '  → Put the place name (the city) into the memo or the scene once, naturally.',
  ]
}

/** The English prompt. buildPrompt dispatches here when hints.lang is 'en'. */
export function buildPromptEn(hints: PromptHints = {}, variant: PromptVariant = 'local'): string {
  const { placeHint, homeHint, textHint, nearHint, placeFull, coords, diary } = hints
  const cloud = variant === 'cloud'
  const context = [
    ...momentLines(hints),
    `- Area: ${placeHint ? (nearHint ? `near ${placeHint} (this photo has no location of its own; this is where another photo taken within minutes was taken)` : placeHint) : 'unknown'}`,
    '  → This is only the name of an area. Never invent a shop, a dish or an object out of it that is not in the photo.',
  ]
  if (homeHint) context.push(...homeLinesEn(homeHint))
  if (!nearHint) context.push(...nearestPlaceLines(placeFull, variant, 'en'))
  if (cloud && coords) {
    context.push(
      `- Coordinates: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
      '  → When you know a well-known station, street or landmark near these coordinates and it fits the photo, name it.',
    )
  }
  if (textHint?.length) {
    context.push(
      `- Text the phone read in the photo: ${textHint.map((t) => `"${t}"`).join(', ')}`,
      '  → It may come from a banner, a sign or a notice. Use only what is really visible in the photo, ignore letters that make no sense, and never read them as a person\'s name.',
    )
  }

  return [
    'You are an assistant who looks at one photo a parent took on their phone and tells their family what the parent was doing at that moment.',
    'The parent took the photo themselves. This is not a description of a scene: weave the photo, the time, the place and the parent\'s earlier photos today together into the most plausible account of what they were doing.',
    'Write four things: guess, activity (the category), memo (the title) and scene (the one-line diary).',
    '',
    'guess (write this first, one line):',
    '- What is visible + the time + the place (near home, or far away) + the earlier photos today → what they were doing then.',
    '- e.g. "park path and trees + Monday 7 a.m. + near home → out for a morning walk"',
    '- e.g. "kalguksu on the table + lunchtime + a street of restaurants → having lunch"',
    '- e.g. "boarding gate and a plane + morning + 560 miles from home, at the airport earlier → waiting to board"',
    '',
    'Common rules:',
    '- Never invent an object, a dish, a shop or a person that is not in the photo. You may still work out what the parent was doing from the clues above.',
    '- When the clues are thin, write what is certain: "Photographed the flowers by the road", "Looked out of the window". Taking the photo is always true.',
    '- The time of day (morning, lunchtime, evening, night, sunrise, sunset) is a fact from the context below. Never change it because of the light or the colors in the photo.',
    '- Plain, warm English, about the parent, for their family. Leave the subject out where that reads naturally ("Walked the neighborhood park early"); where a sentence needs one, write "they". Never write "I", "we" or "you".',
    '- Never guess a name, a relationship (family, daughter, friend) or anything about health, medicines or a diagnosis. With several people together, write "with the group".',
    '- Never add a mood or a flourish of your own ("beautiful", "peaceful", "relaxing").',
    '- Use the name of a shop or a building only when it can be read in the photo or is in the context below.',
    ...(cloud ? ['- You may use the name of an area, a station or a street that you know from the coordinates.'] : []),
    '',
    'Text in the background:',
    '- When a banner, a sign, a display board or a notice is visible, read the words and use them (an event name, a station name, a shop name).',
    '- When a banner or a sign fills the picture, they were there: put it in the title together with what they did ("Went to the Jinhae cherry blossom festival!").',
    '- Put a sentence in another language into English ("가장 큰 축제" → "the biggest festival"). Place, station, shop and event names may stay as they are written ("Higashi Betsuin Station").',
    cloud ? JAPANESE_RULE_CLOUD_EN : JAPANESE_RULE_LOCAL_EN,
    ...(cloud ? [SHOP_NAME_RULE_CLOUD_EN] : []),
    AD_BOARD_RULE_EN,
    '',
    'memo (the title, one line, 4 to 8 words) — what they did + where:',
    '- Write what the parent did then and where. No subject and no full stop at the end ("Walked the neighborhood park early", "Lunch with kalguksu at a restaurant", "Waiting to board at the airport").',
    '- When a landmark or a tourist spot is in the picture, or a background framed on purpose (a famous building, view or sculpture), put its name first and end the title warmly with "!": "Visited Bulguksa Temple!", "Went to see the sea at Haeundae!". No "!" otherwise.',
    '- When a dish or a shop name can be read on a menu, a bowl or a sign, put it in ("Gondre rice bowl at Hanyang Restaurant").',
    '- Good: "Walked the neighborhood park early", "Lunch with kalguksu at a restaurant", "Waiting to board at the airport"',
    '- Bad: "A park path lined with trees" (nothing they did), "A beautiful sunset" (a description of the picture), "A moment of today", "Spent some time" (says nothing about what they did).',
    '',
    ...(diary ? DIARY_SCENE_LINES_EN : [
      'scene (a one-line diary that brings the day back, 1 sentence · 2 at most · under 90 characters):',
      '- Weave 1 or 2 memory anchors together with what they did, in one natural sentence. Memory anchors: the weather and the temperature (the real values in the context below), the weekday, a holiday or a special day, the part of the day, a trip far from home, the flow from the earlier photos today.',
      '- e.g. "A clear, warm Sunday, stepping out after lunch for a photo with the group." / "A rainy, chilly Monday morning, heading out to work under an umbrella." / "A clear, cool Monday morning, starting the day with a lap around the park."',
      '- Do not say the title over again; add the context of that day that the title does not have.',
      '- Describe the picture only for a landmark or a background framed on purpose, and then briefly ("in front of Dabotap"). Sentences that list objects or the background are forbidden: "A glass of water is on the table", "Trees line the path", "Shops can be seen behind them", "A white car is parked outside". Never end a sentence with "… is on the table" or "… can be seen", and never write "There is …" or "There are …".',
      '- Write the weather only from the real values in the context. With no value, leave the weather out, and never read the weather off the light or the sky in the photo.',
      '- Never invent a feeling ("delicious", "lovely", "happy", "pretty"), and never put a feeling adverb on what they did ("comfortably", "leisurely", "happily", "peacefully").',
    ]),
    '',
    'activity (exactly one, for what they were doing):',
    '- The value must be one of these 13 Korean words, copied exactly as written and never translated. Everything else you write (guess, memo, scene) is in English.',
    ...CATEGORY_LINES_EN,
    '',
    'Examples:',
    ...(diary ? DIARY_EXAMPLES_EN : [
      '- stew and side dishes on the table, Tuesday 12:20, rain 48°F, at home → {"guess":"stew and side dishes + lunchtime + at home → lunch at home","activity":"식사","memo":"Doenjang stew for lunch at home","scene":"A rainy, chilly Tuesday, a hot lunch at home."}',
      '- a park path lined with trees, Monday 07:10, clear 63°F, 1 mile from home → {"guess":"park path + early morning + near home → a morning walk","activity":"산책","memo":"Walked the neighborhood park early","scene":"A clear, cool Monday morning, starting the day with a lap around the park."}',
      '- inside a restaurant, a stone pot of rice and a "gondre" menu, Sunday 13:10, clear 75°F, nearest place: Hanyang Restaurant → {"guess":"stone pot rice + the menu + Sunday lunchtime + Hanyang Restaurant → lunch with the group","activity":"식사","memo":"Gondre rice bowl at Hanyang Restaurant","scene":"A clear, warm Sunday, lunch with the group."}',
      '- several people in front of a restaurant, Sunday 13:40, clear 75°F, earlier photo: 13:00 lunch at Hanyang Restaurant → {"guess":"outside the restaurant + just after lunch + lunch earlier → a photo together after the meal","activity":"모임","memo":"A photo after lunch at Hanyang","scene":"A clear, warm Sunday, stepping out after lunch for a photo with the group."}',
      '- a selfie in front of Dabotap, Saturday 10:20, clear 61°F, 190 miles from home (area: Gyeongju) → {"guess":"Dabotap + Gyeongju + far from home → a trip to Bulguksa","activity":"여행","memo":"Visited Bulguksa Temple!","scene":"A cool autumn Saturday morning, a photo in front of Dabotap in Gyeongju."}',
      '- a convenience store inside an airport, Friday 10:40, weather unknown, 560 miles from home (area: Tokoname, Japan) → {"guess":"airport store + morning + Nagoya, Japan → picking up a snack after landing","activity":"이동","memo":"Stopped at the Nagoya airport store","scene":"Friday morning, landing in Nagoya and picking out a snack at the airport."}',
      '- an indoor photo with almost no clues, Wednesday 15:00 → {"guess":"indoors, few clues → took a photo indoors","activity":"기타","memo":"Took a photo indoors","scene":"Wednesday afternoon, one photo indoors."}',
      '- the photo is too blurred to tell → {"guess":"blurred, no clues","activity":"기타","memo":"A blurred photo","scene":"The photo is too blurred to make out."}',
    ]),
    '',
    'Context (the time is a fact, the rest is for reference — when what you see disagrees, follow the photo):',
    ...context,
    '',
    'Answer with JSON only. No other text:',
    '{"guess":"<clues → what they were doing>","activity":"<one of the 13 Korean category words>","memo":"<the title, one line>","scene":"<the one-line diary of that day>"}',
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
/** An English title is 4–8 words, so 40 characters would cut it mid-word. */
const MEMO_MAX_EN = 70
const SCENE_MAX_SENTENCES = 3
export const DIARY_MAX_SENTENCES = 4
/** UI insurance for the diary body (the opener comes on top): whole
 *  sentences past this are dropped. */
export const DIARY_MAX_CHARS = 230

/** One line, no stray quotes; an over-long title is cut at its first sentence
 *  (at the last whole word, for English, which has no 12–24 character shape).
 *  An English title carries no closing full stop, but keeps its "!". */
export function tidyMemo(raw: string, lang: PromptLang = 'ko'): string {
  let memo = raw.replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '')
  if (lang === 'en') {
    memo = memo.replace(/\.+$/, '')
    if (memo.length > MEMO_MAX_EN) {
      const cut = memo.slice(0, MEMO_MAX_EN)
      const at = cut.lastIndexOf(' ')
      memo = `${(at > 20 ? cut.slice(0, at) : cut).replace(/[,;:·-]$/, '')}…`
    }
    return memo
  }
  if (memo.length > MEMO_MAX) {
    const first = memo.match(/^.*?[.!?。]/)?.[0] ?? memo
    memo = first.length > MEMO_MAX ? `${first.slice(0, MEMO_MAX - 1)}…` : first
  }
  return memo
}

// Kana and Chinese characters. The model reads these badly and "translates"
// them into things the sign doesn't say, and the family can't read them.
export const FOREIGN_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff]/

// A sentence about the background ("뒤로 상점들이 보여요", "흰색 차량이 주차되어
// 있어요") says nothing about what the parent did; the small local model
// writes them anyway, so they are dropped in code. Kept when it quotes a sign.
const BACKGROUND = /(^|\s)(뒤로|뒤쪽|뒤편|뒤에는?|배경|주변에는?)\s|주차되어|주차된|상업 ?시설|상점들|건물들|가게들/
const MEANINGFUL = /["'“”‘’「」]|간판|현수막|안내판|전광판|글자|메뉴|표지판/
// A sentence that lists what is lying around ("식탁 위에 냄비가 놓여 있어요",
// "축제 현수막이 보여요") is an inventory, not a diary: dropped (never the first).
const INVENTORY = /(놓여 ?있|차려져 ?있|늘어서 ?있|늘어선|붙어 ?있|걸려 ?있|주차되어|진열되어|보여요|보입니다|보이네요|보이고|가득해요|가득합니다)/
// Words that put a feeling onto what the parent did ("집에서 편안하게 시간을
// 보내셨어요"): the photo can't show it. Gemini writes them now and then
// despite the rule, so they are taken out of the sentence in code.
const FEELING_ADVERBS = /(편안하게|편안히|여유롭게|느긋하게|즐겁게|행복하게|기분 좋게|맛있게|흐뭇하게)\s+/g
// The same three families of sentence in English. The English scene is one
// sentence about what the parent did, so "Shops can be seen behind them" and
// "A glass of water is on the table" are dropped here too, and a feeling the
// photo cannot show is taken out of the sentence.
const BACKGROUND_EN = /\b(behind (them|him|her|it)|in the background|off to the (left|right)|nearby|around them)\b/i
const MEANINGFUL_EN = /["'“”‘’]|\b(sign|signs|banner|banners|notice|noticeboard|billboard|display board|menu|lettering|letters|words)\b/i
const INVENTORY_EN = /\bthere (is|are|was|were)\b|\b(is|are|was|were)\s+(on|at|in|by|next to|beside|under|over)\s+the\b|\b(can be seen|could be seen|is visible|are visible|is parked|are parked|is placed|are placed|is laid out|are laid out|is displayed|are displayed|is hanging|are hanging|is set out|are set out)\b|\b(line|lines|lined)\s+the\b|\b(sits|sit|stands|stand|lies|lie)\s+(on|at|in|by|beside|under)\s+the\b/i
// Feelings and flourishes the photo cannot show. Weather words ("warm",
// "clear", "chilly") are facts from WeatherKit and are never dropped.
const FEELING_WORDS_EN = /\b(deliciously|lovingly|happily|cheerfully|comfortably|leisurely|peacefully|pleasantly|joyfully|warmly|nicely|delightfully|contentedly)\s+/gi
// "a"/"an" goes with the adjective, so "had a delicious lunch" reads "had lunch".
const FEELING_ADJECTIVES_EN = /\b(?:(?:a|an)\s+)?(?:delicious|lovely|beautiful|peaceful|wonderful|amazing|pleasant|charming|happy|joyful|cozy|relaxing|delightful|pretty|cheerful)\b,?\s+/gi

/** Takes the feeling words out of a sentence; the Korean list for Korean,
 *  the English one for English. */
export function dropFeelingWords(s: string, lang: PromptLang = 'ko'): string {
  if (lang === 'en') {
    const out = s.replace(FEELING_WORDS_EN, '').replace(FEELING_ADJECTIVES_EN, '').replace(/\s{2,}/g, ' ').trim()
    // "Delicious lunch at …" loses its first word: the next one takes the capital.
    return out ? out[0].toUpperCase() + out.slice(1) : out
  }
  return s.replace(FEELING_ADVERBS, '')
}

export function isBackgroundSentence(s: string, lang: PromptLang = 'ko'): boolean {
  if (lang === 'en') return (BACKGROUND_EN.test(s) && !MEANINGFUL_EN.test(s)) || INVENTORY_EN.test(s)
  return (BACKGROUND.test(s) && !MEANINGFUL.test(s)) || INVENTORY.test(s)
}

/** Collapse whitespace, drop sentences that copy Japanese/Chinese text (kept
 *  when relaxed) or only describe the background (never the first one;
 *  not in a memoDiary body, which describes the photo by design), and keep
 *  at most three sentences (four, and at most DIARY_MAX_CHARS, for a diary body). */
export function tidyScene(raw: string, relaxed = false, diary = false, lang: PromptLang = 'ko'): string {
  const text = raw.replace(/\s+/g, ' ').trim()
  // A sentence ends where Korean text meets a full stop; a period inside a
  // quoted sign ("Sta.", "jejuair.com") is not an ending. In English the
  // sentence ends after a letter, a digit or a closing quote.
  const sentences = lang === 'en'
    ? text.split(/(?<=[A-Za-z0-9"'”’)\]][.!?])\s+/)
    : text.split(/(?<=[가-힣][.!?])\s+/)
  const kept = sentences
    .filter((s, i) => diary || i === 0 || !isBackgroundSentence(s, lang))
    .filter((s) => relaxed || !FOREIGN_SCRIPT.test(s))
    .slice(0, diary ? DIARY_MAX_SENTENCES : SCENE_MAX_SENTENCES)
    .map((s) => (diary ? s : dropFeelingWords(s, lang)).trim())
  if (diary) while (kept.length > 1 && kept.join(' ').length > DIARY_MAX_CHARS) kept.pop()
  return kept.join(' ')
}

/** `relaxed`: the cloud model, which reads Japanese well; a stray kana in its
 *  answer is kept rather than failing the memo. */
export function parseModelResponse(raw: string, opts: { relaxed?: boolean; diary?: boolean; lang?: PromptLang } = {}): { activity: string; memo: string; scene: string; guess?: string } | null {
  const relaxed = opts.relaxed === true
  const lang: PromptLang = opts.lang === 'en' ? 'en' : 'ko'
  // Models occasionally wrap JSON in a code fence even with the
  // response-format hint.
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as { activity?: unknown; memo?: unknown; scene?: unknown; guess?: unknown }
    const activityRaw = typeof parsed.activity === 'string' ? parsed.activity.trim() : ''
    const memo = typeof parsed.memo === 'string' ? tidyMemo(parsed.memo, lang) : ''
    // scene is optional in the response — when a model briefly drops it we
    // still accept the memo. The UI falls back to the title when it's empty.
    const scene = typeof parsed.scene === 'string' ? tidyScene(parsed.scene, relaxed, opts.diary === true, lang) : ''
    // A title quoting Japanese/Chinese text is rejected so the caller retries.
    if (!memo || (!relaxed && FOREIGN_SCRIPT.test(memo))) return null
    // Snap the activity to one of the known categories. The model can drift
    // ("점심" instead of "식사") so we coerce — anything unrecognized falls
    // back to 기타 rather than polluting the dashboard with one-off buckets.
    const activity = (VALID_CATEGORIES as readonly string[]).includes(activityRaw)
      ? activityRaw
      : '기타'
    const guess = typeof parsed.guess === 'string' ? parsed.guess.replace(/\s+/g, ' ').trim().slice(0, 160) : ''
    return guess ? { activity, memo, scene, guess } : { activity, memo, scene }
  } catch {
    return null
  }
}

// Final-fallback stub, used when the local model fails repeatedly on a photo.
// It never claims to know what the photo shows: a neutral line, plus a
// category only when the phone's own Vision tags point at one.
export function stubActivity(tags?: VisionTags | null, away = false): { activity: string; memo: string; scene: string } {
  return { activity: categoryFromTags(tags, away), memo: '사진을 기록했어요.', scene: '' }
}

/**
 * A photo kept without a memo from the model (handlers/usage.ts). It reads as
 * a normal entry: nothing in it says a step was skipped.
 */
export function storedOnlyMemo(tags?: VisionTags | null, away = false): { activity: string; memo: string; scene: string } {
  return { activity: categoryFromTags(tags, away), memo: '사진을 남겼어요', scene: '' }
}

/**
 * Pick a coarse category from the phone's Vision tags (English
 * VNClassifyImageRequest names). Only used for the stub. Defaults to 기타.
 * Far from home (away), work clothes or a lanyard read as 출장.
 */
export function categoryFromTags(
  tags: VisionTags | null | undefined,
  away = false,
): string {
  if (!tags) return '기타'
  const names = tags.labels.map((l) => l.name.toLowerCase()).join(' ')
  if (/food|meal|dish|plate|bowl|fruit|vegetable/.test(names)) return '식사'
  if (/coffee|tea|drink|beverage|cup|dessert/.test(names)) return '카페'
  if (/luggage|suitcase|airport|airplane|train|vehicle|car_interior/.test(names)) return '이동'
  if (away && /suit|necktie|blazer|tuxedo|lanyard|badge/.test(names)) return '출장'
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

export type DigestLang = 'ko' | 'en'

export interface DigestPromptArgs {
  span: DigestSpan
  /** One line per photo, oldest first: "09:40 산책 · 나무가 우거진 공원 산책길 · 서초동". */
  lines: string[]
  /** The family's language (설정 → 언어); Korean until one is chosen. Only the daily diary is translated. */
  lang?: DigestLang
}

/** What the model wrote: the diary (or the week's / month's summary) and, for a day, its title. */
export interface DigestText {
  summary: string
  title?: string
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

/** A day's diary for the family: 3–5 short sentences (1–2 for a single photo), chronological, facts only,
 *  a fact-bound closing line, and a short title. Korean rules for Korean, English rules for English. */
function buildDiaryPrompt(lines: string[], lang: DigestLang): string {
  const entries = thin(lines, DIGEST_MAX_LINES).map((l) => `- ${l}`)
  if (lang === 'en') {
    return [
      'Below are the notes a parent left on each photo they took today. Using only these notes, write today\'s diary for their family.',
      '',
      'Rules:',
      '- Write 3 to 5 short sentences, in the order of the day. If there is only one note, write 1 or 2 sentences.',
      '- Use only what the notes say. Never guess events, feelings, reasons, health, medicines or diagnoses, names, or relationships (daughter, friend).',
      '- Warm, gentle and respectful about the parent; never mention how many photos or notes there were.',
      '- Merge similar notes into one sentence.',
      '- The last sentence is one short, warm line that sums up the day, using only facts from the notes (where they went, what they did).',
      '- The title is a short phrase for the day, at most 6 words, no emoji.',
      '',
      'Example:',
      '{"title":"A walk in the park and the market","diary":"In the morning they took a walk in the park. Then they went to the market. For lunch they had soybean stew at home. In the afternoon they rested over coffee at a cafe. A day spent out and about in the neighbourhood."}',
      '',
      'Notes:',
      ...entries,
      '',
      'Answer only as JSON: {"title": "...", "diary": "..."}',
    ].join('\n')
  }
  return [
    '아래는 부모님이 오늘 찍은 사진마다 적어 둔 기록이에요. 이 기록만 보고, 가족이 읽을 오늘의 일기를 써 주세요.',
    '',
    '규칙:',
    '- 3~5문장으로 쓰세요. 한 문장은 40자 이내. 기록이 하나뿐이면 1~2문장만 쓰세요.',
    '- 시간 순서대로 쓰고, 비슷한 기록은 하나로 묶으세요.',
    '- 기록에 적힌 내용만 쓰세요. 적혀 있지 않은 일, 기분, 이유는 지어내지 마세요.',
    '- 쉬운 한국어 존댓말(~요)로, 부모님을 높여서 쓰세요 ("산책하셨어요", "드셨어요").',
    '- 사람 이름, 관계(딸·친구 등), 건강·약·진단명은 추측하지 마세요.',
    '- 사진이 몇 장인지, "기록"이나 "사진"이라는 말은 쓰지 마세요.',
    '- 마지막 문장은 하루를 짧게 정리하는 따뜻한 한 줄이에요. 기록에 있는 사실(어디를 다녀오셨는지, 무엇을 하셨는지)만으로 쓰세요.',
    '- title은 하루를 나타내는 짧은 말이에요. 20자 이내, 이모지 없이.',
    '',
    '예시:',
    '{"title":"공원 산책과 시장 나들이","diary":"오전에 공원을 산책하셨어요. 그 뒤 시장에 다녀오셨어요. 점심은 집에서 된장찌개를 드셨어요. 오후에는 카페에서 커피를 드시며 쉬셨어요. 동네를 두루 다니신 하루였어요."}',
    '',
    '기록:',
    ...entries,
    '',
    'JSON 형식 {"title": "...", "diary": "..."} 으로만 답하세요.',
  ].join('\n')
}

export function buildDigestPrompt({ span, lines, lang = 'ko' }: DigestPromptArgs): string {
  if (span === 'daily') return buildDiaryPrompt(lines, lang)
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
const DIARY_MAX = 450
const TITLE_MAX = 30

function modelJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** One paragraph of at most `max` sentences, cut at `chars`. Null when empty. */
function paragraph(text: unknown, max: number, chars: number): string | null {
  if (typeof text !== 'string') return null
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  const sentences = flat.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [flat]
  const kept = sentences.slice(0, max).join(' ')
  return kept.length > chars ? `${kept.slice(0, chars - 1)}…` : kept
}

/** The summary out of the model's JSON: one paragraph, at most three sentences. */
export function parseSummary(raw: string): string | null {
  const json = modelJson(raw)
  return json ? paragraph(json.summary, 3, SUMMARY_MAX) : null
}

/** The day's diary out of the model's JSON: one paragraph of at most five
 *  sentences, and a short title (empty when the model left it out). */
export function parseDiary(raw: string): DigestText | null {
  const json = modelJson(raw)
  if (!json) return null
  const summary = paragraph(json.diary, 5, DIARY_MAX)
  if (!summary) return null
  const title = typeof json.title === 'string' ? json.title.replace(/\s+/g, ' ').replace(/^["“”'「」\s]+|["“”'「」\s.]+$/g, '').trim() : ''
  return { summary, title: title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title }
}
