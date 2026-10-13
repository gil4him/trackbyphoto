import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { TextReply } from '../components/TextReply'
import { markFamilyPhotoSeen, replyToFamilyPhoto } from '../lib/familyPhotos'
import { keepFamilyPhotoOnDevice } from '../lib/familyPhotoKeep'
import { photoDayLabel, showable } from '../lib/familyPhotosModel'
import { S } from '../lib/strings'
import type { FamilyPhoto, TextReplies } from '../types'

/**
 * The photos the family sent, on the parent's phone. First the album: a grid
 * of big thumbnails, newest first, a dot on the ones not looked at yet and a
 * small mark on the ones already answered. Tapping one opens it full-size
 * with a line from the sender and the same big replies as 가족 소식 (❤️
 * 고마워요, or a written line). Only the full-size view marks a photo seen and
 * keeps a copy on the phone; after a reply the album comes back.
 */
export function FamilyPhotoViewer({ photos, textMode = 'full', onDone, startAt, mark = markFamilyPhotoSeen, reply = replyToFamilyPhoto, keep = keepFamilyPhotoOnDevice }: {
  photos: FamilyPhoto[]
  textMode?: TextReplies
  onDone: () => void
  /** Open on this photo instead of the album (tests). */
  startAt?: string
  /** Injected for tests. */
  mark?: (id: string) => Promise<void>
  reply?: typeof replyToFamilyPhoto
  /** A copy on this phone, once (familyPhotoKeep). */
  keep?: (p: FamilyPhoto) => Promise<void>
}) {
  // The album is live (a photo arriving while it is open shows up); the
  // open photo is found by id so it never jumps when the list changes.
  const all = showable(photos)
  const [openId, setOpenId] = useState<string | null>(startAt ?? null)
  const [phase, setPhase] = useState<'view' | 'text' | 'sent'>('view')
  const typed = useRef<HTMLInputElement>(null)
  const [broken, setBroken] = useState<Set<string>>(() => new Set())
  const seen = useRef(new Set<string>())
  const at = openId ? all.findIndex((p) => p.id === openId) : -1
  const current = at >= 0 ? all[at] : undefined
  const next = at >= 0 ? all[at + 1] : undefined

  useEffect(() => {
    if (!current) return
    void keep(current) // its own once-per-photo memory
    if (current.seenAtMs || seen.current.has(current.id)) return
    seen.current.add(current.id)
    mark(current.id).catch((err) => console.warn('[familyPhoto] not marked seen', err))
  }, [current, mark, keep])

  // "보냈어요 ✓" for a moment, then back to the album.
  useEffect(() => {
    if (phase !== 'sent') return
    const t = setTimeout(() => { setOpenId(null); setPhase('view') }, 1500)
    return () => clearTimeout(t)
  }, [phase])

  if (all.length === 0) {
    return (
      <section className="page news">
        <button className="elder-back" onClick={onDone}>‹ 처음으로</button>
        <div className="news-text">가족이 보낸 사진이 아직 없어요</div>
      </section>
    )
  }

  const onBroken = (id: string) => setBroken((b) => new Set(b).add(id))

  if (!current) {
    return (
      <section className="page news fp-list">
        <button className="elder-back" onClick={onDone}>‹ 처음으로</button>
        <h1 className="fp-list-title">{S.familyPhotoListTitle}</h1>
        <ul className="fp-grid">
          {all.map((p) => (
            <li key={p.id}>
              <button type="button" className={`fp-cell${p.seenAtMs ? '' : ' new'}`} onClick={() => { setOpenId(p.id); setPhase('view') }}>
                <span className="fp-cell-img">
                  {broken.has(p.id)
                    ? <span className="fp-cell-broken" aria-hidden="true">🖼️</span>
                    : <img src={p.photoUrl} alt={p.caption || `${p.senderName}이 보낸 사진`} onError={() => onBroken(p.id)} />}
                </span>
                {!p.seenAtMs && <span className="fp-cell-dot" role="img" aria-label={S.familyPhotoNew} />}
                {p.reply && <span className="fp-cell-mark" aria-label="답장했어요">{p.reply.kind === 'heart' ? '❤️' : '💬'}</span>}
                <span className="fp-cell-foot">
                  <span className="fp-cell-who">{p.senderName}</span>
                  <span className="fp-cell-when">{photoDayLabel(p.createdAtMs)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
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
      <button className="elder-back" onClick={() => setOpenId(null)}>{S.familyPhotoListBack}</button>
      <div className="fp-photo">
        {broken.has(current.id)
          ? <div className="fp-broken">{S.familyPhotoLoadFail}</div>
          : <img
              src={current.photoUrl}
              alt={current.caption || `${current.senderName}이 보낸 사진`}
              onError={() => onBroken(current.id)}
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
        {next && <button className="news-btn quiet" onClick={() => setOpenId(next.id)}>{S.familyPhotoNext}</button>}
      </div>
    </section>
  )
}
