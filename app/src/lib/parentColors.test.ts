import { describe, it, expect } from 'vitest'
import { PARENT_COLORS, parentColors } from './parentColors'

describe('parentColors', () => {
  it('one parent keeps the usual accent', () => {
    expect(parentColors(['a'])).toEqual({ a: 'var(--accent)' })
  })
  it('several parents each get their own colour, in list order', () => {
    const c = parentColors(['a', 'b', 'c'])
    expect([c.a, c.b, c.c]).toEqual(PARENT_COLORS.slice(0, 3))
    expect(new Set(Object.values(c)).size).toBe(3)
  })
})
