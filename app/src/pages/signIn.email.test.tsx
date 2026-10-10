// 이메일로 로그인: the simple edition's way in for accounts made by hand
// (the store reviewers' demo account). Closed until tapped.
import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { SignIn, emailSignInError } from './SignIn'
import { ToastProvider } from '../components/Toast'

const render = (onEmail?: (e: string, p: string) => Promise<void>) =>
  renderToString(<ToastProvider><SignIn onGoogle={async () => {}} onEmail={onEmail} /></ToastProvider>)

describe('SignIn: email', () => {
  it('offers a small 이메일로 로그인 link, below Google', () => {
    const html = render(async () => {})
    expect(html).toContain('이메일로 로그인')
    expect(html.indexOf('Google로 로그인')).toBeLessThan(html.indexOf('이메일로 로그인'))
    expect(html).not.toContain('type="password"') // the form opens on tap
  })

  it('not offered without onEmail', () => {
    expect(render()).not.toContain('이메일로 로그인')
  })

  it('says plainly when the email or password is wrong', () => {
    expect(emailSignInError({ code: 'auth/invalid-credential' })).toBe('이메일 또는 비밀번호가 맞지 않아요.')
    expect(emailSignInError({ code: 'auth/too-many-requests' })).toBe('잠시 후 다시 시도해 주세요.')
    expect(emailSignInError(new Error('x'))).toContain('다시 시도')
  })
})
