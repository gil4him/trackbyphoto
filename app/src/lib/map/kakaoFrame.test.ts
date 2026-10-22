// The store apps' Kakao map: the site's map page in an iframe.
import { describe, it, expect } from 'vitest'
import { frameMessage, kakaoFrameUrl } from './kakaoFrame'

describe('kakaoFrameUrl', () => {
  it("points at the site's map page with the key, pins and home in the hash", () => {
    const url = kakaoFrameUrl({ key: 'k1', pins: [{ lat: 37.5145, lng: 127.1059, label: '1', photoUrl: 'https://x/p.jpg' }], home: { lat: 37.5, lng: 127.1 }, pad: 28 }, 'https://dayliesimple.web.app')
    expect(url.startsWith('https://dayliesimple.web.app/kakao-map.html#')).toBe(true)
    const data = JSON.parse(decodeURIComponent(url.split('#')[1]))
    expect(data).toEqual({ k: 'k1', pins: [{ lat: 37.5145, lng: 127.1059, label: '1', photoUrl: 'https://x/p.jpg' }], home: { lat: 37.5, lng: 127.1 }, pad: 28 })
  })
})

describe('frameMessage', () => {
  it('reads only the map page’s own messages', () => {
    expect(frameMessage({ source: 'daylie-map', type: 'ready' })).toEqual({ type: 'ready' })
    expect(frameMessage({ source: 'daylie-map', type: 'pick', index: 2 })).toEqual({ type: 'pick', index: 2 })
    expect(frameMessage({ source: 'daylie-map', type: 'pick' })).toBeNull()
    expect(frameMessage({ source: 'other', type: 'ready' })).toBeNull()
    expect(frameMessage('ready')).toBeNull()
  })
})
