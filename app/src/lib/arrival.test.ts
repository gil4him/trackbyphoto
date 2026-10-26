// 어디서 들어왔나: what the app remembers about where a visit came from.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }))
vi.mock('firebase/firestore', () => ({ serverTimestamp: () => ({ server: true }) }))

import { arrivalNow, noteArrivalRef, platformNow, refFrom } from './arrival'

describe('refFrom', () => {
  it('takes ?from= first, lower-cased and short', () => {
    expect(refFrom('?from=Tester', 'https://naver.com/', 'dayliesimple.web.app')).toBe('tester')
    expect(refFrom('?utm_source=kakao&x=1', '', 'dayliesimple.web.app')).toBe('kakao')
    expect(refFrom(`?from=${'a'.repeat(60)}`, '', 'x')).toHaveLength(40)
  })
  it('falls back to the referring site, never our own', () => {
    expect(refFrom('', 'https://www.naver.com/search?q=daylie', 'dayliesimple.web.app')).toBe('naver.com')
    expect(refFrom('', 'https://dayliesimple.web.app/settings', 'dayliesimple.web.app')).toBeNull()
    expect(refFrom('', 'not a url', 'dayliesimple.web.app')).toBeNull()
    expect(refFrom('', '', 'dayliesimple.web.app')).toBeNull()
  })
})

describe('the remembered ref', () => {
  it('is kept from the first visit and taken by the stamp', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)) },
      removeItem: (k: string) => { store.delete(k) },
    })
    vi.stubGlobal('window', {})
    const loc = { search: '?from=tester', hostname: 'www.dayliesimple.web.app' }
    vi.stubGlobal('location', loc)
    vi.stubGlobal('document', { referrer: '' })
    noteArrivalRef()
    loc.search = '?from=other'
    noteArrivalRef()
    expect(store.get('daylie.arrival.ref')).toBe('tester')
    expect(platformNow()).toBe('web')
    expect(arrivalNow()).toEqual({ platform: 'web', ref: 'tester', at: { server: true } })
    expect(store.has('daylie.arrival.ref')).toBe(false)
    expect(arrivalNow().ref).toBeNull()
    vi.unstubAllGlobals()
  })
})
