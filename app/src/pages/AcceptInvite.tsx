// 가족초대 — recipient side. The invite arrives as a link
// (trackbyphoto.web.app/accept?code=123456) by KakaoTalk or text message; the
// recipient signs in if needed, sees "OOO님의 기록에 참여할까요?" and joins
// with one tap. Nothing to type.
//
// Why no PIPA-style consent on this side? The elder agrees to both consents
// at the moment they create the invite (the worker batches consent + invite +
// audit log in one commit). The family member here is just *accepting an
// invitation* — the legal data subject is the elder.
//
// The code comes from ?code= or, if the query was lost on the way through
// sign-in, from the localStorage stash App.tsx writes (PENDING_INVITE_KEY).
// The confirm screen reads invites/{code} directly (rules allow get by exact
// code, never list); the worker's acceptInvite stays the authority.

import { useEffect, useState } from 'react'
import { doc, getDoc, type Timestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from '../components/Toast'
import { acceptInvite, normalizeInviteCode } from '../lib/caregiver'
import { WORKER_OFFLINE_MESSAGE } from '../lib/worker'

export const PENDING_INVITE_KEY = 'tbp.pendingInviteCode'

interface Props {
  onAccepted: (patientUid: string) => void
  onCancel: () => void
}

interface InviteDoc {
  patientName?: string
  expiresAt: Timestamp
  used: boolean
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'confirm'; code: string; name: string }
  | { kind: 'error'; message: string }

function friendlyError(err: unknown): string {
  // Worker errors (lib/worker.ts) have shape { code, message }. Map the
  // well-known status codes to gentle Korean copy; anything unrecognized gets
  // a generic line so we never show a stack to a family member.
  const e = err as { code?: string; message?: string }
  switch (e.code) {
    case 'not-found':
      return '초대를 찾을 수 없어요. 초대한 가족에게 다시 보내달라고 해주세요.'
    case 'deadline-exceeded':
      return '초대가 만료되었어요. 새로 받아주세요.'
    case 'failed-precondition':
      if (e.message?.includes('used')) return '이미 사용된 초대예요. 새로 받아주세요.'
      if (e.message?.includes('own invite')) return '내가 보낸 초대는 수락할 수 없어요.'
      return '초대를 사용할 수 없어요. 새로 받아주세요.'
    case 'already-exists':
      return '이미 이 가족의 기록에 참여하고 있어요.'
    case 'unauthenticated':
      return '먼저 로그인해주세요.'
    case 'unavailable':
      return WORKER_OFFLINE_MESSAGE
    default:
      return '초대 수락에 실패했어요. 잠시 후 다시 시도해주세요.'
  }
}

function readCode(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('code')
  let fromStash: string | null = null
  try { fromStash = localStorage.getItem(PENDING_INVITE_KEY) } catch { /* storage blocked */ }
  return normalizeInviteCode(fromUrl || fromStash || '')
}

function clearStash() {
  try { localStorage.removeItem(PENDING_INVITE_KEY) } catch { /* storage blocked */ }
}

export function AcceptInvite({ onAccepted, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    const code = readCode()
    if (code.length !== 6) {
      setPhase({ kind: 'error', message: '초대 링크가 올바르지 않아요. 받은 링크를 다시 눌러주세요.' })
      return
    }
    let cancelled = false
    getDoc(doc(db, 'invites', code))
      .then((snap) => {
        if (cancelled) return
        if (!snap.exists()) {
          setPhase({ kind: 'error', message: friendlyError({ code: 'not-found' }) })
          return
        }
        const inv = snap.data() as InviteDoc
        if (inv.used) {
          setPhase({ kind: 'error', message: friendlyError({ code: 'failed-precondition', message: 'used' }) })
        } else if (inv.expiresAt.toMillis() < Date.now()) {
          setPhase({ kind: 'error', message: friendlyError({ code: 'deadline-exceeded' }) })
        } else {
          setPhase({ kind: 'confirm', code, name: inv.patientName?.trim() || '' })
        }
      })
      .catch((err) => {
        console.error('[accept-invite] lookup failed', err)
        if (!cancelled) setPhase({ kind: 'error', message: '초대를 불러오지 못했어요. 잠시 후 다시 시도해주세요.' })
      })
    return () => { cancelled = true }
  }, [])

  const join = async () => {
    if (phase.kind !== 'confirm' || busy) return
    setBusy(true)
    try {
      const result = await acceptInvite(phase.code)
      clearStash()
      toast.show('초대를 수락했어요', '가족의 기록을 함께 볼 수 있어요')
      onAccepted(result.patientUid)
    } catch (err) {
      console.error('[accept-invite] failed', err)
      toast.show(friendlyError(err))
      setBusy(false)
    }
  }

  const close = () => { clearStash(); onCancel() }

  return (
    <section className="page accept-invite">
      <div className="h-eyebrow">가족초대</div>

      {phase.kind === 'loading' && (
        <h2 className="h-title">초대를 확인하고 있어요…</h2>
      )}

      {phase.kind === 'confirm' && (
        <>
          <h2 className="h-title">
            {phase.name ? `${phase.name}님의 기록에 참여할까요?` : '가족의 기록에 참여할까요?'}
          </h2>
          <div className="sect">
            <div className="help">
              참여하면 {phase.name ? `${phase.name}님의` : '가족의'} 일상 기록(메모·사진·위치)을 함께 볼 수 있어요.
            </div>
          </div>
          <div className="sect" style={{ display: 'flex', gap: 12 }}>
            <button className="linkbtn" onClick={join} disabled={busy} style={{ flex: 1 }}>
              <span>{busy ? '참여하는 중…' : '참여하기'}</span>
              <span aria-hidden="true">→</span>
            </button>
            <button className="signin-secondary" onClick={close} style={{ flex: '0 0 auto' }}>
              취소
            </button>
          </div>
          <div className="proto-note">
            초대한 가족은 언제든지 접근을 해제할 수 있어요.
          </div>
        </>
      )}

      {phase.kind === 'error' && (
        <>
          <h2 className="h-title">초대를 열 수 없어요</h2>
          <div className="sect">
            <div className="help">{phase.message}</div>
          </div>
          <div className="sect">
            <button className="signin-secondary" onClick={close}>홈으로</button>
          </div>
        </>
      )}
    </section>
  )
}
