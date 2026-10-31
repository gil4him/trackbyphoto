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
    expect(text).toBe('엄마, 이 링크 한 번만 눌러 주세요 😊\n사진 찍으면 제가 바로 볼 수 있어요.\n설치가 끝나면 이 링크를 한 번 더 눌러 주세요.\nhttps://dayliesimple.web.app/pair?c=ABCD2345')
  })

  it('opens with the name the family registered', () => {
    const line = (name: string) => buildPairMessage(name, 'https://x/pair', 'ABCD2345', 24).split('\n')[0]
    expect(line('아빠')).toBe('아빠, 이 링크 한 번만 눌러 주세요 😊')
    expect(line('영희')).toBe('영희님, 이 링크 한 번만 눌러 주세요 😊')
    expect(line('  ')).toBe('부모님, 이 링크 한 번만 눌러 주세요 😊')
  })
})

describe('canShareRemotely', () => {
  it('lets a first-phone QR link go out by KakaoTalk, but not a re-link QR', () => {
    expect(canShareRemotely({ mode: 'remote', purpose: 'repair' })).toBe(true)
    expect(canShareRemotely({ mode: 'qr', purpose: 'onboard' })).toBe(true)
    expect(canShareRemotely({ mode: 'qr', purpose: 'repair' })).toBe(false)
  })
})
