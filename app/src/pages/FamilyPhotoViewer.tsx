import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { TextReply } from '../components/TextReply'
import { markFamilyPhotoSeen, replyToFamilyPhoto } from '../lib/familyPhotos'
import { viewerOrder } from '../lib/familyPhotosModel'
import { S } from '../lib/strings'
import type { FamilyPhoto, TextReplies } from '../types'

/**
 * The parent looks at photos the family sent, one at a time: the photo, a
 * line from the sender, and the same big replies as 가족 소식 (❤️ 고마워요,
 * or a written line). New photos come first. The order is fixed
 * when the screen opens, so a photo doesn't jump away as it is marked seen.
 */
export function FamilyPhotoViewer({ photos, textMode = 'full', onDone, mark = markFamilyPhotoSeen, reply = replyToFamilyPhoto }: {
  photos: FamilyPhoto[]
  textMode?: TextReplies
  onDone: () => void
  /** Injected for tests. */
  mark?: (id: string) => Promise<void>
  reply?: typeof replyToFamilyPhoto
}) {
  const [order] = useState(() => viewerOrder(photos))
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<'view' | 'text' | 'sent'>('view')
  const typed = useRef<HTMLInputElement>(null)
  const [broken, setBroken] = useState<Set<string>>(() => new Set())
  const seen = useRef(new Set<string>())
  // The latest copy of the photo on screen (its reply may have just landed).
  const current = order[index] ? photos.find((p) => p.id === order[index].id) ?? order[index] : undefined
  const hasNext = index < order.length - 1

  useEffect(() => {
    const p = order[index]
    if (!p || p.seenAtMs || seen.current.has(p.id)) return
    seen.current.add(p.id)
    mark(p.id).catch((err) => console.warn('[familyPhoto] not marked seen', err))
  }, [order, index, mark])

  // "보냈어요 ✓" for a moment, then the next photo, or home when it was the last.
  useEffect(() => {
    if (phase !== 'sent') return
    const t = setTimeout(() => {
      if (hasNext) { setIndex((i) => i + 1); setPhase('view') } else onDone()
    }, 1500)
    return () => clearTimeout(t)
  }, [phase, hasNext, onDone])

  if (!current) {
    return (
      <section className="page news">
        <button className="elder-back" onClick={onDone}>‹ 처음으로</button>
        <div className="news-text">가족이 보낸 사진이 아직 없어요</div>
      </section>
    )
  }

  const send = (r: { kind: 'heart' } | { kind: 'comment'; text: string }) => {
    reply(current.id, r).catch((err) => console.warn('[familyPhoto] reply failed', err))
    setPhase('sent')
  }

  if (phase === 'sent') {
    return (
      <section className="page news sent" role="status">
        <div className="news-check" aria-hidden="true">✓</div>
        <div className="news-sent">{S.elderReplySent(current.senderName)}</div>
      </section>
    )
  }

  if (phase === 'text') {
    return <TextReply to={current.senderName} textMode={textMode} inputRef={typed} onBack={() => setPhase('view')} onSend={(text) => send({ kind: 'comment', text })} />
  }

  // Render the text box now and focus it inside this tap, so the keyboard opens.
  const openText = () => {
    flushSync(() => setPhase('text'))
    typed.current?.focus()
  }

  return (
    <section className="page news fp-view">
      <button className="elder-back" onClick={onDone}>‹ 처음으로</button>
      <div className="fp-photo">
        {broken.has(current.id)
          ? <div className="fp-broken">{S.familyPhotoLoadFail}</div>
          : <img
              src={current.photoUrl}
              alt={current.caption || `${current.senderName}이 보낸 사진`}
              onError={() => setBroken((b) => new Set(b).add(current.id))}
            />}
      </div>
      {current.caption && <div className="news-text">{current.caption}</div>}
      <div className="news-from">{S.familyPhotoFrom(current.senderName)}</div>
      {/* Answered already: say so, and offer only the way on — one reply per photo. */}
      {current.reply && (
        <div className="fp-replied" role="status">
          {current.reply.kind === 'heart' ? '❤️ 고마워요를 보냈어요' : `“${current.reply.text}”라고 답했어요`}
        </div>
      )}
      <div className="news-actions">
        {!current.reply && <button className="news-btn primary" onClick={() => send({ kind: 'heart' })}>{S.elderReplyHeart}</button>}
        {!current.reply && textMode !== 'off' && <button className="news-btn" onClick={openText}>{S.elderReplyText}</button>}
        {hasNext && <button className="news-btn quiet" onClick={() => setIndex((i) => i + 1)}>{S.familyPhotoNext}</button>}
      </div>
    </section>
  )
}
