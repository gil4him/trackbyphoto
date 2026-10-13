import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { TextReply } from '../components/TextReply'
import { markFamilyPhotoSeen, replyToFamilyPhoto } from '../lib/familyPhotos'
import { keepFamilyPhotoOnDevice } from '../lib/familyPhotoKeep'
import { viewerOrder } from '../lib/familyPhotosModel'
import { S } from '../lib/strings'
import type { FamilyPhoto, TextReplies } from '../types'

/**
 * The photos the family sent, on the parent's phone, one at a time and
 * nothing else: the photo, a line from the sender, ❤️ 고마워요, and the way
 * on. New photos come first (the camera's banner opens the newest unseen),
 * then the rest, newest first; the order is fixed when the screen opens, so
 * a photo doesn't jump away as it is marked seen. After the last photo the
 * camera comes back by itself (`onDone(true)` — the caller says 다 보셨어요).
 * A written reply is one tap on a phrase, never the keyboard. Each photo
 * shown is marked seen and kept on the phone (docs/DAYLIE_V3_UI_FIX.md A9).
 */
export function FamilyPhotoViewer({ photos, textMode = 'full', onDone, mark = markFamilyPhotoSeen, reply = replyToFamilyPhoto, keep = keepFamilyPhotoOnDevice }: {
  photos: FamilyPhoto[]
  textMode?: TextReplies
  /** `allSeen`: the parent went through to the last photo (true), or there was nothing to show. */
  onDone: (allSeen: boolean) => void
  /** Injected for tests. */
  mark?: (id: string) => Promise<void>
  reply?: typeof replyToFamilyPhoto
  /** A copy on this phone, once (familyPhotoKeep). */
  keep?: (p: FamilyPhoto) => Promise<void>
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
    if (!p) return
    void keep(p) // its own once-per-photo memory
    if (p.seenAtMs || seen.current.has(p.id)) return
    seen.current.add(p.id)
    mark(p.id).catch((err) => console.warn('[familyPhoto] not marked seen', err))
  }, [order, index, mark, keep])

  // "보냈어요 ✓" for a moment, then the next photo, or the camera after the last.
  useEffect(() => {
    if (phase !== 'sent') return
    const t = setTimeout(() => {
      if (hasNext) { setIndex((i) => i + 1); setPhase('view') } else onDone(true)
    }, 1500)
    return () => clearTimeout(t)
  }, [phase, hasNext, onDone])

  if (!current) {
    return (
      <section className="page news">
        <div className="news-text">가족이 보낸 사진이 아직 없어요</div>
        <div className="news-actions">
          <button className="news-btn" onClick={() => onDone(false)}>{S.familyPhotoToCamera}</button>
        </div>
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

  // Phrases only, whatever the family chose: no keyboard on this screen.
  if (phase === 'text') {
    return <TextReply to={current.senderName} textMode="quick" inputRef={typed} onBack={() => setPhase('view')} onSend={(text) => send({ kind: 'comment', text })} />
  }

  const openText = () => {
    flushSync(() => setPhase('text'))
  }

  return (
    <section className="page news fp-view">
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
        {!current.reply && textMode !== 'off' && <button className="news-btn quiet" onClick={openText}>{S.elderReplyText}</button>}
        {hasNext
          ? <button className="news-btn" onClick={() => setIndex((i) => i + 1)}>{S.familyPhotoNext}</button>
          : <button className="news-btn" onClick={() => onDone(true)}>{S.familyPhotoToCamera}</button>}
      </div>
    </section>
  )
}
