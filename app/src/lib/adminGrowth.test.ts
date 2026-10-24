// 운영실 성장 on the page: labels, the y axis, the date marks and bar widths.
import { describe, it, expect, vi } from 'vitest'

vi.mock('./worker', () => ({ callWorker: vi.fn() }))

import { barWidth, dayLabel, fourMarks, weekLabel, yTicks } from './adminGrowth'

describe('성장 helpers', () => {
  it('names weeks and days the Korean way', () => {
    expect(weekLabel('2026-09-21')).toBe('9/21 주')
    expect(dayLabel('2026-10-03')).toBe('10월 3일')
  })

  it('rounds the y axis up to a friendly top, in about four steps', () => {
    expect(yTicks(186)).toEqual([0, 50, 100, 150, 200])
    expect(yTicks(7)).toEqual([0, 2, 4, 6, 8])
    expect(yTicks(3)).toEqual([0, 1, 2, 3])
    expect(yTicks(0)).toEqual([0, 1])
  })

  it('puts four date marks across the series, first and last included', () => {
    expect(fourMarks(90)).toEqual([0, 30, 59, 89])
    expect(fourMarks(2)).toEqual([0, 1])
    expect(fourMarks(1)).toEqual([0])
  })

  it('draws each stage against the sign-ups, a sliver for small counts, nothing for zero', () => {
    expect(barWidth(36, 72)).toBe(50)
    expect(barWidth(1, 100)).toBe(14)
    expect(barWidth(0, 100)).toBe(0)
    expect(barWidth(0, 0)).toBe(0)
  })
})
