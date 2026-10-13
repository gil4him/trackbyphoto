// Memo v2: the see() prompt and its parser (no model, no Firestore).
import { describe, it, expect } from 'vitest'
import { buildSeePrompt, parseSeeResponse } from '../src/llm/promptV2'

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
