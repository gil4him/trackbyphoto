// The sign-in screen: the family signs in; in the simple edition the parent's
// way in is a big button instead of the small code link.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../components/Toast', () => ({ useToast: () => ({ show: () => {} }) }))

import { SignIn } from './SignIn'

const render = (parentButton: boolean) =>
  renderToString(<SignIn onGoogle={async () => {}} onEnterCode={() => {}} parentButton={parentButton} />)

describe('SignIn', () => {
  it('simple edition: a big 부모님 휴대폰이에요 next to Google sign-in', () => {
    const html = render(true)
    expect(html).toContain('Google로 로그인')
    expect(html).toContain('부모님 휴대폰이에요')
    expect(html).toContain('사진을 찍어 가족에게 보내요')
    expect(html).not.toContain('가족에게 받은 연결 코드가 있어요')
  })

  it('full edition: the small code link as before', () => {
    const html = render(false)
    expect(html).toContain('가족에게 받은 연결 코드가 있어요')
    expect(html).not.toContain('부모님 휴대폰이에요')
  })
})
