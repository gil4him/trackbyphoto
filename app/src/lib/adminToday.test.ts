// 운영실 오늘: the words and comparisons built from the worker's numbers.
import { describe, it, expect, vi } from 'vitest'

vi.mock('./worker', () => ({ callWorker: vi.fn() }))

import { briefing, busiestHour, kpis, story, vsYesterday, type AdminMetrics, type MetricsDay } from './adminToday'

const day = (i: number, over: Partial<MetricsDay> = {}): MetricsDay => ({
  date: `2026-10-${String(i).padStart(2, '0')}`, families: 0, activeParents7d: 0, photos: 0, reactions: 0, signups: 0, northStar: null, ...over,
})
const metrics = (days: MetricsDay[], over: Partial<AdminMetrics> = {}): AdminMetrics => {
  const last = days.at(-1)!
  return {
    families: last.families, parents: 10, children: 12, activeParents7d: last.activeParents7d,
    photosToday: last.photos, photosByHourToday: Array(24).fill(0), reactionsToday: last.reactions,
    signups7d: days.slice(-7).map((d) => d.signups),
    northStar: { families: 0, total: last.families, series7d: [], goal: 0.8 },
    yesterday: { parents: 0, photos: 0, familyReactions: 0 }, days, at: '2026-10-30T01:00:00.000Z', ...over,
  }
}

describe('briefing', () => {
  it('dates and greets by the clock in Seoul', () => {
    expect(briefing(new Date('2026-10-22T23:30:00Z'))).toEqual({ line: '10월 23일 금요일 · 아침 브리핑', greeting: '좋은 아침이에요' })
    expect(briefing(new Date('2026-10-23T05:00:00Z')).greeting).toBe('좋은 오후예요')
    expect(briefing(new Date('2026-10-23T12:00:00Z')).line).toBe('10월 23일 금요일 · 저녁 브리핑')
  })
})

describe('story', () => {
  const text = (y: AdminMetrics['yesterday']) => story(y).map((p) => (typeof p === 'string' ? p : p.n)).join('')
  it('says yesterday in one sentence, from the numbers it is given', () => {
    expect(text({ parents: 152, photos: 1284, familyReactions: 2031 })).toBe('어제 부모님 152분이 사진 1,284장을 보냈고, 가족이 2,031번 마음을 전했어요.')
    expect(story({ parents: 2, photos: 5, familyReactions: 3 }).filter((p) => typeof p !== 'string')).toHaveLength(3)
  })
  it('never claims what did not happen', () => {
    expect(text({ parents: 1, photos: 2, familyReactions: 0 })).toBe('어제 부모님 1분이 사진 2장을 보냈어요. 가족의 하트나 글은 아직 없었어요.')
    expect(text({ parents: 0, photos: 0, familyReactions: 4 })).toBe('어제는 사진이 없었고, 가족이 4번 마음을 전했어요.')
    expect(text({ parents: 0, photos: 0, familyReactions: 0 })).toBe('어제는 보낸 사진도, 가족의 하트나 글도 없었어요.')
  })
})

describe('kpis', () => {
  it('compares today with yesterday, and never divides by zero', () => {
    expect(vsYesterday(1284, 1211)).toEqual({ delta: '▲ 6% 어제보다', trend: 'up' })
    expect(vsYesterday(5, 10)).toEqual({ delta: '▼ 50% 어제보다', trend: 'down' })
    expect(vsYesterday(3, 0)).toEqual({ delta: '▲ 3 어제보다', trend: 'up' })
    expect(vsYesterday(0, 0)).toEqual({ delta: '어제와 같아요', trend: 'flat' })
  })

  it('7일: five cards with this week\'s change and a 7-point line each', () => {
    const days = Array.from({ length: 30 }, (_, i) => day(i + 1, { families: 10 + i, activeParents7d: 5, photos: i, reactions: 2, signups: i >= 16 && i < 23 ? 2 : i >= 23 ? 1 : 0 }))
    const k = kpis(metrics(days), 7)
    expect(k.map((x) => x.label)).toEqual(['함께하는 가족', '사진 보낸 부모님', '오늘 사진', '하트·글 답장', '신규 가입'])
    expect(k.every((x) => x.series.length === 7)).toBe(true)
    expect(k[0]).toMatchObject({ value: 39, delta: '▲ 6 이번 주', trend: 'up' })
    expect(k[1]).toMatchObject({ value: 5, delta: '부모님 10분 중 50%', trend: 'flat' })
    expect(k[2]).toMatchObject({ value: 29, trend: 'up' })
    expect(k[3]).toMatchObject({ value: 2, delta: '어제와 같아요', trend: 'flat' })
    expect(k[4]).toMatchObject({ value: 7, delta: '▼ 7 지난주보다', trend: 'down' })
  })

  it('30일: averages and totals over the month', () => {
    const days = Array.from({ length: 30 }, (_, i) => day(i + 1, { families: 3, photos: 4, reactions: 6, signups: 1 }))
    const k = kpis(metrics(days), 30)
    expect(k.every((x) => x.series.length === 30)).toBe(true)
    expect(k[0]).toMatchObject({ delta: '30일 변화 없음', trend: 'flat' })
    expect(k[2]).toMatchObject({ label: '하루 평균 사진', value: 4 })
    expect(k[3]).toMatchObject({ label: '하트·글 답장 /일', value: 6 })
    expect(k[4]).toMatchObject({ value: 30, delta: '최근 30일 합계' })
  })

  it('a service with no parents says 0%, not NaN', () => {
    const k = kpis(metrics([day(1)], { parents: 0 }), 7)
    expect(k[1].delta).toBe('부모님 0분 중 0%')
  })
})

describe('busiestHour', () => {
  it('finds the busiest hour between 5시 and 22시, or none', () => {
    const h = Array(24).fill(0)
    expect(busiestHour(h)).toBeNull()
    h[9] = 12; h[14] = 7; h[3] = 50
    expect(busiestHour(h)).toBe(9)
  })
})
