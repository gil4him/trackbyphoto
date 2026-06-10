import { useState } from 'react'
import { useToast } from '../components/Toast'

export function SignIn({ onGoogle, onAcceptInvite }: { onGoogle: () => Promise<void>; onAcceptInvite?: () => void }) {
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const handleGoogle = async () => {
    setBusy(true)
    try {
      await onGoogle()
    } catch {
      toast.show('로그인에 실패했어요', '잠시 후 다시 시도해주세요')
      setBusy(false)
    }
    // On success, onAuthStateChanged unmounts this screen.
  }

  return (
    <section className="signin">
      <div className="signin-brand">
        <div className="signin-dot" />
        <h1>오늘하루</h1>
        <p>한 번의 터치로 오늘의 순간을 가족에게 전합니다.</p>
      </div>

      <button className="g-btn" onClick={handleGoogle} disabled={busy} aria-label="Google로 로그인">
        <span className="g-ico" aria-hidden>
          {/* Google "G" mark */}
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.3-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 5.1 29.3 3 24 3 16.3 3 9.6 7.4 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 45c5.2 0 9.9-2 13.5-5.2l-6.2-5.3c-2 1.4-4.5 2.3-7.3 2.3-5.3 0-9.7-3.4-11.3-8l-6.6 5.1C9.5 40.5 16.2 45 24 45z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.2 5.3C40.9 35 45 30 45 24c0-1.2-.1-2.3-.4-3.5z"/>
          </svg>
        </span>
        {busy ? '로그인 중…' : 'Google로 로그인'}
      </button>

      <p className="signin-note">
        가족과 메모를 공유하기 위해 로그인해 주세요. 사진과 메모는 본인 계정에만 저장됩니다.
      </p>

      {/* Caregiver entry point. The accept-invite screen also requires
          authentication, so we still kick caregivers through the Google
          button first — the click just sets a flag so they land on the
          accept screen post-login. */}
      {onAcceptInvite && (
        <button className="signin-secondary" onClick={onAcceptInvite}>
          초대 코드로 참여하기 →
        </button>
      )}
    </section>
  )
}
