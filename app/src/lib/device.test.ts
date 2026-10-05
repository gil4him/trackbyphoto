// "연결이 해제되었어요" must come from the server, never from an empty cache.
import { describe, it, expect } from 'vitest'
import { unlinkedFrom } from './device'

const snap = (data: { status?: string } | null, fromCache: boolean) => ({
  exists: () => data !== null,
  data: () => data ?? undefined,
  metadata: { fromCache },
})

describe('whether this phone was unlinked', () => {
  it('is linked while its record is active, from the server or from the cache', () => {
    expect(unlinkedFrom(snap({ status: 'active' }, false))).toBe(false)
    expect(unlinkedFrom(snap({ status: 'active' }, true))).toBe(false)
  })

  it('is unlinked when the server says the record is revoked or gone', () => {
    expect(unlinkedFrom(snap({ status: 'revoked' }, false))).toBe(true)
    expect(unlinkedFrom(snap(null, false))).toBe(true)
  })

  it('is not decided by an empty answer from the phone itself (no connection, or a slow one)', () => {
    expect(unlinkedFrom(snap(null, true))).toBeNull()
    expect(unlinkedFrom(snap({ status: 'revoked' }, true))).toBeNull()
  })
})
