// 운영실 시스템: memo times in words, the failure share, restarts, platforms.
import { describe, it, expect } from 'vitest'
import { failRate, platformSplit, restartedMinutesAgo, secs } from './adminSystem'
import type { AdminPerson } from './admin'

describe('시스템 helpers', () => {
  it('says memo times in seconds and minutes', () => {
    expect(secs(18_200)).toBe('18초')
    expect(secs(95_000)).toBe('1분 35초')
    expect(secs(120_000)).toBe('2분')
  })
  it('shares failures with one decimal, and nothing for a quiet day', () => {
    expect(failRate({ failed: 5, total: 1284 })).toBe(0.4)
    expect(failRate({ failed: 0, total: 0 })).toBeNull()
  })
  it('notices a restart within the hour', () => {
    const now = Date.parse('2026-10-24T03:00:00Z')
    expect(restartedMinutesAgo('2026-10-24T02:35:00Z', now)).toBe(25)
    expect(restartedMinutesAgo('2026-10-24T01:00:00Z', now)).toBeNull()
  })
  it('splits linked phones by platform', () => {
    const p = (platforms: string[]) => ({ kind: 'parent', devices: { active: platforms.length, total: platforms.length, platforms } }) as unknown as AdminPerson
    expect(platformSplit([p(['ios']), p(['android']), p(['ios']), p([]), { kind: 'child', devices: { platforms: ['ios'] } } as unknown as AdminPerson]))
      .toEqual([{ label: 'iPhone', count: 2, pct: 67 }, { label: 'Android', count: 1, pct: 33 }])
    expect(platformSplit([])).toEqual([])
  })
})
