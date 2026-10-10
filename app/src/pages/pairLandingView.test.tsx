// The simple site's /pair page: install button, the second-tap line, the code.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../lib/worker', () => ({ callWorker: vi.fn() }))

import { PairLandingView } from './PairLanding'
import type { StoreKind } from '../lib/storeLinks'

const render = (kind: StoreKind, storeUrl: string | null, code = 'ABCD2345') =>
  renderToString(<PairLandingView code={code} kind={kind} storeUrl={storeUrl} onInstall={() => {}} />)

describe('PairLandingView', () => {
  it('offers 앱 설치하기 and says to tap the link again', () => {
    const html = render('android', 'https://play.google.com/store/apps/details?id=com.zymer.daylie')
    expect(html).toContain('앱 설치하기')
    expect(html).toContain('설치 후 이 링크를 한 번 더 눌러주세요.')
    expect(html).toContain('ABCD 2345')
  })

  it('without an App Store link yet, tells iPhone users to search for it', () => {
    const html = render('ios', null)
    expect(html).not.toContain('앱 설치하기')
    expect(html).toContain('App Store에서 ‘오늘하루’를 찾아 설치해 주세요.')
  })

  it('on a computer, asks to open the link on the phone', () => {
    expect(render('other', null)).toContain('연결할 휴대폰에서 이 링크를 열어 주세요.')
  })

  it('hides the code box without a whole code', () => {
    expect(render('android', 'x', '')).not.toContain('pair-code-box')
  })
})
