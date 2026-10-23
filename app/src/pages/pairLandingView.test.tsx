// The simple site's /pair page: install button, the second-tap line, the code.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../lib/worker', () => ({ callWorker: vi.fn() }))

import { PairLandingView } from './PairLanding'
import type { StoreKind } from '../lib/storeLinks'

const render = (kind: StoreKind, storeUrl: string | null, code = 'ABCD2345') =>
  renderToString(<PairLandingView code={code} kind={kind} storeUrl={storeUrl} onInstall={() => {}} onWebPair={() => {}} />)

describe('PairLandingView', () => {
  it('iPhone: offers 앱 설치하기 and says to tap the link again', () => {
    const html = render('ios', 'https://apps.apple.com/app/id1')
    expect(html).toContain('앱 설치하기')
    expect(html).toContain('설치 후 이 링크를 한 번 더 눌러주세요.')
    expect(html).toContain('ABCD 2345')
  })

  it('Android: one button that opens the app, or its install page when it is missing', () => {
    const html = render('android', 'https://play.google.com/store/apps/details?id=com.zymer.daylie')
    expect(html).toContain('>앱으로 연결하기</button>')
    expect(html).toContain('앱이 없으면 설치 화면이 열려요.')
    expect(html).not.toContain('앱 설치하기')
    expect(html).toContain('ABCD 2345')
  })

  it('before the store release, connects right here in the phone browser', () => {
    for (const kind of ['ios', 'android'] as const) {
      const html = render(kind, null)
      expect(html).not.toContain('앱 설치하기')
      expect(html).toContain('>연결하기</button>')
      expect(html).toContain('휴대폰을 가족과')
    }
  })

  it('on a computer, asks to open the link on the phone', () => {
    expect(render('other', null)).toContain('연결할 휴대폰에서 이 링크를 열어 주세요.')
  })

  it('with the app in the store, offers only the app: no linking in the browser', () => {
    for (const kind of ['ios', 'android'] as const) {
      const html = render(kind, 'x')
      expect(html).toContain(kind === 'ios' ? '앱 설치하기' : '앱으로 연결하기')
      expect(html).not.toContain('앱 없이')
      expect(html).not.toContain('>연결하기</button>')
    }
    expect(render('other', null)).not.toContain('연결하기</button>')
  })

  it('opened from 가족에게 받은 연결 코드가 있어요 (no link): install, then 코드 입력 in the app', () => {
    const html = renderToString(<PairLandingView code="" kind="ios" storeUrl="https://apps.apple.com/app/id1" onInstall={() => {}} onWebPair={() => {}} onBack={() => {}} />)
    expect(html).toContain('앱 설치하기')
    expect(html).toContain('설치 후 앱을 열고 ‘코드 입력’을 눌러 주세요.')
    expect(html).not.toContain('이 링크를 한 번 더')
    expect(html).not.toContain('>연결하기</button>')
    expect(html).toContain('돌아가기')
  })

  it('hides the code box without a whole code', () => {
    expect(render('android', 'x', '')).not.toContain('pair-code-box')
  })
})
