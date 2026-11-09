import { describe, it, expect } from 'vitest'
import { lateArrivalLine } from './lateArrival'

const at = (s: string) => new Date(s).getTime()

describe('a photo that arrived days after it was taken', () => {
  const now = new Date('2026-11-09T18:00:00')
  it('says when it was taken and that it arrived today', () => {
    expect(lateArrivalLine(at('2026-11-03T07:31:00'), at('2026-11-09T09:24:00'), now)).toBe('11월 3일 (화)에 찍은 사진이 오늘 도착했어요')
  })
  it('names the arrival day when that was not today', () => {
    expect(lateArrivalLine(at('2026-11-03T07:31:00'), at('2026-11-05T09:00:00'), now)).toBe('11월 3일 (화)에 찍은 사진이 11월 5일 (목)에 도착했어요')
  })
  it('says nothing for a photo that came in time, the same day, or with no arrival time yet', () => {
    expect(lateArrivalLine(at('2026-11-09T07:00:00'), at('2026-11-09T07:00:05'), now)).toBeNull()
    expect(lateArrivalLine(at('2026-11-09T07:00:00'), at('2026-11-09T17:00:00'), now)).toBeNull()
    expect(lateArrivalLine(at('2026-11-08T23:00:00'), at('2026-11-09T00:30:00'), now)).toBeNull()
    expect(lateArrivalLine(at('2026-11-03T07:31:00'), null, now)).toBeNull()
  })
})
