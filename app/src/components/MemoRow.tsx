import { MemoThumb } from './MemoThumb'
import { cardMeta, cardTitle } from '../lib/memoViews'
import type { Memo, Reaction } from '../types'

/**
 * One photo as a row, the same everywhere (docs/DAYLIE_V3_UI_FIX.md A13):
 * the parent's day on the home, the 사진 list and 다녀온 곳. A 52px
 * thumbnail, the memo's line as the title (two lines at most) and one muted
 * meta line `장소 · 카테고리 · ♥ 이름 · 💬 n`. The whole card opens the photo.
 *
 * `badge` numbers the photo (1 = the day's first) on the thumbnail's corner;
 * `time` puts the row on the day's rail — the time, a dot on the line.
 */
export function MemoRow({ memo, onOpen, reactions, meta, badge, time, fresh = false, serverDown = false }: {
  memo: Memo
  onOpen: (id: string) => void
  /** Hearts and words left on the photo, for the meta line. */
  reactions?: Reaction[]
  /** Replaces the usual meta line. */
  meta?: string
  badge?: number
  time?: string
  /** The parent's own phone: family left something not looked at yet. */
  fresh?: boolean
  /** The memo server is down, so a pending memo says so. */
  serverDown?: boolean
}) {
  const line = meta ?? cardMeta(memo, reactions)
  const card = (
    <button type="button" className="memo-row" onClick={() => onOpen(memo.id)} aria-label="자세히 보기">
      <span className="memo-row-pic">
        <MemoThumb memo={memo} />
        {badge !== undefined && <span className="memo-row-badge" aria-hidden="true">{badge}</span>}
      </span>
      <span className="memo-row-body">
        <span className="memo-row-title">{cardTitle(memo, serverDown)}</span>
        {line && <span className="memo-row-meta">{line}</span>}
      </span>
      {fresh && <span className="memo-row-new" aria-label="새 소식" />}
    </button>
  )
  if (time === undefined) return card
  return (
    <div className="day-item">
      <div className="day-rail">
        <span className="day-time">{time}</span>
        <span className="day-dot" aria-hidden="true" />
      </div>
      {card}
    </div>
  )
}
