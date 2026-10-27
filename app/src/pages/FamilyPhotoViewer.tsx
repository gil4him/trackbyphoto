import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { TextReply } from '../components/TextReply'
import { markFamilyPhotoSeen, replyToFamilyPhoto } from '../lib/familyPhotos'
import { keepFamilyPhotoOnDevice } from '../lib/familyPhotoKeep'
import { unseen, viewerOrder } from '../lib/familyPhotosModel'
import { S } from '../lib/strings'
import { fmtTime } from '../util'
import type { FamilyPhoto, TextReplies } from '../types'
import { tr } from '../lib/lang'

/** Up to this many photos in a run, a dot each; more → `1 / 12`. */
const DOTS_MAX = 9
/** `다음 사진 ›` on a narrow button: the chevron stays with the last word. */
const tail = (s: string) => s.replace(/ ›$/, '\u00a0›')

/**
 * The photos the family sent, on the parent's phone, one at a time and
 * nothing else: the photo, a line from the sender, 글로 답하기, and the way
 * on (다음 사진 while more new ones wait, else 돌아가기). From the camera's
 * bubble it walks the new photos, newest first; from 내 사진 it shows the one
 * photo tapped. The order is fixed when the screen opens, so a photo doesn't
 * jump away as it is marked seen. After the last photo the caller's screen
 * comes back (`onDone(true)` — the caller says 다 보셨어요).
 * A written reply is one tap on a phrase, never the keyboard. Each photo
 * shown is marked seen and kept on the phone (docs/DAYLIE_V3_UI_FIX.md A9).
 * Layout (A12): who sent it and where we are in the run on top, the photo at
 * its own shape, the message and the time under it, and the actions pinned
 * above the safe area: 글로 답하기 · 다음 사진 (or 돌아가기) side by side.
 */
export function FamilyPhotoViewer({ photos, textMode = 'full', onDone, startId, mark = markFamilyPhotoSeen, reply = replyToFamilyPhoto, keep = keepFamilyPhotoOnDevice }: {
  photos: FamilyPhoto[]
  textMode?: TextReplies
  /** Open on this photo (tapped in 내 사진); the rest follow in the usual order. */
  startId?: string
  /** `allSeen`: the parent went through to the last photo (true), or there was nothing to show. */
  onDone: (allSeen: boolean) => void
  /** Injected for tests. */
  mark?: (id: string) => Promise<void>
  reply?: typeof replyToFamilyPhoto
  /** A copy on this phone, once (familyPhotoKeep). */
  keep?: (p: FamilyPhoto) => Promise<void>
}) {
  // From 내 사진: just that photo. From the camera's bubble: the new ones.
  const [order] = useState(() => {
    if (startId) return viewerOrder(photos, startId).filter((p) => p.id === startId)
    const fresh = unseen(photos)
    return fresh.length > 0 ? fresh : viewerOrder(photos)
  })
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<'view' | 'text' | 'sent'>('view')
  const typed = useRef<HTMLInputElement>(null)
  const [broken, setBroken] = useState<Set<string>>(() => new Set())
  // Each photo's own shape, once it has loaded (nothing is stored for it).
  const [shapes, setShapes] = useState<Record<string, string>>({})
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
        <div className="news-text">{tr('가족이 보낸 사진이 아직 없어요', 'No photos from your family yet')}</div>
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

  const place = `${index + 1} / ${order.length}`
  const onward = hasNext
    ? <button className="fp-btn" onClick={() => setIndex((i) => i + 1)}>{tail(S.familyPhotoNext)}</button>
    : <button className="fp-btn" onClick={() => onDone(true)}>{tail(S.familyPhotoToCamera)}</button>
  return (
    <section className="page fp-view">
      <div className="fp-top">
        <div className="fp-from">{S.familyPhotoFrom(current.senderName)}</div>
        {order.length < 2 ? null : order.length > DOTS_MAX
          ? <div className="fp-count">{place}</div>
          : (
            <div className="fp-dots" aria-label={place}>
              {order.map((p, i) => <span key={p.id} className={`fp-dot${i === index ? ' on' : ''}`} />)}
            </div>
          )}
      </div>
      {/* The photo at its own shape, up to the cap; above it the whole photo on the surface, never black bars. */}
      <div className="fp-photo" style={{ aspectRatio: shapes[current.id] ?? '4 / 3' }}>
        {broken.has(current.id)
          ? <div className="fp-broken">{S.familyPhotoLoadFail}</div>
          : <img
              src={current.photoUrl}
              alt={current.caption || tr(`${current.senderName}이 보낸 사진`, `Photo from ${current.senderName}`)}
              onLoad={(e) => { const { naturalWidth: w, naturalHeight: h } = e.currentTarget; if (w && h) setShapes((s) => ({ ...s, [current.id]: `${w} / ${h}` })) }}
              onError={() => setBroken((b) => new Set(b).add(current.id))}
            />}
      </div>
      {current.caption && <div className="fp-message">{current.caption}</div>}
      <div className="fp-caption">{fmtTime(new Date(current.createdAtMs))}{order.length > 1 ? ` · ${place}` : ''}</div>
      {/* Answered already: say so, and offer only the way on — one reply per photo. */}
      {current.reply && (
        <div className="fp-replied" role="status">
          {current.reply.kind === 'heart' ? tr('❤️ 고마워요를 보냈어요', 'You sent ❤️ Thank you') : tr(`“${current.reply.text}”라고 답했어요`, `You replied “${current.reply.text}”`)}
        </div>
      )}
      <div className="fp-actions">
        <div className="fp-row2">
          {!current.reply && textMode !== 'off' && <button className="fp-btn" onClick={openText}>{S.familyPhotoReplyText}</button>}
          {onward}
        </div>
      </div>
    </section>
  )
}
