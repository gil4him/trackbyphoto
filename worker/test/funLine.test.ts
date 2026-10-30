// 재미있는 한 줄: the fact is counted in code, the model only words it, and the
// memo is left alone. The model is an injected fake; Firestore is the emulator.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { addFunLine, chooseFact, lineOk, resetFunLineCache, subjectOf, wordFunLine, type FunMemo } from '../src/handlers/funLine'
import { resetPlansCache } from '../src/plans'
import { db, clearFirestore } from './setup'

const OFFSET = 0
const at = (s: string) => new Date(`${s}:00Z`)
const m = (when: string, over: Partial<FunMemo> = {}): FunMemo =>
  ({ at: at(when), activity: '기타', memo: '사진을 찍으셨어요', scene: '', place: '', lat: null, lng: null, ...over })
const fact = (history: FunMemo[], current: FunMemo, extra: { name?: string; home?: { lat: number; lng: number } | null } = {}) =>
  chooseFact({ history, current, offsetMin: OFFSET, name: extra.name ?? '', home: extra.home ?? null })
const daily = (days: number[], over: Partial<FunMemo> = {}) => days.map((d) => m(`2026-10-${String(d).padStart(2, '0')}T12:00`, over))

describe('subjectOf', () => {
  it('finds the food or the named place, not vague words', () => {
    expect(subjectOf({ memo: '식당에서 일행과 함께 칼국수를 드셨어요', scene: '' })).toBe('칼국수')
    expect(subjectOf({ memo: '칙필레 매장에 다녀오셨어요', scene: '' })).toBe('칙필레')
    expect(subjectOf({ memo: '레이징 케인스에서 저녁을 드셨어요', scene: '' })).toBe('레이징 케인스')
    expect(subjectOf({ memo: '리버사이드의 식당에서 저녁 식사를 하셨어요', scene: '일행과 함께 따뜻한 쌀국수를 드셨어요.' })).toBe('쌀국수')
    expect(subjectOf({ memo: '가족과 함께 저녁 식사를 하셨어요', scene: '' })).toBe('')
    expect(subjectOf({ memo: '식당에서 일행과 점심을 드셨어요', scene: '' })).toBe('')
  })
})

