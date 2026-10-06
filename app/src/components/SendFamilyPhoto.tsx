import { useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from './Toast'
import { removeFamilyPhoto, sendFamilyPhoto } from '../lib/familyPhotos'
import { sentStatus, sentToday } from '../lib/familyPhotosModel'
import { FAMILY_PHOTO_CAPTIONS, FAMILY_PHOTOS_PER_DAY, S } from '../lib/strings'
import { fmtTime } from '../util'
import type { FamilyPhoto } from '../types'

/**
 * A family member sends a photo to the parent: pick it, add a line (one of
 * the ready-made ones, or typed), send. The record is finished by the worker
 * and lands on the parent's home screen as a lit card.
 */
export function SendFamilyPhoto({ patientUid, patientName, sender, photos, onClose, send = sendFamilyPhoto }: {
  patientUid: string
  patientName: string
  sender: { uid: string; name: string }
  /** Already sent, for today's quiet limit. */
  photos: FamilyPhoto[]
  onClose: () => void
  /** Injected for tests. */
  send?: typeof sendFamilyPhoto
}) {
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const onSend = async () => {
    if (!file) return
    if (sentToday(photos, sender.uid) >= FAMILY_PHOTOS_PER_DAY) { toast.show(S.familyPhotoLimit); return }
    setBusy(true)
    try {
      await send({ patientUid, sender, file, caption })
      toast.show(S.familyPhotoSent, `${patientName}님이 앱을 열면 바로 보여요`)
      onClose()
    } catch (err) {
      console.error('[familyPhoto] send failed', err)
      toast.show('사진을 보내지 못했어요', '잠시 후 다시 시도해 주세요')
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-title">{S.familyPhotoSendTitle(patientName)}</div>
        <div className="modal-body fp-send">
          <input ref={inputRef} type="file" accept="image/*" hidden aria-label="사진 고르기" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {preview
            ? <button type="button" className="fp-pick has" onClick={() => inputRef.current?.click()}><img src={preview} alt="" /><span>다른 사진</span></button>
            : <button type="button" className="fp-pick" onClick={() => inputRef.current?.click()}>📷 사진 고르기</button>}
          <div className="help">{S.familyPhotoCaption}</div>
          <div className="name-chips">
            {FAMILY_PHOTO_CAPTIONS.map((c) => (
              <button key={c} type="button" className={`name-chip ${caption === c ? 'on' : ''}`} onClick={() => setCaption(caption === c ? '' : c)}>{c}</button>
            ))}
          </div>
          <input className="text-input" value={caption} onChange={(e) => setCaption(e.target.value.slice(0, 60))} placeholder="직접 입력 (60자)" aria-label="한마디" />
        </div>
        <div className="modal-actions">
          <button className="signin-secondary" disabled={busy} onClick={onClose}>취소</button>
          <button className="linkbtn" disabled={!file || busy} onClick={() => { void onSend() }}>
            <span>{busy ? '보내는 중…' : '보내기'}</span><span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/** What this family has sent the parent, newest first, with the parent's answer. */
export function SentFamilyPhotos({ photos, myUid, onRemove = removeFamilyPhoto }: {
  photos: FamilyPhoto[]
  myUid: string
  onRemove?: (p: FamilyPhoto) => Promise<void>
}) {
  const toast = useToast()
  if (photos.length === 0) return null
  return (
    <div className="fp-sent">
      <div className="h-eyebrow">{S.familyPhotoSentList}</div>
      {photos.slice(0, 12).map((p) => (
        <div className="fp-row" key={p.id}>
          <div className="fp-thumb">{p.photoUrl ? <img src={p.photoUrl} alt="" /> : <span aria-hidden="true">🖼️</span>}</div>
          <div className="fp-body">
            <div className="fp-cap">{p.caption || '(사진만)'}</div>
            <div className="fp-meta">{p.senderName} · {fmtTime(new Date(p.createdAtMs))} · <b className={p.reply ? 'fp-replied-mark' : ''}>{sentStatus(p)}</b></div>
          </div>
          {p.senderUid === myUid && (
            <button type="button" className="notice-x" aria-label="보낸 사진 지우기" onClick={() => {
              if (!confirm('이 사진을 지울까요? 부모님 화면에서도 사라져요.')) return
              onRemove(p).then(() => toast.show('사진을 지웠어요')).catch((err) => { console.error(err); toast.show('지우지 못했어요') })
            }}>✕</button>
          )}
        </div>
      ))}
    </div>
  )
}
