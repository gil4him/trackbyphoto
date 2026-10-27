import { useState, type FormEvent } from 'react'
import { useToast } from '../components/Toast'
import { LegalLinks } from '../components/LegalLinks'
import { isSimple } from '../lib/edition'
import { tr } from '../lib/lang'

/** What a failed email sign-in says, in place of Firebase's code. */
export function emailSignInError(err: unknown): string {
  const code = String((err as { code?: string })?.code ?? '')
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(code)) return tr('이메일 또는 비밀번호가 맞지 않아요.', "That email or password isn't right.")
  if (/too-many-requests/.test(code)) return tr('잠시 후 다시 시도해 주세요.', 'Please try again in a moment.')
  return tr('로그인에 실패했어요. 다시 시도해 주세요.', "Sign-in didn't work. Please try again.")
}

export function SignIn({ onGoogle, onApple, onEmail, invited, onEnterCode, parentButton = false }: {
  onGoogle: () => Promise<void>
  /** The iPhone app: Sign in with Apple above Google. */
  onApple?: () => Promise<void>
  /** Simple edition: a small 이메일로 로그인 for accounts made by hand. */
  onEmail?: (email: string, password: string) => Promise<void>
  invited?: boolean
  onEnterCode?: () => void
  /** Simple edition: the parent's way in is a big button, not a small link. */
  parentButton?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const [emailOpen, setEmailOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault()
    if (!onEmail || !email.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      await onEmail(email, password)
    } catch (err) {
      console.error('[auth] email sign-in failed', err)
      setError(emailSignInError(err))
      setBusy(false)
    }
  }

  const run = (signIn: () => Promise<void>) => async () => {
    setBusy(true)
    setError(null)
    try {
      await signIn()
    } catch (err) {
      // Closing the Apple sheet is not a failure.
      if (/cancel|1001/i.test(String((err as { message?: string })?.message ?? err))) {
        setBusy(false)
        return
      }
      // Show the underlying reason (Firebase code or native plugin message)
      // so a failure on a phone can be read off the screen and reported.
      const e = err as { code?: string; message?: string }
      const reason = [e?.code, e?.message].filter(Boolean).join(' · ').slice(0, 200) || String(err)
      toast.show(tr('로그인에 실패했어요', "Sign-in didn't work"), reason)
      // The toast fades quickly; keep the reason on screen until the next try.
      setError(reason)
      setBusy(false)
    }
    // On success, onAuthStateChanged unmounts this screen.
  }

  return (
    <section className="signin">
      <div className="signin-brand">
        <div className="signin-dot" />
        <h1>Daylie</h1>
        <p>{tr('한 번의 터치로 오늘의 순간을 가족에게 전합니다.', 'One tap sends today’s moment to your family.')}</p>
      </div>

      {onApple && (
        <button className="apple-btn" onClick={run(onApple)} disabled={busy} aria-label={tr('Apple로 로그인', 'Sign in with Apple')}>
          <svg width="18" height="22" viewBox="0 0 17 20" aria-hidden="true">
            <path fill="currentColor" d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2.1-.9-3.4-.9C3.5 4.8 1.9 5.8 1 7.3c-1.9 3.2-.5 8 1.3 10.6.9 1.3 1.9 2.7 3.3 2.6 1.3-.1 1.8-.8 3.4-.8s2 .8 3.4.8c1.4 0 2.3-1.3 3.2-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.9-1.1-2.9-4.3zM11.5 3c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.1 1.1.1 2.3-.6 3-1.5z"/>
          </svg>
          {tr('Apple로 로그인', 'Sign in with Apple')}
        </button>
      )}

      <button className="g-btn" onClick={run(onGoogle)} disabled={busy} aria-label={tr('Google로 로그인', 'Sign in with Google')}>
        <span className="g-ico" aria-hidden>
          {/* Google "G" mark */}
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.3-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 5.1 29.3 3 24 3 16.3 3 9.6 7.4 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 45c5.2 0 9.9-2 13.5-5.2l-6.2-5.3c-2 1.4-4.5 2.3-7.3 2.3-5.3 0-9.7-3.4-11.3-8l-6.6 5.1C9.5 40.5 16.2 45 24 45z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.2 5.3C40.9 35 45 30 45 24c0-1.2-.1-2.3-.4-3.5z"/>
          </svg>
        </span>
        {busy ? tr('로그인 중…', 'Signing in…') : tr('Google로 로그인', 'Sign in with Google')}
      </button>

      {error && <p className="signin-error">{error}</p>}

      {onEnterCode && !invited && (parentButton ? (
        <button className="signin-parent-btn" onClick={onEnterCode}>
          <span className="signin-parent-title">{tr('부모님 휴대폰이에요', "This is my parent's phone")}</span>
          <span className="signin-parent-sub">{tr('사진을 찍어 가족에게 보내요', 'Take a photo and send it to your family')}</span>
        </button>
      ) : (
        <button className="signin-code-btn" onClick={onEnterCode}>
          {tr('가족에게 받은 연결 코드가 있어요', 'I have a link code from my family')}
        </button>
      ))}

      <p className="signin-note">
        {invited
          ? tr('가족초대를 받으셨어요. 로그인하면 바로 참여할 수 있어요.', 'You have a family invitation. Sign in and you can join right away.')
          : parentButton
            ? tr('로그인은 가족용이에요. 부모님은 위의 ‘부모님 휴대폰이에요’를 눌러 주세요.', 'Sign-in is for family. Parents: tap ‘This is my parent\'s phone’ above.')
            : tr('가족과 메모를 공유하기 위해 로그인해 주세요. 사진과 메모는 본인 계정에만 저장됩니다.', 'Sign in to share memos with your family. Photos and memos are kept in your own account only.')}
      </p>
      {onEmail && (emailOpen ? (
        <form className="signin-email" onSubmit={submitEmail}>
          <input className="text-input" type="email" autoComplete="username" placeholder={tr('이메일', 'Email')} aria-label={tr('이메일', 'Email')}
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="text-input" type="password" autoComplete="current-password" placeholder={tr('비밀번호', 'Password')} aria-label={tr('비밀번호', 'Password')}
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="linkbtn" type="submit" disabled={busy || !email.trim() || !password}>{tr('로그인', 'Sign in')}</button>
        </form>
      ) : (
        <button className="signin-code-btn signin-email-link" onClick={() => setEmailOpen(true)}>{tr('이메일로 로그인', 'Sign in with email')}</button>
      ))}
      {isSimple() && <LegalLinks />}
    </section>
  )
}
