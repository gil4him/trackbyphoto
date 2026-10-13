// Memo v2 guards: pure checks on a written title.
import { describe, it, expect } from 'vitest'
import { bigramSimilarity, checkMemo, placeTokens } from '../src/llm/guards'

const facts = { texts: ['벚나무', '산책길', '공원 산책길', '진해 벚꽃 축제', '서초동, 서초구', '오늘 3번째 사진이에요'] }
const hooks = ['nth', 'calendar']

describe('checkMemo', () => {
  it('passes a title that stays inside the facts and the hooks', () => {
    expect(checkMemo('서초동 공원에서 벚꽃 산책', 'nth', facts, hooks, ['시장에서 과일 고르기'])).toEqual({ ok: true })
    expect(checkMemo('오늘 3번째, 공원 벚꽃 산책', null, facts, hooks, [])).toEqual({ ok: true })
  })

  it('rejects a hook it was not given', () => {
    expect(checkMemo('공원 벚꽃 산책', 'weather', facts, hooks, [])).toMatchObject({ ok: false, reason: 'hook', detail: 'weather' })
  })

  it('rejects numbers that are in no fact or hook', () => {
    expect(checkMemo('공원에서 벚꽃 12그루', null, facts, hooks, [])).toMatchObject({ ok: false, reason: 'number', detail: '12' })
    expect(checkMemo('오늘 3번째 벚꽃 산책', null, facts, hooks, [])).toEqual({ ok: true })
  })

  it('rejects place names that are in no fact or hook, and reads them through particles', () => {
    expect(checkMemo('잠실동에서 벚꽃 산책', null, facts, hooks, [])).toMatchObject({ ok: false, reason: 'place', detail: '잠실동' })
    expect(checkMemo('서초동에서는 벚꽃 산책', null, facts, hooks, [])).toEqual({ ok: true })
    expect(checkMemo('한강공원 벚꽃 구경', null, facts, hooks, [])).toMatchObject({ ok: false, reason: 'place', detail: '한강공원' })
    expect(placeTokens('서초동에서 잠실역으로, 공원을')).toEqual(['서초동', '잠실역', '공원'])
    // Short everyday words that happen to end like a place are not places.
    expect(placeTokens('카페에서 잠시 쉬었어요, 도시 풍경, 유리 너머')).toEqual([])
    expect(placeTokens('지하철역에서 기차를 기다리는 모습')).toEqual(['지하철역'])
    expect(checkMemo('카페에서 잠시 쉬었어요', null, facts, hooks, [])).toEqual({ ok: true })
  })

  it('rejects a relation the facts never named, in the title or the scene', () => {
    expect(checkMemo('가족과 벚꽃 산책', null, facts, hooks, [])).toMatchObject({ ok: false, reason: 'relation', detail: '가족' })
    expect(checkMemo('벚꽃 산책', null, facts, hooks, [], '저희 셋이 함께한 길이에요.')).toMatchObject({ ok: false, reason: 'relation', detail: '저희' })
    expect(checkMemo('딸과 벚꽃 산책', null, { texts: [...facts.texts, '딸이 보낸 사진'] }, hooks, [])).toEqual({ ok: true })
  })

  it('rejects a near copy of a recent title', () => {
    const v = checkMemo('공원 길을 걸으셨어요', null, facts, hooks, ['공원 길을 걸으셨어요!'])
    expect(v).toMatchObject({ ok: false, reason: 'similar' })
    expect(checkMemo('벚꽃 아래 공원 산책', null, facts, hooks, ['공원 길을 걸으셨어요'])).toEqual({ ok: true })
  })
})

describe('bigramSimilarity', () => {
  it('is 1 for the same text, 0 for nothing shared, and ignores spaces and punctuation', () => {
    expect(bigramSimilarity('공원 산책', '공원산책!')).toBe(1)
    expect(bigramSimilarity('공원 산책', '된장찌개')).toBe(0)
    expect(bigramSimilarity('가', '가')).toBe(0)
    expect(bigramSimilarity('공원에서 산책했어요', '공원에서 식사했어요')).toBeGreaterThan(0.5)
  })
})
