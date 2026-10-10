// Sign in with Apple: shown above Google when the iPhone app offers it.
import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { SignIn } from './SignIn'
import { ToastProvider } from '../components/Toast'

const render = (onApple?: () => Promise<void>) =>
  renderToString(<ToastProvider><SignIn onGoogle={async () => {}} onApple={onApple} /></ToastProvider>)

describe('SignIn: Apple', () => {
  it('iPhone app: Apple first, then Google', () => {
    const html = render(async () => {})
    expect(html).toContain('Apple로 로그인')
    expect(html.indexOf('Apple로 로그인')).toBeLessThan(html.indexOf('Google로 로그인'))
  })

  it('elsewhere: Google only', () => {
    expect(render()).not.toContain('Apple로 로그인')
  })
})
