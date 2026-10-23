// One account's copy of Firestore on the phone is never shown to another.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fs = vi.hoisted(() => ({ terminate: vi.fn(async () => {}), clearIndexedDbPersistence: vi.fn(async () => {}) }))
vi.mock('firebase/firestore', () => fs)
vi.mock('../firebase', () => ({ db: {} }))

import { cacheOwner, claimLocalCache, dropLocalCache } from './localCache'

const store = new Map<string, string>()
const replace = vi.fn()
const page = { pathname: '/', href: 'https://dayliesimple.web.app/' }

beforeEach(() => {
  store.clear()
  replace.mockClear()
  fs.terminate.mockClear()
  fs.clearIndexedDbPersistence.mockClear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  })
  vi.stubGlobal('window', { location: { ...page, replace } })
})

describe('the copy kept on the phone', () => {
  it('is claimed by the first account and kept for it', async () => {
    expect(await claimLocalCache('a')).toBe(false)
    expect(cacheOwner()).toBe('a')
    expect(await claimLocalCache('a')).toBe(false)
    expect(fs.clearIndexedDbPersistence).not.toHaveBeenCalled()
  })

  it("is dropped before another account sees it, and the page starts again", async () => {
    await claimLocalCache('a')
    expect(await claimLocalCache('b')).toBe(true)
    expect(fs.terminate).toHaveBeenCalledOnce()
    expect(fs.clearIndexedDbPersistence).toHaveBeenCalledOnce()
    expect(cacheOwner()).toBeNull()
    expect(replace).toHaveBeenCalledWith(page.href)
    // After the restart the new account claims it.
    expect(await claimLocalCache('b')).toBe(false)
    expect(cacheOwner()).toBe('b')
  })

  it('never reopens a /pair link, whose code is spent', async () => {
    vi.stubGlobal('window', { location: { pathname: '/pair', href: 'https://dayliesimple.web.app/pair?c=ABCD2345', replace } })
    await dropLocalCache()
    expect(replace).toHaveBeenCalledWith('/')
  })

  it('still starts again when clearing fails', async () => {
    fs.clearIndexedDbPersistence.mockRejectedValueOnce(new Error('in use'))
    await dropLocalCache('/')
    expect(replace).toHaveBeenCalledWith('/')
  })
})
