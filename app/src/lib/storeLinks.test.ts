import { describe, it, expect } from 'vitest'
import { PLAY_STORE_URL, inAnyStore, inStore, playStoreUrl, storeKind, storeUrlFor } from './storeLinks'

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
    expect(storeUrlFor('android', '', undefined, true)).toBe(PLAY_STORE_URL)
    expect(storeUrlFor('android', '', undefined, false)).toBeNull()
    expect(storeUrlFor('ios', '')).toBeNull()
    expect(storeUrlFor('ios', 'https://apps.apple.com/app/id123')).toBe('https://apps.apple.com/app/id123')
    expect(storeUrlFor('other', 'https://apps.apple.com/app/id123')).toBeNull()
  })
})

describe('Play install referrer', () => {
  it('carries the pair code to the installed app', () => {
    expect(playStoreUrl('ABCD2345')).toBe(`${PLAY_STORE_URL}&referrer=c%3DABCD2345`)
    expect(storeUrlFor('android', '', 'ABCD2345', true)).toBe(`${PLAY_STORE_URL}&referrer=c%3DABCD2345`)
  })

  it('is the plain page without a whole code', () => {
    expect(playStoreUrl()).toBe(PLAY_STORE_URL)
    expect(playStoreUrl('ABC')).toBe(PLAY_STORE_URL)
  })
})

describe('which store has the app', () => {
  it('Play once VITE_PLAY_LIVE is set, the App Store once its link is', () => {
    expect(inStore('android', false, '')).toBe(false)
    expect(inStore('android', true, '')).toBe(true)
    expect(inStore('ios', true, '')).toBe(false)
    expect(inStore('ios', false, 'https://apps.apple.com/app/id1')).toBe(true)
    expect(inAnyStore(false, '')).toBe(false)
    expect(inAnyStore(false, 'https://apps.apple.com/app/id1')).toBe(true)
  })
})
