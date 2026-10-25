// 운영실 매출: the plan mix, the calculator's arithmetic, and what it starts from.
import { describe, it, expect } from 'vitest'
import { paidTiers, planMix, priceFromLabel, revenue, startingAssumptions, upgrades, won } from './adminRevenue'
import type { AdminPerson } from './admin'
import type { Plans } from '../types'

const parent = (tier: AdminPerson['plan']['tier'], explicit = true) => ({ kind: 'parent', plan: { tier, explicit } }) as unknown as AdminPerson
const plans = { free: {}, plus: { priceLabel: '₩4,400/월' }, family: { priceLabel: '₩7,700/월' } } as unknown as Plans

describe('plan mix', () => {
  it('counts parents per plan, a parent never put on one as Free, family accounts not at all', () => {
    expect(planMix([parent('plus'), parent('family'), parent('plus', false), parent('free'), { kind: 'child', plan: { tier: 'plus', explicit: true } } as unknown as AdminPerson]))
      .toEqual({ free: 2, basic: 0, plus: 1, family: 1 })
  })
})

describe('calculator', () => {
  it('starts from the plans table\'s prices and the real paying families, never a made-up number', () => {
    expect(paidTiers(plans)).toEqual(['plus', 'family'])
    expect(priceFromLabel('₩4,400/월')).toBe(4400)
    expect(priceFromLabel(undefined)).toBeNull()
    expect(startingAssumptions(undefined, plans, { free: 9, basic: 0, plus: 2, family: 1 }))
      .toEqual({ prices: { plus: 4400, family: 7700 }, families: { plus: 2, family: 1 } })
    // Saved numbers win; a broken one falls back.
    expect(startingAssumptions({ prices: { plus: 5000 }, families: { family: -3 } }, plans, { free: 0, basic: 0, plus: 0, family: 4 }))
      .toEqual({ prices: { plus: 5000, family: 7700 }, families: { plus: 0, family: 4 } })
    // No price in the table: 0, for the owner to fill in.
    expect(startingAssumptions(undefined, { plus: {} } as unknown as Plans, { free: 0, basic: 0, plus: 0, family: 0 }).prices).toEqual({ plus: 0 })
  })

  it('takes VAT out (÷11), then 15% store fee, then the month\'s costs', () => {
    const w = revenue({ prices: { plus: 4400, family: 7700 }, families: { plus: 10, family: 2 } }, 30_000)
    expect(w.gross).toBe(59_400)
    expect(w.vat).toBe(5_400)
    expect(w.fee).toBeCloseTo(8_100)
    expect(w.net).toBeCloseTo(15_900)
    expect(revenue({ prices: { plus: 4400 }, families: { plus: 0 } }, null)).toEqual({ gross: 0, vat: 0, fee: 0, cost: null, net: 0 })
    expect(revenue({ prices: { plus: 4400 }, families: { plus: 1 } }, 10_000).net).toBeLessThan(0)
  })

  it('formats won', () => {
    expect(won(59400.4)).toBe('₩59,400')
    expect(won(-1200)).toBe('−₩1,200')
  })
})

describe('upgrades', () => {
  it('counts moves to a bigger plan in the window, not downgrades or old ones', () => {
    const rows = [
      { details: { from: 'free', to: 'plus' }, timestampMs: 100 },
      { details: { from: 'plus', to: 'family' }, timestampMs: 200 },
      { details: { from: 'family', to: 'free' }, timestampMs: 300 },
      { details: { from: 'free', to: 'plus' }, timestampMs: 10 },
      { details: { to: 'plus' }, timestampMs: 150 },
    ]
    expect(upgrades(rows, 50)).toBe(3)
  })
})
