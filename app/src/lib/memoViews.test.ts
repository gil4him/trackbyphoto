import { describe, it, expect } from 'vitest'
import { detailActions, mapLink } from './memoViews'

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

describe('detailActions', () => {
  const base = { simple: true, readOnly: false, native: false, hasPhoto: true, hasMemo: true, rewriting: false }

  it('simple, browser: share, save, edit, rewrite, then delete', () => {
    expect(detailActions(base)).toEqual(['share', 'save', 'edit', 'rewrite', 'delete'])
  })

  it('in the app the share sheet saves, so no separate save', () => {
    expect(detailActions({ ...base, native: true })).toEqual(['share', 'edit', 'rewrite', 'delete'])
  })

  it('full edition: no sharing', () => {
    expect(detailActions({ ...base, simple: false })).toEqual(['edit', 'rewrite', 'delete'])
  })

  it('no editing while the memo is being written', () => {
    expect(detailActions({ ...base, rewriting: true })).toEqual(['share', 'save', 'delete'])
    expect(detailActions({ ...base, hasMemo: false })).toEqual(['share', 'save', 'delete'])
  })

  it('nothing for someone who may only look', () => {
    expect(detailActions({ ...base, readOnly: true })).toEqual([])
  })
})
