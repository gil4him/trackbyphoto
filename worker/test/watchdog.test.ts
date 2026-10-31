// The check from outside the Mac mini: what counts as a problem.
import { describe, it, expect } from 'vitest'
// @ts-expect-error a plain script, run by the workflow without a build
import { beatFrom, problemWith, STALE_MS } from '../scripts/watchdog.mjs'

const NOW = Date.parse('2026-10-30T12:00:00Z')

describe('problemWith', () => {
  it('is quiet while the worker beats and pushes get through', () => {
    expect(problemWith({ lastSeenMs: NOW - 60_000 }, NOW)).toBeNull()
    expect(problemWith({ lastSeenMs: NOW - 60_000, okAt: NOW - 10, failAt: NOW - 100 }, NOW)).toBeNull()
    expect(problemWith({ lastSeenMs: NOW - STALE_MS }, NOW)).toBeNull()
  })
  it('speaks when the heartbeat stops or never came', () => {
    expect(problemWith({ lastSeenMs: NOW - 45 * 60_000 }, NOW)).toContain('45 minutes ago')
    expect(problemWith({ lastSeenMs: null }, NOW)).toContain('never')
    expect(problemWith(null, NOW)).toContain('never')
  })
  it('speaks when the last push failed and none got through since', () => {
    const bad = { lastSeenMs: NOW - 1000, failAt: NOW - 100, okAt: NOW - 500, failCode: 'messaging/third-party-auth-error' }
    expect(problemWith(bad, NOW)).toContain('messaging/third-party-auth-error')
    expect(problemWith({ lastSeenMs: NOW - 1000, failAt: NOW - 100 }, NOW)).toContain('unknown')
  })
})

describe('beatFrom', () => {
  it('reads Firestore\'s REST shape, nulls included', () => {
    expect(beatFrom({ fields: {
      lastSeen: { timestampValue: '2026-10-30T12:00:00Z' },
      push: { mapValue: { fields: { okAt: { integerValue: '5' }, failAt: { nullValue: null }, failCode: { nullValue: null } } } },
    } })).toEqual({ lastSeenMs: NOW, okAt: 5, failAt: null, failCode: null })
    expect(beatFrom({ fields: { lastSeen: { timestampValue: '2026-10-30T12:00:00Z' } } })).toEqual({ lastSeenMs: NOW, okAt: null, failAt: null, failCode: null })
  })
})
