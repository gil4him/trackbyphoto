import { describe, it, expect } from 'vitest'
import { dayHeading, landingDay } from '../util'

const d = (m: number, day: number) => new Date(2026, m - 1, day)

describe('landingDay', () => {
  const days = [d(10, 24), d(10, 22), d(10, 18)]
  it('the day itself when it has photos', () => expect(landingDay(days, d(10, 22))).toEqual(d(10, 22)))
  it('else the nearest earlier day', () => expect(landingDay(days, d(10, 20))).toEqual(d(10, 18)))
  it('a day after the newest lands on the newest; before the oldest, on the oldest', () => {
    expect(landingDay(days, d(10, 30))).toEqual(d(10, 24))
    expect(landingDay(days, d(10, 1))).toEqual(d(10, 18))
  })
  it('nothing to land on without days', () => expect(landingDay([], d(10, 1))).toBeNull())
})

describe('dayHeading', () => {
  const now = new Date(2026, 9, 24, 12)
  it('오늘 and 어제 with the date, then the date alone; the year only when not this year', () => {
    expect(dayHeading(new Date(2026, 9, 24, 8), now)).toBe('오늘 · 10월 24일 (토)')
    expect(dayHeading(new Date(2026, 9, 23, 22), now)).toBe('어제 · 10월 23일 (금)')
    expect(dayHeading(new Date(2026, 9, 21), now)).toBe('10월 21일 (수)')
    expect(dayHeading(new Date(2025, 11, 31), now)).toBe('2025년 12월 31일 (수)')
  })
})
