import { describe, it, expect } from 'vitest'
import { STALE_MS, workerStatus } from './workerStatus'

const NOW = 1_800_000_000_000

describe('workerStatus', () => {
  it('is unknown until a heartbeat has been read', () => {
    expect(workerStatus(null, NOW)).toBe('unknown')
  })

  it('is ok for a recent beat with the model up', () => {
    expect(workerStatus({ lastSeenMs: NOW - 60_000, modelUp: true }, NOW)).toBe('ok')
  })

  it('is down when the beats stopped or the model is not answering', () => {
    expect(workerStatus({ lastSeenMs: NOW - STALE_MS - 1, modelUp: true }, NOW)).toBe('down')
    expect(workerStatus({ lastSeenMs: NOW - 1_000, modelUp: false }, NOW)).toBe('down')
  })

  it('tolerates a phone clock that is behind the server', () => {
    expect(workerStatus({ lastSeenMs: NOW + 90_000, modelUp: true }, NOW)).toBe('ok')
  })
})
