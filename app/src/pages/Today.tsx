import { useEffect, useMemo } from 'react'
import { fmtTime, relativeDateLabel } from '../util'
import { MemoThumb } from '../components/MemoThumb'
import { useOutbox } from '../hooks/useOutbox'
import { useWorkerStatus } from '../hooks/useWorkerStatus'
import type { OutboxItem } from '../lib/outbox'
import type { ReactionsContext } from '../components/Reactions'
import { cardTitle, rowCounts } from '../lib/memoViews'
import { isSimple } from '../lib/edition'
import { S } from '../lib/strings'
import type { Memo } from '../types'

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

/** A photo still on this phone, waiting to be sent. */
function WaitingPhoto({ item }: { item: OutboxItem }) {
  const url = useMemo(() => URL.createObjectURL(item.blob), [item.blob])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return (
    <div className="tl-item waiting">
      <div className="tl-thumb"><img src={url} alt="" /></div>
      <div className="tl-body">
        <div className="act">보내는 중…</div>
        <div className="desc">
          {fmtTime(new Date(item.takenAtMs))} · {item.attempts > 0 ? '인터넷이 약해요. 연결되면 자동으로 보내요.' : '곧 기록돼요.'}
        </div>
        {/* After several failed tries, say why, so it can be reported. */}
        {item.attempts >= 5 && item.lastError && <div className="desc muted">({item.lastError})</div>}
      </div>
    </div>
  )
}

/**
 * `uid` is whose records are shown; photos of theirs still waiting on this
 * phone are listed first. Each photo is one card — thumbnail, title, place
 * and time, and on the right what family left on it; the photo page holds
 * the thread and the ⋯ menu (deleting included). `readOnly` is accepted
 * for the elder's linked phone (nothing to hide here any more).
 */
export function Today({ memos, onOpen, uid, rx, onOpenTrail, onOpenVoiceAlbum, focusDay, onFocused }: { memos: Memo[]; onOpen: (id: string) => void; uid?: string; readOnly?: boolean; /** Hearts and comments per photo (family feed), for the counts. */ rx?: ReactionsContext; /** 다녀온 곳 for one day (shown on days that have a located photo). */ onOpenTrail?: (day: Date) => void; /** 목소리 앨범, on a plan that includes it (family only). */ onOpenVoiceAlbum?: () => void; /** Open scrolled to this day's photos (어제 보기 on the home), once. */ focusDay?: Date | null; onFocused?: () => void }) {
  // Hide a waiting photo once its memo shows up from the server.
  const memoIds = useMemo(() => new Set(memos.map((m) => m.id)), [memos])
  const waiting = useOutbox(uid).filter((i) => !memoIds.has(i.photoId))
  // While a memo is waiting, check the memo server is actually up.
  const serverDown = useWorkerStatus(memos.some((m) => m.status === 'pending')) === 'down'

  // Group recent shots by calendar day, newest day first. `memos` already
  // arrives ordered by takenAt desc (useMemos), so iterating in order keeps
  // both the groups and the cards within each group newest-first.
  const groups = useMemo(() => {
    const map = new Map<string, { date: Date; items: Memo[] }>()
    for (const m of memos) {
      const d = m.takenAt.toDate()
      const key = dayKey(d)
      if (!map.has(key)) map.set(key, { date: d, items: [] })
      map.get(key)!.items.push(m)
    }
    return Array.from(map.values())
  }, [memos])

  // 어제 보기: land on that day's header, then forget the request.
  useEffect(() => {
    if (!focusDay) return
    const el = document.querySelector(`[data-day="${dayKey(focusDay)}"]`)
    el?.scrollIntoView({ block: 'start' })
    onFocused?.()
  }, [focusDay, onFocused, groups])

  // 다녀온 곳 › stays in the full edition only.
  const trailLink = isSimple() ? undefined : onOpenTrail

  return (
    <section className="page">
      <div className="h-eyebrow">최근 기록</div>
      <h2 className="h-title">사진</h2>
      {onOpenVoiceAlbum && (
        <button type="button" className="va-link" onClick={onOpenVoiceAlbum}>🎙️ {S.voiceAlbum} ›</button>
      )}

      {waiting.length > 0 && (
        <div>
          <div className="tl-day">보내는 중</div>
          {waiting.map((i) => <WaitingPhoto key={i.photoId} item={i} />)}
        </div>
      )}

      {groups.length === 0 && waiting.length === 0 ? (
        <div className="empty">
          <div className="big">🌤️</div>
          <div>아직 기록이 없어요.</div>
          <div style={{ marginTop: 6, fontSize: 14 }}>홈에서 사진을 한 장 찍어보세요.</div>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.date.toISOString()} data-day={dayKey(g.date)}>
            <div className="tl-day">
              {relativeDateLabel(g.date)}
              {trailLink && g.items.some((m) => typeof m.lat === 'number' && typeof m.lng === 'number') && (
                <button type="button" className="trail-link" onClick={() => trailLink(g.date)}>다녀온 곳 ›</button>
              )}
            </div>
            {g.items.map((m) => {
              const counts = rowCounts(rx?.byMemo.get(m.id))
              return (
                <button
                  type="button"
                  key={m.id}
                  className="tl-item"
                  onClick={() => onOpen(m.id)}
                  aria-label="자세히 보기"
                >
                  <MemoThumb memo={m} />
                  <div className="tl-body">
                    {/* The memo's subject line is the title; where and when, under it. */}
                    <div className="act">{cardTitle(m, serverDown)}</div>
                    <div className="desc">{[m.place, fmtTime(m.takenAt.toDate())].filter(Boolean).join(' · ')}</div>
                  </div>
                  {counts && <span className="tl-rx">{counts}</span>}
                </button>
              )
            })}
          </div>
        ))
      )}
    </section>
  )
}
