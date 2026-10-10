import { describe, it, expect, vi } from 'vitest'

vi.mock('../firebase', () => ({ db: {} }))
vi.mock('./worker', () => ({ callWorker: vi.fn() }))

import { noticeHourChoices, noticeHourLabel } from './digest'

describe('알림 시간', () => {
  it('offers 6, 8 and 10 in the evening, plus the stored hour if it is another', () => {
    expect(noticeHourChoices(20)).toEqual([18, 20, 22])
    expect(noticeHourChoices(19)).toEqual([18, 19, 20, 22])
  })

  it('says it the way people do', () => {
    expect(noticeHourLabel(18)).toBe('저녁 6시')
    expect(noticeHourLabel(20)).toBe('저녁 8시')
    expect(noticeHourLabel(22)).toBe('밤 10시')
    expect(noticeHourLabel(9)).toBe('오전 9시')
    expect(noticeHourLabel(15)).toBe('오후 3시')
  })
})
