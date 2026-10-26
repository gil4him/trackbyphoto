// 운영실 성장 on the page: labels, the y axis, the date marks and bar widths.
import { describe, it, expect, vi } from 'vitest'

vi.mock('./worker', () => ({ callWorker: vi.fn() }))

import { barWidth, dayLabel, fourMarks, installRate, installTotal, storeState, weekLabel, yTicks, type StoreInstalls } from './adminGrowth'

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

describe('설치 from the stores', () => {
  const days = (n: number | null) => Array.from({ length: 30 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, n }))
  const ok = (total: number, known = 30): StoreInstalls => ({ state: 'ok', missing: [], error: null, days: days(1), total, known })
  const need: StoreInstalls = { state: 'unconfigured', missing: ['ASC_KEY_ID', 'ASC_VENDOR_NUMBER'], error: null, days: days(null), total: 0, known: 0 }
  const bad: StoreInstalls = { state: 'error', missing: [], error: 'App Store Connect 401', days: days(null), total: 0, known: 0 }

  it('adds up the connected stores only, and is null while none is', () => {
    expect(installTotal(undefined)).toBeNull()
    expect(installTotal({ ios: need, android: need })).toBeNull()
    expect(installTotal({ ios: ok(12), android: need })).toBe(12)
    expect(installTotal({ ios: ok(12), android: ok(30) })).toBe(42)
    expect(installTotal({ ios: ok(0, 0), android: bad })).toBeNull()
  })

  it('words each store honestly', () => {
    expect(storeState(need)).toEqual({ kind: 'need', detail: 'ASC_KEY_ID, ASC_VENDOR_NUMBER' })
    expect(storeState(bad)).toEqual({ kind: 'bad', detail: 'App Store Connect 401' })
    expect(storeState(ok(0, 0))).toEqual({ kind: 'none', detail: '' })
    expect(storeState(ok(12, 28))).toEqual({ kind: 'num', detail: '28일치' })
    expect(storeState(ok(12))).toEqual({ kind: 'num', detail: '' })
  })

  it('shows sign-ups against installs only when there are installs', () => {
    expect(installRate(36, 50)).toBe('→ 72%')
    expect(installRate(36, null)).toBe('')
    expect(installRate(36, 0)).toBe('')
  })
})
