import { describe, it, expect } from 'vitest'
import { monthDays, monthDaysLine } from './monthDays'

const on = (d: Date, status = 'ready') => ({ takenAt: { toDate: () => d }, status })
const now = new Date(2026, 9, 30, 12)

describe('days with a photo this month', () => {
  it('counts days, not photos, and only this month', () => {
    expect(monthDays([on(new Date(2026, 9, 1, 8)), on(new Date(2026, 9, 1, 20)), on(new Date(2026, 9, 29)), on(new Date(2026, 8, 30)), on(new Date(2025, 9, 2))], now)).toBe(2)
  })
  it('a gap takes nothing away', () => {
    expect(monthDays([on(new Date(2026, 9, 1)), on(new Date(2026, 9, 20))], now)).toBe(2)
  })
  it('leaves out failed photos and photos with no time yet', () => {
    expect(monthDays([on(new Date(2026, 9, 3), 'error'), {}], now)).toBe(0)
  })
  it('says nothing until the second day', () => {
    expect(monthDaysLine(0)).toBeNull()
    expect(monthDaysLine(1)).toBeNull()
    expect(monthDaysLine(12)).toBe('이번 달 12일째 기록 중')
  })
})