describe('chooseFact', () => {
  const meal = (when: string, memo: string, over: Partial<FunMemo> = {}) => m(when, { activity: '식사', memo, ...over })

  it('first photo, with the parent\'s name when there is one', () => {
    expect(fact([], m('2026-10-01T12:00'), { name: '엄마' })).toBe('Daylie에 남긴 엄마의 첫 사진이에요')
    expect(fact([], m('2026-10-01T12:00'))).toBe('Daylie에 남긴 첫 사진이에요')
  })
  it('compares with the last named meal, skipping vague ones', () => {
    const history = [meal('2026-10-01T12:00', '칙필레 매장에 다녀오셨어요'), meal('2026-10-02T12:00', '가족과 함께 저녁 식사를 하셨어요')]
    expect(fact(history, meal('2026-10-03T12:00', '식당에서 칼국수를 드셨어요'))).toBe('지난번 식사 기록은 칙필레, 이번은 칼국수')
  })
  it('does not compare a thing with itself', () => {
    expect(fact([m('2026-10-01T12:00'), meal('2026-10-02T12:00', '칙필레 매장에 다녀오셨어요')], meal('2026-10-05T12:00', '칙필레 매장에 다녀오셨어요'))).not.toContain('지난번')
  })
  it('the first photo of a day always has something to say; a later one need not', () => {
    expect(fact(daily([1, 3]), m('2026-10-06T09:00'))).toBe('오늘의 첫 사진이에요 (화요일 09:00)')
    expect(fact([...daily([1, 3]), m('2026-10-06T08:00')], m('2026-10-06T09:00'))).toBeNull()
  })
  it('counts an activity at round numbers, this month only', () => {
    const rests = [m('2026-09-30T12:00', { activity: '휴식' }), m('2026-10-02T12:00', { activity: '휴식' }), m('2026-10-04T12:00', { activity: '휴식' })]
    expect(fact(rests, m('2026-10-06T12:00', { activity: '휴식' }))).toBe('이번 달 휴식 기록 3번째예요')
  })
  it('never on a hospital photo, nor comparing with one', () => {
    expect(fact([], m('2026-10-01T12:00', { memo: '병원 접수처에 방문하셨어요' }))).toBeNull()
    expect(fact([m('2026-10-01T12:00')], m('2026-10-02T12:00', { scene: '낮에 병원을 다녀오신 뒤 귀가하셨어요' }))).toBeNull()
    expect(fact([meal('2026-10-01T12:00', '서울약국에서 쉬셨어요')], meal('2026-10-05T12:00', '식당에서 칼국수를 드셨어요'))).not.toContain('약국')
  })
  it('streak milestones, on the first photo of the day only', () => {
    expect(fact(daily([1, 2]), m('2026-10-03T09:00'))).toBe('3일 연속으로 사진을 남겼어요')
    expect(fact(daily([1, 2, 3]), m('2026-10-04T09:00'))).not.toContain('연속')
    expect(fact(daily([1, 3]), m('2026-10-04T09:00'))).not.toContain('연속')
    expect(fact([...daily([1, 2]), m('2026-10-03T08:00')], m('2026-10-03T09:00'))).toBeNull()
  })
  it('uses the person\'s local day', () => {
    const late = [m('2026-10-01T12:00'), m('2026-10-02T12:00')]
    // 02:00 UTC on the 3rd is still the 2nd eight hours behind.
    expect(chooseFact({ history: late, current: m('2026-10-03T02:00'), offsetMin: -480, name: '', home: null })).toBeNull()
  })
  it('first shop or café of the month', () => {
    const old = [m('2026-09-01T12:00', { activity: '쇼핑' }), m('2026-10-09T12:00')]
    expect(fact(old, m('2026-10-20T12:00', { activity: '쇼핑' }))).toBe('이번 달 첫 쇼핑 기록이에요')
  })
  it('earliest and latest only with some history, and only at real extremes', () => {
    const five = daily([1, 3, 5, 7, 9])
    expect(fact(five, m('2026-10-12T05:13'))).toContain('가장 이른 시각이에요 (05:13)')
    expect(fact(five, m('2026-10-12T22:26'))).toContain('가장 늦은 시각이에요 (22:26)')
    expect(fact(five, m('2026-10-12T08:00'))).toContain('오늘의 첫 사진')
    expect(fact(daily([1, 3]), m('2026-10-12T05:13'))).toContain('오늘의 첫 사진')
  })
  it('the busiest day needs real history', () => {
    const big = [...daily([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21]), m('2026-10-23T09:00'), m('2026-10-23T10:00'), m('2026-10-23T11:00')]
    const today = ['08:00', '09:00', '10:00'].map((t) => m(`2026-10-25T${t}`))
    // A comparison or an earlier line would take the slot; none here.
    expect(fact([...big, ...today], m('2026-10-25T13:00'))).toBe('이번 달 가장 사진이 많은 날이 됐어요 (오늘 4장)')
    expect(fact([...big, ...today.slice(0, 2)], m('2026-10-25T13:00'))).toBeNull()
  })
  it('place counts: third visit on, a saved home, and never at home', () => {
    const lib = { place: '도서관 · 웨스트코비나', lat: 34, lng: -118, memo: '웨스트코비나 도서관에서 시간을 보내셨어요' }
    const history = [m('2026-10-01T12:00', lib), m('2026-10-03T12:00', lib), m('2026-10-04T12:00')]
    const home = { lat: 33.9, lng: -117.9 }
    expect(fact(history, m('2026-10-06T12:00', lib), { home })).toBe('웨스트코비나 도서관 기록이 3번째예요')
    expect(fact(history, m('2026-10-06T12:00', lib))).not.toContain('번째') // no saved home
    expect(fact(history, m('2026-10-06T12:00', lib), { home: { lat: 34, lng: -118 } })).not.toContain('번째') // that is home
    expect(fact(history.slice(0, 1).concat(history[2]), m('2026-10-06T12:00', lib), { home })).not.toContain('번째') // second visit
  })
  it('one line a day; a comparison may be the second, never the third', () => {
    const line = { funLine: '먼저 한 줄' }
    expect(fact([m('2026-10-01T08:00'), m('2026-10-02T08:00', line)], m('2026-10-02T09:00', { activity: '쇼핑' }))).toBeNull()
    const chick = meal('2026-10-01T12:00', '칙필레 매장에 다녀오셨어요')
    expect(fact([chick, m('2026-10-02T08:00', line)], meal('2026-10-02T12:00', '식당에서 칼국수를 드셨어요'))).toContain('칙필레')
    expect(fact([chick, m('2026-10-02T08:00', line), m('2026-10-02T09:00', line)], meal('2026-10-02T12:00', '식당에서 칼국수를 드셨어요'))).toBeNull()
  })
})

