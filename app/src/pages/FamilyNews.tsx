import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { MemoThumb } from '../components/MemoThumb'
import { TextReply } from '../components/TextReply'
import { useToast } from '../components/Toast'
import { markRead, sendElderComment, sendElderHeart } from '../lib/reactions'
import { canRecord, Mic } from '../lib/recorder'
import { sendVoice } from '../lib/voiceOutbox'
import { S } from '../lib/strings'
import { fmtTime } from '../util'
import type { Memo, Reaction, TextReplies } from '../types'
import { tr } from '../lib/lang'

/**
 * 가족 소식: the newest message from family in large type, and
 * ways to answer: a heart, holding a button and talking, or a written reply
 * (typing, with ready-made phrases to tap underneath; phrases only when family
 * chose 짧은 답장 for this parent). The same screen on a parent's linked phone and in the regular app
 * (someone looking at their own records), and identical on every plan.
 */
export function FamilyNews({ uid, patientName, item, unreadIds, memo, voiceOn, textMode = 'full', backLabel = tr('‹ 처음으로', '‹ Back'), onDone }: {
  uid: string
  patientName: string
  item: Reaction
  unreadIds: string[]
  /** The photo the message is about, when it is still in the list. */
  memo?: Memo
  /** Voice replies are switched on for this parent. */
  voiceOn: boolean
  /** Written replies: phrases only, phrases and typing, or none. */
  textMode?: TextReplies
  backLabel?: string
  onDone: () => void
}) {
  const toast = useToast()
  const [phase, setPhase] = useState<'view' | 'recording' | 'text' | 'sent'>('view')
  const typed = useRef<HTMLInputElement>(null)
  const [hint, setHint] = useState('')
  const mic = useRef<Mic | null>(null)
  const held = useRef(false)

  const text = item.kind === 'comment' ? item.text ?? '' : S.elderCardHeart(item.actorName)

  // Stamp everything unread as seen, and let go of the microphone on the way out.
  const opened = useRef(false)
  useEffect(() => {
    if (!opened.current) {
      opened.current = true
      markRead(unreadIds, 'elder')
    }
    return () => { mic.current?.close() }
    // Runs once for the message this screen was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // "보냈어요 ✓" stays for two seconds, then back to the home screen.
  useEffect(() => {
    if (phase !== 'sent') return
    const t = setTimeout(onDone, 2000)
    return () => clearTimeout(t)
  }, [phase, onDone])

  const sendHeart = () => {
    // The heart always lands for the parent; a failed send is retried by
    // Firestore while the app stays open.
    sendElderHeart(item.memoId, { uid, name: patientName }).catch((err) => console.warn('[news] heart failed', err))
    setPhase('sent')
  }

  const sendText = (text: string) => {
    if (!text.trim()) return
    sendElderComment(item.memoId, { uid, name: patientName }, text).catch((err) => console.warn('[news] written reply failed', err))
    setPhase('sent')
  }
  const openText = () => {
    // Render the text box now and focus it inside this tap, so the keyboard opens.
    flushSync(() => setPhase('text'))
    typed.current?.focus()
  }

  const finishVoice = async () => {
    const clip = await mic.current?.stop()
    if (!clip) { setPhase('view'); return }
    sendVoice({ uid, memoId: item.memoId, actorName: patientName, blob: clip.blob, ext: clip.ext })
      .catch((err) => console.warn('[news] voice reply not queued', err))
    setPhase('sent')
  }

  const onHold = async () => {
    held.current = true
    mic.current ??= new Mic()
    if (!mic.current.ready) {
      try {
        await mic.current.open()
      } catch (err) {
        console.warn('[news] microphone unavailable', err)
        toast.show(tr('마이크를 쓸 수 없어요', "Can't use the microphone"), tr('가족에게 알려 주세요', 'Please tell your family'))
        return
      }
      // The phone's permission question interrupts the first press.
      if (!held.current) { setHint(tr('이제 꾹 누르고 말해 보세요', 'Now press and hold, and speak')); return }
    }
    setHint('')
    mic.current.start(() => { void finishVoice() })
    setPhase('recording')
  }

  const onRelease = () => {
    held.current = false
    if (mic.current?.recording) void finishVoice()
  }

  if (phase === 'sent') {
    return (
      <section className="page news sent" role="status">
        <div className="news-check" aria-hidden="true">✓</div>
        <div className="news-sent">{S.elderReplySent(item.actorName)}</div>
      </section>
    )
  }

  if (phase === 'text') {
    return <TextReply to={item.actorName} textMode={textMode} inputRef={typed} onBack={() => setPhase('view')} onSend={sendText} />
  }

  return (
    <section className="page news">
      <button className="elder-back" onClick={onDone}>{backLabel}</button>

      {memo && <div className="news-photo"><MemoThumb memo={memo} /></div>}

      <div className="news-text">{text}</div>
      <div className="news-from">{item.actorName} · {fmtTime(new Date(item.createdAtMs))}</div>

      <div className="news-actions">
        <button className="news-btn primary" onClick={sendHeart}>{S.elderReplyHeart}</button>
        {voiceOn && canRecord() && (
          <button
            className="news-btn hold"
            onPointerDown={(e) => { e.preventDefault(); void onHold() }}
            onPointerUp={onRelease}
            onPointerCancel={onRelease}
            onPointerLeave={onRelease}
            onContextMenu={(e) => e.preventDefault()}
          >{S.elderReplyVoice}</button>
        )}
        {textMode !== 'off' && <button className="news-btn" onClick={openText}>{S.elderReplyText}</button>}
        {hint && <div className="news-hint" role="status">{hint}</div>}
      </div>

      {phase === 'recording' && (
        <div className="news-rec" role="status" aria-live="assertive">
          <div className="news-rec-dot" aria-hidden="true" />
          <div className="news-rec-text">{S.elderReplyRecording}</div>
        </div>
      )}
    </section>
  )
}
