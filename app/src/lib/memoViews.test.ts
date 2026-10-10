import { describe, it, expect } from 'vitest'
import { mapLink, todayMemos } from './memoViews'
import type { Memo } from '../types'

const at = (iso: string) => ({ id: iso, takenAt: { toDate: () => new Date(iso) } }) as unknown as Memo

describe('todayMemos', () => {
  it('keeps what was taken today on this phone\'s clock', () => {
    const now = new Date(2026, 9, 9, 21, 0)
    const memos = [at(new Date(2026, 9, 9, 0, 1).toISOString()), at(new Date(2026, 9, 8, 23, 59).toISOString()), at(new Date(2026, 9, 9, 20, 0).toISOString())]
    expect(todayMemos(memos, now)).toHaveLength(2)
  })
})

describe('mapLink', () => {
  const memo = { lat: 37.5, lng: 127.01, place: '서초동' }

  it('simple: Google Maps', () => {
    expect(mapLink(memo, true)).toBe('https://www.google.com/maps/search/?api=1&query=37.5,127.01')
  })

  it('full: Apple Maps, as before', () => {
    expect(mapLink(memo, false)).toBe(`https://maps.apple.com/?ll=37.5,127.01&q=${encodeURIComponent('서초동')}`)
  })

  it('no link without coordinates', () => {
    expect(mapLink({ lat: undefined, lng: undefined, place: '' } as never, true)).toBeNull()
  })
})
