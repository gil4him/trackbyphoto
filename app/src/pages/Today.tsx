import { useEffect, useMemo } from 'react'
import { fmtTime, relativeDateLabel } from '../util'
import { deleteMemo } from '../lib/capture'
import { useToast } from '../components/Toast'
import { MemoThumb } from '../components/MemoThumb'
import { useOutbox } from '../hooks/useOutbox'
import { useWorkerStatus } from '../hooks/useWorkerStatus'
import type { OutboxItem } from '../lib/outbox'
import { Reactions, type ReactionsContext } from '../components/Reactions'
import type { Memo } from '../types'

/** A photo still on this phone, waiting to be sent. */
function WaitingPhoto({ item }: { item: OutboxItem }) {
  const url = useMemo(() => URL.createObjectURL(item.blob), [item.blob])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return (
    <div className="tl-item waiting">
      <div className="tl-thumb"><img src={url} alt="" /></div>
      <div className="tl-body">
        <div className="when">{fmtTime(new Date(item.takenAtMs))}</div>
        <div className="act">보내는 중…</div>
        <div className="desc">
          {item.attempts > 0 ? '인터넷이 약해요. 연결되면 자동으로 보내요.' : '곧 기록돼요.'}
        </div>
      </div>
    </div>
  )
}

/**
 * `uid` is whose records are shown; photos of theirs still waiting on this
 * phone are listed first. `readOnly` (an elder's linked phone) hides the
 * delete buttons.
 */
export function Today({ memos, onOpen, uid, readOnly = false, rx, onOpenTrail }: { memos: Memo[]; onOpen: (id: string) => void; uid?: string; readOnly?: boolean; /** Hearts and comments under each photo (family feed). */ rx?: ReactionsContext; /** 다녀온 곳 for one day (shown on days that have a located photo). */ onOpenTrail?: (day: Date) => void }) {
  const toast = useToast()
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
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      if (!map.has(key)) map.set(key, { date: d, items: [] })
      map.get(key)!.items.push(m)
    }
    return Array.from(map.values())
  }, [memos])

  const onDelete = (m: Memo) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('이 사진을 삭제할까요?')) return
    deleteMemo({ memoId: m.id, photoPath: m.photoPath }).catch((err) => {
      console.error(err)
      toast.show('삭제에 실패했어요', '잠시 후 다시 시도해주세요')
    })
  }

  return (
    <section className="page">
      <div className="h-eyebrow">최근 기록</div>
      <h2 className="h-title">사진</h2>

      {waiting.length > 0 && (
        <div>
          <div className="q-datehdr">보내는 중</div>
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
          <div key={g.date.toISOString()}>
            <div className="q-datehdr">
              {relativeDateLabel(g.date)}
              {onOpenTrail && g.items.some((m) => typeof m.lat === 'number' && typeof m.lng === 'number') && (
                <button type="button" className="trail-link" onClick={() => onOpenTrail(g.date)}>다녀온 곳 ›</button>
              )}
            </div>
            {g.items.map((m) => (
              <div className="tl-wrap" key={m.id}>
              <button
                type="button"
                className="tl-item"
                onClick={() => onOpen(m.id)}
                aria-label="자세히 보기"
              >
                <MemoThumb memo={m} />
                <div className="tl-body">
                  <div className="when">{fmtTime(m.takenAt.toDate())}</div>
                  <div className="act">{m.activity || '기록'}</div>
                  <div className="desc">
                    {m.place ? `${m.place} · ` : ''}
                    {m.status !== 'pending' ? m.memo
                      : serverDown ? '메모 서버가 쉬는 중이에요. 켜지면 써 드려요.'
                      : '메모 작성 중…'}
                  </div>
                </div>
                {!readOnly && <span
                  className="del-btn"
                  role="button"
                  aria-label="사진 삭제"
                  onClick={onDelete(m)}
                >
                  ✕
                </span>}
              </button>
              {rx && <Reactions memoId={m.id} ctx={rx} max={3} />}
              </div>
            ))}
          </div>
        ))
      )}
    </section>
  )
}
