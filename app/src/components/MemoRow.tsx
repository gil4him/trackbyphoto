import { MemoThumb } from './MemoThumb'
import { cardTitle, reactionCounts, rowMeta } from '../lib/memoViews'
import type { Memo, Reaction } from '../types'

/**
 * One photo as a row (docs/DAYLIE_V3_UI_FIX.md A14.1–A14.2): a 60pt
 * thumbnail, the memo's line as the title (one line), and one muted line with
 * the place's name, the hearts and words counted at its right end. Rows sit
 * in the day's white card (DayCard) with dividers between them.
 *
 * `time` puts the time in a left column; `badge` numbers the photo on the
 * thumbnail (only 다녀온 곳 does); `fresh` is an unread dot in its own
 * column on the right.
 */
export function MemoRow({ memo, onOpen, reactions, meta, badge, time, fresh = false, serverDown = false }: {
  memo: Memo
  onOpen: (id: string) => void
  /** Hearts and words left on the photo, counted at the end of the meta line. */
  reactions?: Reaction[]
  /** Replaces the place name on the meta line. */
  meta?: string
  badge?: number
  time?: string
  /** Something not looked at yet. */
  fresh?: boolean
  /** The memo server is down, so a pending memo says so. */
  serverDown?: boolean
}) {
  const line = meta ?? rowMeta(memo)
  const { hearts, words } = reactionCounts(reactions)
  const card = (
    <button type="button" className="memo-row" onClick={() => onOpen(memo.id)} aria-label="자세히 보기">
      <span className="memo-row-pic">
        <MemoThumb memo={memo} />
        {badge !== undefined && <span className="memo-row-badge" aria-hidden="true">{badge}</span>}
      </span>
      <span className="memo-row-body">
        <span className="memo-row-title">{cardTitle(memo, serverDown)}</span>
        {(line || hearts > 0 || words > 0) && (
          <span className="memo-row-line">
            <span className="memo-row-meta">{line}</span>
            {(hearts > 0 || words > 0) && (
              <span className="memo-row-rx" aria-label={[hearts ? `하트 ${hearts}` : '', words ? `글 ${words}` : ''].filter(Boolean).join(', ')}>
                {hearts > 0 && <span className="memo-rx-heart">♥ {hearts}</span>}
                {words > 0 && <span>💬 {words}</span>}
              </span>
            )}
          </span>
        )}
      </span>
      <span className="memo-row-side">{fresh && <span className="memo-row-new" aria-label="새 소식" />}</span>
    </button>
  )
  if (time === undefined) return card
  return (
    <div className="day-item">
      <span className="day-time">{time}</span>
      {card}
    </div>
  )
}
