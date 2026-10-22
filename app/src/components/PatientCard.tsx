import { MemoThumb } from './MemoThumb'
import { fmtTime, isSameDay, relativeDateLabel } from '../util'
import { addressed, honorific } from '../lib/people'
import { memosOnDay } from '../lib/memoViews'
import type { ParentSummary } from '../lib/dashboard'

/**
 * A connected parent on the family's own home (docs/DAYLIE_V3_UI_FIX.md A10):
 * who, how many photos today and when the last came, today's photos in a
 * small strip that scrolls sideways,
 * and the newest unread news. No buttons — the whole card opens that
 * parent's day.
 */
export function PatientCard({ parent, onOpen, now = new Date() }: {
  parent: ParentSummary
  onOpen: () => void
  /** Injected in tests. */
  now?: Date
}) {
  const { name, memos, unread } = parent
  const todays = memosOnDay(memos, now)
  const yday = new Date(now); yday.setDate(yday.getDate() - 1)
  const yesterdays = memosOnDay(memos, yday).length
  const last = todays[0]
  const who = honorific(name)
  const newsAt = unread?.createdAt?.toMillis?.()
  const newsDate = newsAt ? new Date(newsAt) : null
  return (
    <button type="button" className="patient-card" onClick={onOpen} aria-label={`${who}의 하루 보기`}>
      <span className="pc-head">
        <span className="pc-avatar" aria-hidden="true">{name.trim().slice(0, 1)}</span>
        <span className="pc-text">
          <span className="pc-title">{who}의 하루</span>
          <span className="pc-caption">사진 {todays.length}장{last ? ` · 마지막 ${fmtTime(last.takenAt.toDate())}` : ''}</span>
        </span>
        <span className="pc-go" aria-hidden="true">보기 ›</span>
      </span>
      {/* A strip that scrolls sideways, newest first; small, so the card stays short. */}
      {todays.length > 0 ? (
        <span className="pc-thumbs" aria-hidden="true">
          {todays.slice(0, 12).map((m) => <span key={m.id} className="pc-thumb"><MemoThumb memo={m} /></span>)}
        </span>
      ) : (
        <span className="pc-empty">오늘 아직 사진이 없어요{yesterdays > 0 ? ` · 어제 사진 ${yesterdays}장` : ''}</span>
      )}
      {unread && (
        <span className="pc-news">
          <span className="pc-pill">새 소식</span>
          <span className="pc-news-text">{addressed(unread.message, name)}</span>
          {newsDate && <span className="pc-news-time">{isSameDay(newsDate, now) ? fmtTime(newsDate) : relativeDateLabel(newsDate)}</span>}
        </span>
      )}
    </button>
  )
}
