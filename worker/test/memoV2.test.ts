// Memo v2: the see() prompt and its parser (no model, no Firestore).
import { describe, it, expect } from 'vitest'
import { buildSeePrompt, buildWritePrompt, parseSeeResponse, parseWriteResponse, STYLE_EXAMPLES, type Seen } from '../src/llm/promptV2'

describe('see() prompt', () => {
  it('asks for facts only, with the category list, the sign rules and the situation hints', () => {
    const p = buildSeePrompt({ timeHint: '12:30', placeHint: '서초동, 서초구', homeHint: { km: 1, away: false }, textHint: ['Nagoya'] })
    expect(p).toContain('사실만')
    expect(p).toContain('- 식사: 음식, 식당, 식탁')
    expect(p).toContain('- 기타: 위 어느 것에도 맞지 않을 때만')
    expect(p).toContain('일본어나 한자로 된 글자는')
    expect(p).toContain('광고판')
    expect(p).toContain('- 시간: 12:30')
    expect(p).toContain('- 지역: 서초동, 서초구')
    expect(p).toContain('집 또는 집 근처예요')
    expect(p).toContain('"Nagoya"')
    expect(p).toContain('"peopleCount":0')
    expect(p).not.toContain('된장찌개로 점심 식사')
  })

  it('tells a far-away photo apart', () => {
    const p = buildSeePrompt({ homeHint: { km: 900, away: true, homeArea: '서초구' } })
    expect(p).toContain('집(서초구)에서 약 900km')
    expect(p).toContain('"출장"일 가능성')
  })
})

describe('parseSeeResponse', () => {
  it('reads the facts, snaps the category, trims lists, strips fences', () => {
    const seen = parseSeeResponse('```json\n{"activity":"점심","subjects":["된장찌개","반찬","식탁","숟가락"],"setting":" 집  식탁 ","signText":[],"peopleCount":"2"}\n```')
    expect(seen).toEqual({ activity: '기타', subjects: ['된장찌개', '반찬', '식탁'], setting: '집 식탁', signText: [], peopleCount: 2 })
  })

  it('keeps a known category and drops Japanese/Chinese sign text', () => {
    const seen = parseSeeResponse('{"activity":"이동","subjects":["여행 가방"],"setting":"공항","signText":["Nagoya","名古屋"],"peopleCount":0}')
    expect(seen?.activity).toBe('이동')
    expect(seen?.signText).toEqual(['Nagoya'])
  })

  it('is null for junk, for nothing seen, or for a setting in a foreign script', () => {
    expect(parseSeeResponse('not json')).toBeNull()
    expect(parseSeeResponse('{"activity":"기타","subjects":[],"setting":"","signText":[],"peopleCount":0}')).toBeNull()
    expect(parseSeeResponse('{"activity":"기타","subjects":["간판"],"setting":"名古屋駅","signText":[],"peopleCount":0}')).toBeNull()
  })
})

const SEEN: Seen = { activity: '산책', subjects: ['벚나무', '산책길'], setting: '공원 산책길', signText: ['진해 벚꽃 축제'], peopleCount: 1 }
const HOOKS = [{ id: 'nth', text: '오늘 3번째 사진이에요' }, { id: 'calendar', text: '오늘은 어버이날, 금요일이에요' }]

describe('write() prompt', () => {
  it('gives the facts, the hooks with their ids, the no-repeat rule and the chosen style', () => {
    const p = buildWritePrompt({ seen: SEEN, hooks: HOOKS, recentTitles: ['공원 길을 걸으셨어요', '시장 구경'], style: 'playful', hints: { timeHint: '12:30', placeHint: '서초동, 서초구' } })
    expect(p).toContain('- 활동: 산책')
    expect(p).toContain('- 보이는 것: 벚나무, 산책길')
    expect(p).toContain('- 읽히는 글자: "진해 벚꽃 축제"')
    expect(p).toContain('- 사람: 1명')
    expect(p).toContain('시간 12:30 · 지역 서초동, 서초구')
    expect(p).toContain('- [nth] 오늘 3번째 사진이에요')
    expect(p).toContain('- [calendar] 오늘은 어버이날, 금요일이에요')
    expect(p).toContain('최대 하나만')
    expect(p).toContain('없는 숫자, 지명')
    expect(p).toContain('같은 식으로 시작하지 마세요: "공원 길을 걸으셨어요", "시장 구경"')
    expect(p).toContain('12~24자')
    expect(p).toContain('말투 (재치있게)')
    for (const e of STYLE_EXAMPLES.playful.examples) expect(p).toContain(e)
    expect(p).not.toContain('로 점심 식사')
  })

  it('defaults to the warm style, says when there is nothing to add, and marks a trip', () => {
    const p = buildWritePrompt({ seen: { ...SEEN, subjects: [], signText: [] }, hooks: [], recentTitles: [], style: 'warm', hints: { homeHint: { km: 900, away: true } } })
    expect(p).toContain('말투 (다정하게)')
    expect(p).toContain('- 보이는 것: (없음)')
    expect(p).toContain('- (없음)')
    expect(p).toContain('집에서 약 900km 떨어진 곳')
    expect(p).not.toContain('같은 식으로 시작하지')
    expect(Object.keys(STYLE_EXAMPLES)).toEqual(['plain', 'warm', 'playful'])
  })
})

describe('parseWriteResponse', () => {
  it('reads the memo, trims the scene to three sentences, and the hook id in its variants', () => {
    expect(parseWriteResponse('{"memo":" \\"볕 좋은 날의 공원 산책이에요\\" ","scene":"벚나무가 늘어서 있어요. 공원 길이에요. 축제 현수막이 보여요. 넷째 문장.","hookId":"[nth]"}'))
      .toEqual({ memo: '볕 좋은 날의 공원 산책이에요', scene: '벚나무가 늘어서 있어요. 공원 길이에요. 축제 현수막이 보여요.', hookId: 'nth' })
    expect(parseWriteResponse('```json\n{"memo":"공원 산책","scene":"","hookId":""}\n```')).toEqual({ memo: '공원 산책', scene: '', hookId: null })
    expect(parseWriteResponse('{"memo":"공원 산책","scene":"","hookId":"null"}')?.hookId).toBeNull()
  })

  it('is null without a title, with a foreign script in it, or for junk', () => {
    expect(parseWriteResponse('{"memo":"","scene":"x","hookId":""}')).toBeNull()
    expect(parseWriteResponse('{"memo":"名古屋 산책","scene":"x","hookId":""}')).toBeNull()
    expect(parseWriteResponse('nope')).toBeNull()
  })
})
