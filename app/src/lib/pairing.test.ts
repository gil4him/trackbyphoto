import { describe, it, expect, vi } from 'vitest'

vi.mock('./worker', () => ({ callWorker: vi.fn() }))

import { firstTimeOnly, pairCodeFromReferrer, pairCodeFromText } from './pairing'
import { PUBLIC_ORIGIN } from './publicUrl'

describe('pairCodeFromText — only our /pair links count', () => {
  it('reads the code from ?c= and #c=', () => {
    expect(pairCodeFromText(`${PUBLIC_ORIGIN}/pair?c=ABCD2345`)).toBe('ABCD2345')
    expect(pairCodeFromText(`${PUBLIC_ORIGIN}/pair#c=ABCD2345`)).toBe('ABCD2345')
  })

  it('tolerates case, dashes, spaces around the text and a trailing slash', () => {
    expect(pairCodeFromText(`  ${PUBLIC_ORIGIN}/pair/?c=abcd-2345\n`)).toBe('ABCD2345')
  })

  it('rejects another site, another path, or a bare code', () => {
    expect(pairCodeFromText('https://evil.example/pair?c=ABCD2345')).toBeNull()
    expect(pairCodeFromText(`${PUBLIC_ORIGIN}/accept?c=ABCD2345`)).toBeNull()
    expect(pairCodeFromText('ABCD2345')).toBeNull()
  })

  it('rejects a missing, short or long code', () => {
    expect(pairCodeFromText(`${PUBLIC_ORIGIN}/pair`)).toBeNull()
    expect(pairCodeFromText(`${PUBLIC_ORIGIN}/pair?c=ABC`)).toBeNull()
    expect(pairCodeFromText(`${PUBLIC_ORIGIN}/pair?c=ABCD23456789`)).toBeNull()
  })

  it('ignores garbage', () => {
    expect(pairCodeFromText('')).toBeNull()
    expect(pairCodeFromText('안녕하세요')).toBeNull()
  })
})

describe('firstTimeOnly', () => {
  const fakeStorage = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
  }

  it('is true once per key, then remembered', () => {
    const s = fakeStorage()
    expect(firstTimeOnly('a', s)).toBe(true)
    expect(firstTimeOnly('a', s)).toBe(false)
    expect(firstTimeOnly('b', s)).toBe(true)
  })

  it('counts unreadable or missing storage as the first time', () => {
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => {} }
    expect(firstTimeOnly('a', broken)).toBe(true)
    expect(firstTimeOnly('a', undefined)).toBe(true)
  })
})

describe('pairCodeFromReferrer', () => {
  it('reads c=CODE from the Play referrer, or a whole /pair link', () => {
    expect(pairCodeFromReferrer('c=ABCD2345')).toBe('ABCD2345')
    expect(pairCodeFromReferrer('utm_source=x&c=abcd2345')).toBe('ABCD2345')
    expect(pairCodeFromReferrer(`${PUBLIC_ORIGIN}/pair?c=ABCD2345`)).toBe('ABCD2345')
  })

  it('ignores ordinary referrers and anything not exactly 8 letters/digits', () => {
    expect(pairCodeFromReferrer('utm_source=google-play&utm_medium=organic')).toBeNull()
    expect(pairCodeFromReferrer('')).toBeNull()
    expect(pairCodeFromReferrer('c=ABC')).toBeNull()
    expect(pairCodeFromReferrer('c=ABCD-2345')).toBeNull()
    expect(pairCodeFromReferrer('c=ABCD23456789')).toBeNull()
  })
})
