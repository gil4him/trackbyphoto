import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clearNeedsGeo, GEO_ATTACH_CAP_MS, noteNeedsGeo, resumeGeoRetries } from './geoRetry'

const HERE = { lat: 37.5, lng: 127 }
const store = new Map<string, string>()
let blocked = false
const pending = () => JSON.parse(store.get('tbp:geoPending') || '[]') as { id: string }[]
const guard = () => { if (blocked) throw new Error('blocked') }

beforeEach(() => {
  store.clear(); blocked = false
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => { guard(); return store.has(k) ? store.get(k)! : null },
    setItem: (k: string, v: string) => { guard(); store.set(k, String(v)) },
    removeItem: (k: string) => { guard(); store.delete(k) },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('resuming the location search', () => {
  it('one search serves every waiting photo, and they are forgotten once attached', async () => {
    const now = 1_000_000
    noteNeedsGeo('a', now - 60_000)
    noteNeedsGeo('b', now - 120_000)
    const find = vi.fn(async () => HERE)
    const attach = vi.fn<(id: string) => Promise<void>>(async () => {})
    await resumeGeoRetries({ find, attach, now: () => now })
    expect(find).toHaveBeenCalledTimes(1)
    expect(attach.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'b'])
    expect(pending()).toEqual([])
  })

  it('never attaches a fix to a photo taken more than 15 minutes ago', async () => {
    const now = 5_000_000
    noteNeedsGeo('old', now - GEO_ATTACH_CAP_MS - 1)
    const find = vi.fn(async () => HERE)
    await resumeGeoRetries({ find, attach: vi.fn(), now: () => now })
    expect(find).not.toHaveBeenCalled()
    expect(pending()).toEqual([])
  })

  it('keeps a photo whose location could not be attached, and one with no fix yet', async () => {
    const now = 1_000_000
    noteNeedsGeo('a', now)
    await resumeGeoRetries({ find: async () => HERE, attach: async () => { throw new Error('offline') }, now: () => now })
    expect(pending().map((p) => p.id)).toEqual(['a'])
    await resumeGeoRetries({ find: async () => null, attach: vi.fn(), now: () => now })
    expect(pending().map((p) => p.id)).toEqual(['a'])
    clearNeedsGeo('a')
    expect(pending()).toEqual([])
  })

  it('runs one search at a time', async () => {
    noteNeedsGeo('a', Date.now())
    let release: (g: typeof HERE) => void = () => {}
    const find = vi.fn(() => new Promise<typeof HERE>((r) => { release = r }))
    const first = resumeGeoRetries({ find, attach: async () => {} })
    const second = resumeGeoRetries({ find, attach: async () => {} })
    release(HERE)
    await Promise.all([first, second])
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('survives blocked storage', async () => {
    blocked = true
    expect(() => noteNeedsGeo('a', 1)).not.toThrow()
    await expect(resumeGeoRetries({ find: async () => HERE, attach: async () => {} })).resolves.toBeUndefined()
  })
})
