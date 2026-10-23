import type { FamilyPhoto } from '../types'
import { fmtTime } from '../util'
import { S } from '../lib/strings'
import { listPhoto } from '../lib/listPhoto'

/**
 * A photo the family sent, as a row in the parent's 내 사진, among the
 * parent's own photos of that day. The same shape as MemoRow, on a tinted
 * card with an accent edge so it reads as received rather than taken: who
 * sent it as the title, the time and their words (or the parent's answer)
 * under it. Opens the family-photo viewer on this photo.
 */
export function ReceivedRow({ photo, onOpen }: { photo: FamilyPhoto; onOpen: (id: string) => void }) {
  const answer = photo.reply?.kind === 'comment' && photo.reply.text ? `“${photo.reply.text}”` : photo.reply?.kind === 'heart' ? '❤️ 고마워요' : ''
  const meta = [fmtTime(new Date(photo.createdAtMs)), answer || photo.caption].filter(Boolean).join(' · ')
  return (
    <button type="button" className="memo-row received" onClick={() => onOpen(photo.id)} aria-label="가족 사진 보기">
      <span className="memo-row-pic">
        <span className="tl-thumb">{photo.photoUrl && <img src={listPhoto(photo)} alt="" loading="lazy" />}</span>
      </span>
      <span className="memo-row-body">
        <span className="memo-row-title">{S.familyPhotoFrom(photo.senderName)}</span>
        {meta && <span className="memo-row-meta">{meta}</span>}
      </span>
      {!photo.seenAtMs && <span className="memo-row-new" aria-label="새 사진" />}
    </button>
  )
}
