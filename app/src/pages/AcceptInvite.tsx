// Caregiver flow: enter a 6-digit invite code → confirmation screen →
// acceptInvite callable → success → switch context to the new patient.
//
// Two screens, no extra navigation. Why no PIPA-style consent on this side?
// The patient signs both consents at the moment they generate the code (the
// server batches consent + invite + audit log in one commit). The caregiver
// here is just *accepting an invitation*, not granting consent — the legal
// data subject is the elder, not the caregiver.
//
// The accept-invite path is reached:
//   1. From SignIn (caregiver who's never used the app)
//   2. From Settings → "초대 코드로 참여하기" (existing user joining another
//      elder's account)
//   3. Deep link /accept?code=XXXXXX from a Kakao/SMS share
//
// On error: surface the server's message verbatim where it's user-friendly,
// otherwise show a generic "코드를 확인해주세요". The function returns
// well-known HttpsError codes (not-found, deadline-exceeded, already-exists,
// failed-precondition) which we map to Korean.

import { useEffect, useRef, useState } from 'react'
import { useToast } from '../components/Toast'
import { acceptInvite, normalizeInviteCode } from '../lib/caregiver'

interface Props {
  onAccepted: (patientUid: string) => void
  onCancel: () => void
}

function friendlyError(err: unknown): string {
  // Firebase callable errors have shape { code, message, details }. We map
  // the well-known status codes to gentle Korean copy. Anything we don't
  // recognize falls through to a generic line so we never leak a stack to
  // an elder's caregiver.
  const e = err as { code?: string; message?: string }
  switch (e.code) {
    case 'functions/not-found':
      return '초대 코드를 찾을 수 없어요. 다시 확인해주세요.'
    case 'functions/deadline-exceeded':
      return '초대 코드가 만료되었어요. 새로 받아주세요.'
    case 'functions/failed-precondition':
      if (e.message?.includes('used')) return '이미 사용된 초대 코드예요.'
      if (e.message?.includes('own invite')) return '내가 만든 초대 코드는 사용할 수 없어요.'
      return '코드를 사용할 수 없어요. 발급자에게 새로 요청해주세요.'
    case 'functions/already-exists':
      return '이미 이 어르신의 보호자로 등록되어 있어요.'
    case 'functions/unauthenticated':
      return '먼저 로그인해주세요.'
    default:
      return '초대 수락에 실패했어요. 잠시 후 다시 시도해주세요.'
  }
}

export function AcceptInvite({ onAccepted, onCancel }: Props) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)

  // Pre-fill from ?code= query so the share link "trackbyphoto.web.app/accept?code=123456"
  // drops the caregiver straight onto the confirm step.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const c = params.get('code')
    if (c) setCode(normalizeInviteCode(c))
    else inputRef.current?.focus()
  }, [])

  const canSubmit = code.length === 6 && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      const result = await acceptInvite(code)
      toast.show('초대를 수락했어요', '어르신의 기록을 함께 볼 수 있어요')
      onAccepted(result.patientUid)
    } catch (err) {
      console.error('[accept-invite] failed', err)
      toast.show(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <section className="page accept-invite">
      <div className="h-eyebrow">보호자 참여</div>
      <h2 className="h-title">초대 코드 입력</h2>

      <div className="sect">
        <div className="help" style={{ marginBottom: 16 }}>
          어르신이 알려주신 6자리 코드를 입력하세요.
        </div>
        <input
          ref={inputRef}
          className="invite-code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(normalizeInviteCode(e.target.value))}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          placeholder="000000"
          aria-label="6자리 초대 코드"
        />
        <div className="help" style={{ marginTop: 12 }}>
          초대 코드는 발급 후 24시간 동안 유효해요.
        </div>
      </div>

      <div className="sect" style={{ display: 'flex', gap: 12 }}>
        <button
          className="linkbtn"
          onClick={submit}
          disabled={!canSubmit}
          style={{ flex: 1 }}
        >
          <span>{busy ? '확인 중…' : '참여하기'}</span>
          <span aria-hidden="true">→</span>
        </button>
        <button
          className="signin-secondary"
          onClick={onCancel}
          style={{ flex: '0 0 auto' }}
        >
          취소
        </button>
      </div>

      <div className="proto-note">
        <b>안내.</b> 초대를 수락하면 어르신의 일상 기록(메모, 사진, 위치)을 보실 수 있어요.
        어르신은 언제든지 보호자 접근을 해제할 수 있습니다.
      </div>
    </section>
  )
}
