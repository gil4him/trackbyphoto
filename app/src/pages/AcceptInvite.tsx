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
// The confirm screen asks the worker (lookupInvite) whose record the code
// opens — invites are closed to the app so codes can't be scanned — and the
// worker's acceptInvite stays the authority.

import { useEffect, useState } from 'react'
import { useToast } from '../components/Toast'
import { acceptInvite, lookupInvite, normalizeInviteCode } from '../lib/caregiver'
import { WORKER_OFFLINE_MESSAGE } from '../lib/worker'
import { tr } from '../lib/lang'

export const PENDING_INVITE_KEY = 'tbp.pendingInviteCode'

interface Props {
  onAccepted: (patientUid: string) => void
  onCancel: () => void
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
      return tr('초대를 찾을 수 없어요. 초대한 가족에게 다시 보내달라고 해주세요.', "We can't find that invitation. Ask the family member to send it again.")
    case 'deadline-exceeded':
      return tr('초대가 만료되었어요. 새로 받아주세요.', 'That invitation has expired. Please ask for a new one.')
    case 'failed-precondition':
      if (e.message?.includes('used')) return tr('이미 사용된 초대예요. 새로 받아주세요.', 'That invitation was already used. Please ask for a new one.')
      if (e.message?.includes('own invite')) return tr('내가 보낸 초대는 수락할 수 없어요.', "You can't accept your own invitation.")
      return tr('초대를 사용할 수 없어요. 새로 받아주세요.', "That invitation can't be used. Please ask for a new one.")
    case 'plan-limit':
      return tr('지금은 이 가족에 더 참여할 수 없어요. 초대한 가족에게 알려 주세요.', "This family can't take anyone else right now. Please let them know.")
    case 'already-exists':
      return tr('이미 이 가족의 기록에 참여하고 있어요.', "You already share this family's records.")
    case 'unauthenticated':
      return tr('먼저 로그인해주세요.', 'Please sign in first.')
    case 'resource-exhausted':
      return tr('시도가 너무 많았어요. 잠시 후 다시 시도해주세요.', 'Too many tries. Please try again in a moment.')
    case 'unavailable':
      return WORKER_OFFLINE_MESSAGE
    default:
      return tr('초대 수락에 실패했어요. 잠시 후 다시 시도해주세요.', "Couldn't accept the invitation. Please try again in a moment.")
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
      setPhase({ kind: 'error', message: tr('초대 링크가 올바르지 않아요. 받은 링크를 다시 눌러주세요.', "That invitation link isn't right. Please tap the link you were sent again.") })
      return
    }
    let cancelled = false
    lookupInvite(code)
      .then((inv) => {
        if (!cancelled) setPhase({ kind: 'confirm', code, name: inv.patientName.trim() })
      })
      .catch((err) => {
        console.error('[accept-invite] lookup failed', err)
        if (!cancelled) setPhase({ kind: 'error', message: friendlyError(err) })
      })
    return () => { cancelled = true }
  }, [])

  const join = async () => {
    if (phase.kind !== 'confirm' || busy) return
    setBusy(true)
    try {
      const result = await acceptInvite(phase.code)
      clearStash()
      toast.show(tr('초대를 수락했어요', 'Invitation accepted'), tr('가족의 기록을 함께 볼 수 있어요', "You can see your family's records now"))
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
      <div className="h-eyebrow">{tr('가족초대', 'Family invitation')}</div>

      {phase.kind === 'loading' && (
        <h2 className="h-title">{tr('초대를 확인하고 있어요…', 'Checking the invitation…')}</h2>
      )}

      {phase.kind === 'confirm' && (
        <>
          <h2 className="h-title">
            {phase.name
              ? tr(`${phase.name}님의 기록에 참여할까요?`, `Join ${phase.name}'s records?`)
              : tr('가족의 기록에 참여할까요?', "Join your family's records?")}
          </h2>
          <div className="sect">
            <div className="help">
              {tr(
                `참여하면 ${phase.name ? `${phase.name}님의` : '가족의'} 일상 기록(메모·사진·위치)을 함께 볼 수 있어요.`,
                `Once you join you can see ${phase.name ? `${phase.name}'s` : "your family's"} day: memos, photos and places.`,
              )}
            </div>
          </div>
          <div className="sect" style={{ display: 'flex', gap: 12 }}>
            <button className="linkbtn" onClick={join} disabled={busy} style={{ flex: 1 }}>
              <span>{busy ? tr('참여하는 중…', 'Joining…') : tr('참여하기', 'Join')}</span>
              <span aria-hidden="true">→</span>
            </button>
            <button className="signin-secondary" onClick={close} style={{ flex: '0 0 auto' }}>
              {tr('취소', 'Cancel')}
            </button>
          </div>
          <div className="proto-note">
            {tr('초대한 가족은 언제든지 접근을 해제할 수 있어요.', 'The family member who invited you can remove your access at any time.')}
          </div>
        </>
      )}

      {phase.kind === 'error' && (
        <>
          <h2 className="h-title">{tr('초대를 열 수 없어요', "Can't open the invitation")}</h2>
          <div className="sect">
            <div className="help">{phase.message}</div>
          </div>
          <div className="sect">
            <button className="signin-secondary" onClick={close}>{tr('홈으로', 'Home')}</button>
          </div>
        </>
      )}
    </section>
  )
}
