import type { CSSProperties } from 'react'
import type { FamilyPhoto } from '../types'
import { fmtTime } from '../util'
import { listPhoto } from '../lib/listPhoto'
import { sentStatus } from '../lib/familyPhotosModel'
import { BottomSheet } from './BottomSheet'

/**
 * A photo this family member sent, as a row in their own 사진, among the
 * photos they took that day: the same tinted card as the parent's
 * ReceivedRow, edged in that parent's colour, saying whom it went to and
 * where it stands (보냈어요 → 봤어요 → the parent's answer).
 */
export function SentRow({ photo, to, color, onOpen }: { photo: FamilyPhoto; to: string; color: string; onOpen: (id: string) => void }) {
  const meta = [fmtTime(new Date(photo.createdAtMs)), sentStatus(photo)].join(' · ')
  return (
    <button type="button" className="memo-row received sent" style={{ '--pc': color } as CSSProperties} onClick={() => onOpen(photo.id)} aria-label={`${to}에게 보낸 사진 보기`}>
      <span className="memo-row-pic">
        <span className="tl-thumb">{photo.photoUrl && <img src={listPhoto(photo)} alt="" loading="lazy" />}</span>
      </span>
      <span className="memo-row-body">
        <span className="memo-row-title"><span className="sent-to">{to}</span>에게 보냄</span>
        <span className="memo-row-meta">{meta}</span>
      </span>
    </button>
  )
}

/** A sent photo opened from the list: the photo, whom it went to and where it stands. */
export function SentPhotoSheet({ photo, to, onClose }: { photo: FamilyPhoto; to: string; onClose: () => void }) {
  return (
    <BottomSheet title={`${to}에게 보낸 사진`} onClose={onClose}>
      <div className="sent-view">
        {photo.photoUrl && <img src={photo.photoUrl} alt="" />}
        <p className="sent-view-meta">{[fmtTime(new Date(photo.createdAtMs)), sentStatus(photo), photo.caption].filter(Boolean).join(' · ')}</p>
      </div>
      <button type="button" className="sheet-cancel" onClick={onClose}>닫기</button>
    </BottomSheet>
  )
}
