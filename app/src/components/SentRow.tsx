import type { FamilyPhoto } from '../types'
import { fmtTime } from '../util'
import { sentStatus } from '../lib/familyPhotosModel'
import { BottomSheet } from './BottomSheet'

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
