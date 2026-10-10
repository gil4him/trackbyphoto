import { describe, it, expect, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))

import { installPath, type InstallEnv } from './install'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const env = (over: Partial<InstallEnv>): InstallEnv => ({ native: false, standalone: false, userAgent: MAC, canPrompt: false, ...over })

describe('installPath', () => {
  it('has nothing to do in the installed app or from a home-screen icon', () => {
    expect(installPath(env({ native: true, userAgent: IPHONE }))).toBe('none')
    expect(installPath(env({ standalone: true, userAgent: IPHONE }))).toBe('none')
  })
  it('sends a KakaoTalk in-app browser to Safari or Chrome first', () => {
    expect(installPath(env({ userAgent: `${IPHONE} KAKAOTALK 11.2.0` }))).toBe('in-app')
    expect(installPath(env({ userAgent: `${ANDROID} KAKAOTALK 11.2.0`, canPrompt: true }))).toBe('in-app')
  })
  it('guides an iPhone through Share → 홈 화면에 추가', () => {
    expect(installPath(env({ userAgent: IPHONE }))).toBe('ios')
  })
  it('uses the browser\'s own install dialog when it is offered', () => {
    expect(installPath(env({ userAgent: ANDROID, canPrompt: true }))).toBe('prompt')
    expect(installPath(env({ userAgent: MAC, canPrompt: true }))).toBe('prompt')
  })
  it('falls back to menu instructions on Android, and nothing on a computer', () => {
    expect(installPath(env({ userAgent: ANDROID }))).toBe('android')
    expect(installPath(env({ userAgent: MAC }))).toBe('desktop')
  })
})

// ── a parent's phone accepting the family's link ───────────────────────────
import { afterConnect, externalBrowserUrl, inAppBrowser, pairStart } from './install'

const UA = {
  kakaoAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A546S) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 KAKAOTALK 10.8.5',
  kakaoIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 KAKAOTALK 10.8.5',
  instaIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 330.0',
  naverAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A546S) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.6.3)',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A546S) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36',
}
const LINK = 'https://trackbyphoto.web.app/pair?c=ABCD1234'

describe('link flow on a parent\'s phone', () => {
  it('starts by leaving an in-app browser, or by adding the icon on an iPhone', () => {
    const start = (path: Parameters<typeof pairStart>[0]['path'], extra = {}) => pairStart({ familySignedIn: false, hasCode: true, path, ...extra })
    expect(start('in-app')).toBe('open-browser')
    expect(start('ios')).toBe('add-ios')
    expect(start('prompt')).toBe('confirm')
    expect(start('android')).toBe('confirm')
    // From the home-screen icon or the installed app: just connect.
    expect(start('none')).toBe('confirm')
    expect(start('in-app', { hasCode: false })).toBe('enter')
    expect(start('ios', { familySignedIn: true })).toBe('family-warning')
  })

  it('simple edition: an iPhone browser connects on the spot, no home-screen step', () => {
    const start = (path: Parameters<typeof pairStart>[0]['path']) => pairStart({ familySignedIn: false, hasCode: true, path, simple: true })
    expect(start('ios')).toBe('confirm')
    expect(start('in-app')).toBe('open-browser')
    expect(start('android')).toBe('confirm')
  })

  it('after connecting, offers the install dialog where the browser has one', () => {
    expect(afterConnect('prompt')).toBe('prompt')
    expect(afterConnect('android')).toBe('manual')
    expect(afterConnect('none')).toBe('done')
    expect(afterConnect('ios')).toBe('done')
    expect(afterConnect('desktop')).toBe('done')
  })

  it('hands the link to the phone\'s own browser unchanged', () => {
    expect(inAppBrowser(UA.kakaoAndroid)).toBe('kakaotalk')
    expect(inAppBrowser(UA.chromeAndroid)).toBeNull()
    expect(externalBrowserUrl(LINK, UA.kakaoAndroid)).toBe(`kakaotalk://web/openExternal?url=${encodeURIComponent(LINK)}`)
    expect(externalBrowserUrl(LINK, UA.kakaoIphone)).toBe(`kakaotalk://web/openExternal?url=${encodeURIComponent(LINK)}`)
    expect(externalBrowserUrl(LINK, UA.naverAndroid)).toBe(`intent://trackbyphoto.web.app/pair?c=ABCD1234#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(LINK)};end`)
    // No dependable way out of other iPhone in-app browsers: the steps are shown instead.
    expect(externalBrowserUrl(LINK, UA.instaIphone)).toBeNull()
    expect(externalBrowserUrl(LINK, UA.chromeAndroid)).toBeNull()
  })
})
