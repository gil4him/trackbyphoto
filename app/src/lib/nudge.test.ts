import { describe, it, expect } from 'vitest'
import { nudgeDismissed, nudgeDismissValue, NUDGE_DISMISS_MS } from './nudge'

describe('the 알림 켜기 nudge is closed for a week', () => {
  const now = 1_800_000_000_000
  it('comes back after seven days', () => {
    const closed = nudgeDismissValue(now)
    expect(nudgeDismissed(closed, now)).toBe(true)
    expect(nudgeDismissed(closed, now + NUDGE_DISMISS_MS - 1)).toBe(true)
    expect(nudgeDismissed(closed, now + NUDGE_DISMISS_MS)).toBe(false)
  })
  it('nothing stored, or junk: not closed; the old "1": closed', () => {
    expect(nudgeDismissed(null, now)).toBe(false)
    expect(nudgeDismissed('abc', now)).toBe(false)
    expect(nudgeDismissed('1', now)).toBe(true)
  })
})
