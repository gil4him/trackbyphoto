import { useState } from 'react'
import { useToast } from './Toast'
import { COMMENT_MAX, familyActor, removeReaction, sendComment, sendFamilyHeart } from '../lib/reactions'
import { myHeart, replyTarget } from '../lib/reactionsModel'
import { S } from '../lib/strings'
import { fmtTime } from '../util'
import type { Reaction } from '../types'

/** What a feed needs to show and send reactions; built once in App. */
export interface ReactionsContext {
  byMemo: Map<string, Reaction[]>
  /** The signed-in viewer. */
  me: { uid: string; name: string }
  patientUid: string
  patientName: string
  /** The viewer is family (not the patient): may send hearts and comments. */
  canReact: boolean
  /** Voice replies are rolled out at all. */
  voiceOn: boolean
  /** The patient's plan lets the family hear voice replies. */
  voiceAllowed: boolean
  /** Set when the viewer is the patient: open 가족 소식 to answer a photo's
   *  newest family message with a heart or their voice. */
  onReply?: (item: Reaction, unreadIds: string[]) => void
  /** Set when the plan sheet is available: the locked voice card opens it. */
  onVoiceLocked?: () => void
}

/** The parent's voice reply: playable with its transcript, or the locked
 *  card when the plan doesn't include voice replies. */
function VoiceBubble({ r, ctx }: { r: Reaction; ctx: ReactionsContext }) {
  if (!ctx.voiceAllowed) {
    // Never the clip or its words; one of the plan sheet's four doors.
    const card = (
      <>
        <span className="rx-wave" aria-hidden="true" />
        <span className="rx-lock" aria-hidden="true">🔒</span>
        <span>{S.voiceLocked(ctx.patientName)}</span>
      </>
    )
    return ctx.onVoiceLocked
      ? <button type="button" className="rx-voice locked" onClick={ctx.onVoiceLocked}>{card}</button>
      : <div className="rx-voice locked">{card}</div>
  }
  if (r.status === 'pending') return <div className="rx-voice pending">{S.voicePending}</div>
  if (r.status !== 'ready' || !r.audioUrl) return null
  return (
    <div className="rx-voice">
      <audio controls preload="none" src={r.audioUrl} />
      <div className="rx-transcript">{r.transcript ? `“${r.transcript}”` : S.voiceNoTranscript}</div>
    </div>
  )
}

/**
 * Hearts, comments and the parent's replies under one memo. `max` limits the
 * thread in a list; the detail page shows it all.
 */
export function Reactions({ memoId, ctx, max }: { memoId: string; ctx: ReactionsContext; max?: number }) {
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const items = ctx.byMemo.get(memoId) ?? []
  const mine = myHeart(items, ctx.me.uid)
  const familyHearts = items.filter((r) => r.kind === 'heart' && r.actorUid !== ctx.patientUid)
  const thread = items.filter((r) =>
    r.kind === 'comment'
    || (r.actorUid === ctx.patientUid && (r.kind === 'heart' || (r.kind === 'voice' && ctx.voiceOn && r.status !== 'error'))))
  const shown = max ? thread.slice(-max) : thread

  if (!ctx.canReact && items.length === 0) return null
  const target = ctx.onReply ? replyTarget(items, ctx.patientUid) : null

  const toggleHeart = async () => {
    try {
      if (mine) await removeReaction(mine.id)
      else await sendFamilyHeart(memoId, ctx.patientUid, await familyActor(ctx.me.name))
    } catch (err) {
      console.error('[reactions] heart failed', err)
      toast.show('하트를 보내지 못했어요', '잠시 후 다시 시도해 주세요')
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft.trim() || busy) return
    setBusy(true)
    try {
      await sendComment(memoId, ctx.patientUid, await familyActor(ctx.me.name), draft)
      setDraft('')
    } catch (err) {
      console.error('[reactions] comment failed', err)
      toast.show('보내지 못했어요', '잠시 후 다시 시도해 주세요')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rx">
      {shown.length > 0 && (
        <ul className="rx-thread">
          {shown.map((r) => (
            <li key={r.id} className={r.actorUid === ctx.patientUid ? 'rx-item elder' : 'rx-item'}>
              <span className="rx-who">{r.actorUid === ctx.patientUid ? ctx.patientName : r.actorName}</span>
              <span className="rx-when">{fmtTime(new Date(r.createdAtMs))}</span>
              {r.kind === 'comment' && (
                <div className="rx-text">
                  {r.text}
                  {r.actorUid === ctx.me.uid && (
                    <button className="rx-del" onClick={() => removeReaction(r.id).catch((err) => console.error('[reactions] delete failed', err))} aria-label="내 글 지우기">지우기</button>
                  )}
                </div>
              )}
              {r.kind === 'heart' && <div className="rx-text">❤️ 고마워요</div>}
              {r.kind === 'voice' && <VoiceBubble r={r} ctx={ctx} />}
            </li>
          ))}
        </ul>
      )}

      {ctx.canReact ? (
        <form className="rx-bar" onSubmit={submit}>
          <button
            type="button"
            className={`rx-heart ${mine ? 'on' : ''}`}
            onClick={toggleHeart}
            aria-pressed={!!mine}
            aria-label={mine ? '하트 취소' : '하트 보내기'}
          >{mine ? '❤️' : '🤍'}{familyHearts.length > 0 && <span className="rx-count">{familyHearts.length}</span>}</button>
          <input
            className="rx-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={COMMENT_MAX}
            placeholder={S.commentPlaceholder}
            aria-label="글 남기기"
            enterKeyHint="send"
          />
          <button type="submit" className="rx-send" disabled={busy || !draft.trim()}>보내기</button>
        </form>
      ) : (
        <div className="rx-bar">
          {familyHearts.length > 0 && <div className="rx-hearts">❤️ {familyHearts.map((r) => r.actorName).join(', ')}</div>}
          {target && (
            <button type="button" className="rx-reply" onClick={() => ctx.onReply!(target.item, target.unreadIds)}>
              답장하기
            </button>
          )}
        </div>
      )}
    </div>
  )
}
