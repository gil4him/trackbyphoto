import { describe, it, expect } from 'vitest'
import { nudgeDismissed, nudgeDismissValue, NUDGE_DISMISS_MS, NUDGE_SHORT_MS } from './nudge'

describe('the 알림 켜기 nudge comes back', () => {
  const now = 1_800_000_000_000
  it('after a day for the first three closes', () => {
    let closed = nudgeDismissValue(now)
    for (let i = 0; i < 3; i++) {
      expect(nudgeDismissed(closed, now + NUDGE_SHORT_MS - 1)).toBe(true)
      expect(nudgeDismissed(closed, now + NUDGE_SHORT_MS)).toBe(false)
      if (i < 2) closed = nudgeDismissValue(now, closed)
    }
  })
  it('after a week from the fourth', () => {
    const fourth = nudgeDismissValue(now, `${now}:3`)
    expect(nudgeDismissed(fourth, now + NUDGE_DISMISS_MS - 1)).toBe(true)
    expect(nudgeDismissed(fourth, now + NUDGE_DISMISS_MS)).toBe(false)
  })
  it('nothing stored or junk: not closed; older values have run out', () => {
    expect(nudgeDismissed(null, now)).toBe(false)
    expect(nudgeDismissed('abc', now)).toBe(false)
    expect(nudgeDismissed('1', now)).toBe(false)
    expect(nudgeDismissed(String(now), now + NUDGE_SHORT_MS - 1)).toBe(true)
    expect(nudgeDismissed(String(now), now + NUDGE_SHORT_MS)).toBe(false)
  })
})
