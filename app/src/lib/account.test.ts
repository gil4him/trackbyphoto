// A phone signs out only when the account is really gone, never on a weak connection.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./worker', () => ({ callWorker: vi.fn() }))

import { accountGone, forgetAccountKeys } from './account'
import { Outbox, memoryStore, type OutboxBackend, type OutboxItem } from './outbox'

describe('whether the account is gone', () => {
  it('is gone for the answers that mean deleted or disabled', () => {
    for (const code of ['auth/user-token-expired', 'auth/user-not-found', 'auth/user-disabled', 'auth/invalid-user-token', 'auth/invalid-refresh-token']) {
      expect(accountGone({ code })).toBe(true)
    }
  })

  it('is not gone for no connection, a refused read or anything unknown', () => {
    expect(accountGone({ code: 'auth/network-request-failed' })).toBe(false)
    expect(accountGone({ code: 'permission-denied' })).toBe(false)
    expect(accountGone(new Error('boom'))).toBe(false)
    expect(accountGone('auth/user-not-found')).toBe(false)
    expect(accountGone(undefined)).toBe(false)
    expect(accountGone(null)).toBe(false)
  })
})

describe('forgetting a deleted account', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    })
  })

  it('removes that account\'s settings and choice of person, and nothing else', () => {
    for (const k of ['tbp.settings.a', 'tbp.activePatient.a', 'tbp.settings.b', 'tbp.plans.v1']) store.set(k, '1')
    forgetAccountKeys('a')
    expect([...store.keys()].sort()).toEqual(['tbp.plans.v1', 'tbp.settings.b'])
  })

  it('drops that account\'s photos still waiting on the phone, and keeps the others', async () => {
    const backend = { upload: vi.fn(), createMemo: vi.fn(), patchGeo: vi.fn() } as unknown as OutboxBackend
    const s = memoryStore()
    const item = (photoId: string, uid: string) => ({
      photoId, uid, takenAtMs: 1, uploaded: false, attempts: 0, nextTryAt: 9e15, blob: new Blob(['x']),
    }) as unknown as OutboxItem
    await s.put(item('p1', 'a'))
    await s.put(item('p2', 'b'))
    await new Outbox(s, backend).drop('a')
    expect((await s.all()).map((i) => i.photoId)).toEqual(['p2'])
  })
})
