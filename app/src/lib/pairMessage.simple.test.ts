// What the simple edition sends: an install link that also connects, and
// when a QR link may go out by KakaoTalk.
import { describe, it, expect, vi } from 'vitest'

vi.mock('./edition', () => ({ isSimple: () => true, EDITION: 'simple' }))
vi.mock('./worker', () => ({ callWorker: vi.fn() }))
const store = vi.hoisted(() => ({ live: true }))
vi.mock('./storeLinks', () => ({ inAnyStore: () => store.live }))

import { buildPairMessage } from './share'
import { canShareRemotely } from './pairing'

describe('simple pairing message', () => {
  it('before the store release: tap the link and 연결하기', () => {
    store.live = false
    const text = buildPairMessage('엄마', 'https://dayliesimple.web.app/pair?c=ABCD2345', 'ABCD2345', 24)
    store.live = true
    expect(text).toContain("아래 링크를 누르고 '연결하기'를 눌러주세요. (24시간 유효)")
    expect(text).not.toContain('설치')
    expect(text.split('\n')).toContain('연결 코드: ABCD 2345')
  })

  it('with the app in a store: install, then tap the same link again', () => {
    const text = buildPairMessage('엄마', 'https://dayliesimple.web.app/pair?c=ABCD2345', 'ABCD2345', 24)
    expect(text).toContain('[오늘하루] 엄마님 휴대폰을 연결해요.')
    expect(text).toContain('앱을 설치해 주세요. (24시간 유효)')
    expect(text).toContain('https://dayliesimple.web.app/pair?c=ABCD2345')
    expect(text).toContain('설치 후 이 링크를 한 번 더 눌러주세요.')
    expect(text.split('\n')).toContain('연결 코드: ABCD 2345')
    expect(text).toContain("앱에서 '코드 입력'을 눌러 주세요")
  })
})

describe('canShareRemotely', () => {
  it('lets a first-phone QR link go out by KakaoTalk, but not a re-link QR', () => {
    expect(canShareRemotely({ mode: 'remote', purpose: 'repair' })).toBe(true)
    expect(canShareRemotely({ mode: 'qr', purpose: 'onboard' })).toBe(true)
    expect(canShareRemotely({ mode: 'qr', purpose: 'repair' })).toBe(false)
  })
})
