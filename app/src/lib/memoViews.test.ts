import { describe, it, expect } from 'vitest'
import { cardMeta, cardTitle, clock, dayCaption, dayEyebrow, detailActions, farthestKm, memosOnDay, reactionSummary } from './memoViews'
import type { Memo, Reaction } from '../types'

describe('detailActions', () => {
  const base = { simple: true, readOnly: false, hasPhoto: true, hasMemo: true, rewriting: false }

  it('simple: share, edit, rewrite, then delete', () => {
    expect(detailActions(base)).toEqual(['share', 'edit', 'rewrite', 'delete'])
  })

  it('full edition: no sharing', () => {
    expect(detailActions({ ...base, simple: false })).toEqual(['edit', 'rewrite', 'delete'])
  })

  it('no editing while the memo is being written', () => {
    expect(detailActions({ ...base, rewriting: true })).toEqual(['share', 'delete'])
    expect(detailActions({ ...base, hasMemo: false })).toEqual(['share', 'delete'])
  })

  it('nothing for someone who may only look', () => {
    expect(detailActions({ ...base, readOnly: true })).toEqual([])
  })
})

describe("the parent's day (home timeline)", () => {
  const at = (y: number, mo: number, d: number, h: number, mi: number) => ({ toDate: () => new Date(y, mo - 1, d, h, mi) })
  const memo = (o: Omit<Partial<Memo>, 'takenAt' | 'activity'> & { takenAt?: unknown; activity?: string }) => ({ status: 'ready', memo: '', activity: '', place: '', lat: null, lng: null, ...o }) as unknown as Memo
  const m = (o: { status: Memo['status']; memo: string; activity: string }) => o as unknown as Pick<Memo, 'status' | 'memo' | 'activity'>
  const pm = (o: { place: string; activity: string }) => o as unknown as Pick<Memo, 'place' | 'activity'>
  const rx = (kind: Reaction['kind'], actorName: string) => ({ kind, actorName }) as Reaction

  it('eyebrow and clock', () => {
    expect(dayEyebrow(new Date(2026, 9, 4))).toBe('10월 4일 일요일')
    expect(dayEyebrow(new Date(2026, 9, 3))).toBe('10월 3일 토요일')
    expect(clock(new Date(2026, 9, 4, 15, 30))).toBe('15:30')
    expect(clock(new Date(2026, 9, 4, 8, 5))).toBe('08:05')
  })

  it("today's memos, in the order given", () => {
    const memos = [memo({ id: 'b', takenAt: at(2026, 10, 4, 18, 0) }), memo({ id: 'a', takenAt: at(2026, 10, 4, 9, 0) }), memo({ id: 'y', takenAt: at(2026, 10, 3, 23, 59) })]
    expect(memosOnDay(memos, new Date(2026, 9, 4, 12, 0)).map((m) => m.id)).toEqual(['b', 'a'])
    expect(memosOnDay(memos, new Date(2026, 9, 5))).toEqual([])
  })

  it('how far the day went, and the caption', () => {
    const home = { lat: 37.5, lng: 127.0 }
    const memos = [memo({ takenAt: at(2026, 10, 4, 9, 0), lat: 37.5, lng: 127.0 }), memo({ takenAt: at(2026, 10, 4, 9, 0), lat: 37.518, lng: 127.0 }), memo({ takenAt: at(2026, 10, 4, 9, 0) })]
    const km = farthestKm(memos, home)!
    expect(km).toBeGreaterThan(1.9); expect(km).toBeLessThan(2.1)
    expect(dayCaption(9, km)).toBe('사진 9장 · 집에서 최대 2.0km')
    expect(dayCaption(3, 12.4)).toBe('사진 3장 · 집에서 최대 12km')
    expect(farthestKm(memos, null)).toBeNull()
    expect(farthestKm([memo({ takenAt: at(2026, 10, 4, 9, 0) })], home)).toBeNull()
    expect(dayCaption(0, null)).toBe('사진 0장')
  })

  it('hearts by name (once each) and the number of words, in the card line', () => {
    const items = [rx('heart', '지민'), rx('heart', '지민'), rx('heart', '민수'), rx('comment', '지민'), rx('voice', '엄마')]
    expect(reactionSummary(items)).toEqual({ hearts: ['지민', '민수'], words: 2 })
    expect(cardMeta(pm({ place: '석촌호수 · 잠실동', activity: '산책' }), items)).toBe('석촌호수 · 잠실동 · 산책 · ♥ 지민, 민수 · 💬 2')
    expect(cardMeta(pm({ place: '', activity: '휴식' }), undefined)).toBe('휴식')
    expect(cardMeta(pm({ place: '', activity: '' }), [rx('comment', 'x')])).toBe('💬 1')
  })

  it("the card's title", () => {
    expect(cardTitle(m({ status: 'ready', memo: '노을 지는 호숫가 산책', activity: '산책' }))).toBe('노을 지는 호숫가 산책')
    expect(cardTitle(m({ status: 'ready', memo: '사진을 남겼어요', activity: '기타' }))).toBe('사진을 남겼어요')
    expect(cardTitle(m({ status: 'ready', memo: '', activity: '' }))).toBe('기록')
    expect(cardTitle(m({ status: 'pending', memo: '', activity: '' }))).toBe('메모 작성 중…')
    expect(cardTitle(m({ status: 'pending', memo: '', activity: '' }), true)).toContain('쉬는 중')
  })
})
