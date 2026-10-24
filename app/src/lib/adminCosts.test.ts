// 운영실 비용: entries, fixed costs per month, the exchange rate and the total.
import { describe, it, expect } from 'vitest'
import { DEFAULT_FIXED, budgetShare, costSummary, entryOf, fixedOf, fxOf, monthlyKRW, perFamily } from './adminCosts'

describe('비용', () => {
  it('reads the month\'s Firebase entry, with a $5 budget until one is set', () => {
    expect(entryOf(undefined, '2026-10')).toEqual({ firebaseUSD: null, budgetUSD: 5, parts: { storage: null, firestore: null, hosting: null, other: null } })
    expect(entryOf({ budgetUSD: 8, costs: { '2026-10': { firebaseUSD: 11.4, storageUSD: 8.21, budgetUSD: 10 } } }, '2026-10'))
      .toMatchObject({ firebaseUSD: 11.4, budgetUSD: 10, parts: { storage: 8.21, firestore: null } })
    expect(entryOf({ budgetUSD: 8 }, '2026-10').budgetUSD).toBe(8)
  })

  it('puts each fixed cost into a month: a year ÷ 12, a one-off nothing, not entered = unknown', () => {
    expect(monthlyKRW({ id: 'a', label: 'Apple', amount: 99, currency: 'USD', period: 'year' }, 1400)).toBe(11_550)
    expect(monthlyKRW({ id: 'p', label: 'Play', amount: 25, currency: 'USD', period: 'once' }, 1400)).toBe(0)
    expect(monthlyKRW({ id: 'm', label: '전기', amount: 6000, currency: 'KRW', period: 'month' }, 1400)).toBe(6_000)
    expect(monthlyKRW({ id: 'm', label: '전기', amount: null, currency: 'KRW', period: 'month' }, 1400)).toBeNull()
  })

  it('starts from the spec\'s fixed costs, and keeps what the owner saved', () => {
    expect(fixedOf(undefined)).toBe(DEFAULT_FIXED)
    expect(fixedOf({ fixed: [{ id: 'x', label: '도메인', amount: 20, currency: 'USD', period: 'year' }, { bad: 1 }] }))
      .toEqual([{ id: 'x', label: '도메인', amount: 20, currency: 'USD', period: 'year' }])
    expect(fxOf({ fx: 1350 })).toBe(1350)
    expect(fxOf({ fx: 0 })).toBe(1400)
  })

  it('adds what is known, and names what is missing', () => {
    const s = costSummary({ costs: { '2026-10': { firebaseUSD: 11.4 } } }, '2026-10', 2.5)
    expect(s.firebaseKRW).toBe(15_960)
    expect(s.aiKRW).toBe(3_500)
    expect(s.totalKRW).toBe(15_960 + 3_500 + 11_550)
    expect(s.missing).toEqual(['Mac mini 전기'])
    expect(costSummary(undefined, '2026-10', 0).missing).toEqual(['Firebase', 'Mac mini 전기'])
  })

  it('per family, and the budget meter', () => {
    expect(perFamily(31_010, 4)).toBe(7_753)
    expect(perFamily(31_010, 0)).toBeNull()
    expect(budgetShare(11.4, 5)).toBe(228)
    expect(budgetShare(1, 0)).toBe(0)
  })
})
