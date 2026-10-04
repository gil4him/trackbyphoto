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