describe('lineOk', () => {
  it('rejects long lines and made-up feelings', () => {
    expect(lineOk('칙필레 다음은 칼국수. 식단에 국경이 없어요.', 'f', [])).toBe(true)
    expect(lineOk('가'.repeat(41), 'f', [])).toBe(false)
    expect(lineOk('시작이 아주 맛있네요!', 'f', [])).toBe(false)
    expect(lineOk('새벽 공기가 차갑겠어요', 'f', [])).toBe(false)
    expect(lineOk('', 'f', [])).toBe(false)
  })
  it('rejects a joke told lately, whatever its particle', () => {
    const recent = ['지난번은 칙필레, 이번엔 칼국수네요. 식단에 국경이 없어요.']
    expect(lineOk('칼국수에서 케인스로. 메뉴판의 국경을 넘으셨네요.', 'f', recent)).toBe(false)
    expect(lineOk('칼국수에서 케인스로. 메뉴판이 넓어졌어요.', 'f', recent)).toBe(true)
  })
  it('the fact\'s own words may repeat', () => {
    expect(lineOk('도서관 세 번째. 도서관 단골 예약이에요.', '도서관 기록이 3번째예요', ['첫날. 도서관 사랑이에요.'])).toBe(true)
  })
})

describe('wordFunLine', () => {
  it('tries again, then gives up with no line', async () => {
    const ask = vi.fn().mockResolvedValueOnce('맛있는 하루예요').mockResolvedValueOnce('좋은 기록이에요')
    expect(await wordFunLine('메모', '사실', [], ask)).toBe('좋은 기록이에요')
    const bad = vi.fn().mockResolvedValue('맛있는 하루예요')
    expect(await wordFunLine('메모', '사실', [], bad)).toBe('')
    expect(bad).toHaveBeenCalledTimes(3)
  })
})

describe('addFunLine', () => {
  const flag = (on: boolean) => db.doc('admin_config/plans').set({ fairUse: { photosPerDay: null }, flags: { memoFunLine: on } })
  const args = (over = {}) => ({ memoId: 'm1', patientUid: 'p1', offsetMin: 0, lang: 'ko', current: m('2026-10-01T12:00', { memo: '공원 산책' }), ...over })
  const seed = () => db.doc('memos/m1').set({ patientUid: 'p1', takenAt: Timestamp.fromDate(at('2026-10-01T12:00')), memo: '공원 산책', scene: '장면', status: 'ready' })
  const ask = async () => '첫 페이지를 여셨어요'

  beforeEach(async () => { await clearFirestore(); resetPlansCache(); resetFunLineCache(); await seed() })

  it('off: nothing happens', async () => {
    await flag(false)
    await addFunLine(args(), ask)
    expect((await db.doc('memos/m1').get()).get('funLine')).toBeUndefined()
  })
  it('on: only its own fields change', async () => {
    await flag(true)
    await addFunLine(args(), ask)
    const d = (await db.doc('memos/m1').get()).data()!
    expect(d.funLine).toBe('첫 페이지를 여셨어요')
    expect(d).toMatchObject({ memo: '공원 산책', scene: '장면', status: 'ready' })
  })
  it('the allowlist lets one family in while the flag is off', async () => {
    await flag(false)
    await db.doc('admin_config/funLine').set({ allow: ['p1'] })
    await addFunLine(args(), ask)
    expect((await db.doc('memos/m1').get()).get('funLine')).toBe('첫 페이지를 여셨어요')
  })
  it('skips English accounts, which have no approved wording', async () => {
    await flag(true)
    await addFunLine(args({ lang: 'en' }), ask)
    expect((await db.doc('memos/m1').get()).get('funLine')).toBeUndefined()
  })
  it('no line passing means no field', async () => {
    await flag(true)
    await addFunLine(args(), async () => '맛있는 하루예요')
    expect((await db.doc('memos/m1').get()).get('funLine')).toBeUndefined()
  })
})
