import { useEffect, useRef, useState } from 'react'
import { MemoThumb } from '../components/MemoThumb'
import { useToast } from '../components/Toast'
import { markRead, sendElderHeart } from '../lib/reactions'
import { canRecord, Mic } from '../lib/recorder'
import { sendVoice } from '../lib/voiceOutbox'
import { S } from '../lib/strings'
import { fmtTime } from '../util'
import type { Memo, Reaction } from '../types'

const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

/**
 * 가족 소식: the newest message from family in large type, read aloud, and
 * two ways to answer without typing: a heart, or holding a button and
 * talking. The same screen on a parent's linked phone and in the regular app
 * (someone looking at their own records), and identical on every plan.
 */
export function FamilyNews({ uid, patientName, item, unreadIds, memo, voiceOn, backLabel = '‹ 처음으로', onDone }: {
  uid: string
  patientName: string
  item: Reaction
  unreadIds: string[]
  /** The photo the message is about, when it is still in the list. */
  memo?: Memo
  /** Voice replies are switched on for this parent. */
  voiceOn: boolean
  backLabel?: string
  onDone: () => void
}) {
  const toast = useToast()
  const [phase, setPhase] = useState<'view' | 'recording' | 'sent'>('view')
  const [reading, setReading] = useState(canSpeak)
  const [hint, setHint] = useState('')
  const mic = useRef<Mic | null>(null)
  const held = useRef(false)

  const text = item.kind === 'comment' ? item.text ?? '' : S.elderCardHeart(item.actorName)

  const speak = () => {
    if (!canSpeak) return
    const u = new SpeechSynthesisUtterance(item.kind === 'comment' ? `${item.actorName}. ${text}` : text)
    u.lang = 'ko-KR'
    u.rate = 0.9
    u.onend = () => setReading(false)
    u.onerror = () => setReading(false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  }

  // Read the message aloud once, stamp everything unread as seen, and let go
  // of the microphone and the voice on the way out.
  const opened = useRef(false)
  useEffect(() => {
    if (!opened.current) {
      opened.current = true
      speak()
      markRead(unreadIds, 'elder')
    }
    return () => {
      if (canSpeak) window.speechSynthesis.cancel()
      mic.current?.close()
    }
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

  const finishVoice = async () => {
    const clip = await mic.current?.stop()
    if (!clip) { setPhase('view'); return }
    sendVoice({ uid, memoId: item.memoId, actorName: patientName, blob: clip.blob, ext: clip.ext })
      .catch((err) => console.warn('[news] voice reply not queued', err))
    setPhase('sent')
  }

  const onHold = async () => {
    held.current = true
    if (canSpeak) window.speechSynthesis.cancel()
    setReading(false)
    mic.current ??= new Mic()
    if (!mic.current.ready) {
      try {
        await mic.current.open()
      } catch (err) {
        console.warn('[news] microphone unavailable', err)
        toast.show('마이크를 쓸 수 없어요', '가족에게 알려 주세요')
        return
      }
      // The phone's permission question interrupts the first press.
      if (!held.current) { setHint('이제 꾹 누르고 말해 보세요'); return }
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

  return (
    <section className="page news">
      <button className="elder-back" onClick={onDone}>{backLabel}</button>

      {memo && <div className="news-photo"><MemoThumb memo={memo} /></div>}

      <div className="news-text">{text}</div>
      <div className="news-from">{item.actorName} · {fmtTime(new Date(item.createdAtMs))}</div>
      {canSpeak && (
        <button className="news-speak" onClick={() => { setReading(true); speak() }} aria-label="다시 읽어 주기">
          <span aria-hidden="true">🔊</span> {reading ? S.elderReading : '다시 듣기'}
        </button>
      )}

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
