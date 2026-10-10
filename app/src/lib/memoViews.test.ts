import { describe, it, expect } from 'vitest'
import { mapLink } from './memoViews'

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
