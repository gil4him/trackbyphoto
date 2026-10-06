import { useEffect, useRef, useState } from 'react'
import { markFamilyPhotoSeen, replyToFamilyPhoto } from '../lib/familyPhotos'
import { viewerOrder } from '../lib/familyPhotosModel'
import { COMMENT_MAX } from '../lib/reactions'
import { QUICK_REPLIES, S } from '../lib/strings'
import { fmtDate } from '../util'
import type { FamilyPhoto, TextReplies } from '../types'

/**
 * The parent looks at photos the family sent, one at a time: the photo, a
 * line from the sender, and the same big replies as 가족 소식 (❤️ 고마워요,
 * or a ready-made written line). New photos come first. The order is fixed
 * when the screen opens, so a photo doesn't jump away as it is marked seen.
 */
export function FamilyPhotoViewer({ photos, textMode = 'quick', onDone, mark = markFamilyPhotoSeen, reply = replyToFamilyPhoto }: {
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
  const [draft, setDraft] = useState('')
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
      if (hasNext) { setIndex((i) => i + 1); setPhase('view'); setDraft('') } else onDone()
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
    return (
      <section className="page news">
        <button className="elder-back" onClick={() => setPhase('view')}>‹ 뒤로</button>
        <div className="news-from">{current.senderName}에게</div>
        <div className="news-text small">{S.elderReplyTextTitle}</div>
        <div className="news-actions">
          {QUICK_REPLIES.map((q) => (
            <button key={q} className="news-btn" onClick={() => send({ kind: 'comment', text: q })}>{q}</button>
          ))}
          {textMode === 'full' && (
            <form className="news-type" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) send({ kind: 'comment', text: draft }) }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={COMMENT_MAX} placeholder={S.elderReplyTextPlaceholder} aria-label="답장 직접 쓰기" enterKeyHint="send" />
              <button type="submit" disabled={!draft.trim()}>보내기</button>
            </form>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="page news fp-view">
      <button className="elder-back" onClick={onDone}>‹ 처음으로</button>
      <div className="fp-photo"><img src={current.photoUrl} alt={current.caption || `${current.senderName}이 보낸 사진`} /></div>
      {current.caption && <div className="news-text">{current.caption}</div>}
      <div className="news-from">{current.senderName} · {fmtDate(new Date(current.createdAtMs))}{order.length > 1 ? ` · ${index + 1}/${order.length}` : ''}</div>
      {current.reply && (
        <div className="fp-replied" role="status">
          {current.reply.kind === 'heart' ? '❤️ 고마워요를 보냈어요' : `“${current.reply.text}”라고 답했어요`}
        </div>
      )}
      <div className="news-actions">
        <button className="news-btn primary" onClick={() => send({ kind: 'heart' })}>{S.elderReplyHeart}</button>
        {textMode !== 'off' && <button className="news-btn" onClick={() => setPhase('text')}>{S.elderReplyText}</button>}
        {hasNext && <button className="news-btn quiet" onClick={() => setIndex((i) => i + 1)}>{S.familyPhotoNext}</button>}
      </div>
    </section>
  )
}
