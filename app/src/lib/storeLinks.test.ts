import { describe, it, expect } from 'vitest'
import { PLAY_STORE_URL, storeKind, storeUrlFor } from './storeLinks'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 KAKAOTALK 10.8.0'
const GALAXY = 'Mozilla/5.0 (Linux; Android 15; SM-S921N) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Safari/605.1.15'

describe('store links', () => {
  it('tells phones apart', () => {
    expect(storeKind(IPHONE)).toBe('ios')
    expect(storeKind(GALAXY)).toBe('android')
    expect(storeKind(MAC)).toBe('other')
  })

  it('sends Android to Play and iPhone to the App Store once it is known', () => {
    expect(storeUrlFor('android')).toBe(PLAY_STORE_URL)
    expect(storeUrlFor('ios', '')).toBeNull()
    expect(storeUrlFor('ios', 'https://apps.apple.com/app/id123')).toBe('https://apps.apple.com/app/id123')
    expect(storeUrlFor('other', 'https://apps.apple.com/app/id123')).toBeNull()
  })
})
