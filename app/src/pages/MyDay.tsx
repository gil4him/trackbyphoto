import type { CSSProperties } from 'react'
import { MemoRow } from '../components/MemoRow'
import { SentRow } from '../components/SentRow'
import { useWorkerStatus } from '../hooks/useWorkerStatus'
import { cardMeta, clock, dayEyebrow, memosOnDay } from '../lib/memoViews'
import { diaryEntries, type ParentMemo } from '../lib/diary'
import type { SentEntry } from './Today'
import type { Memo } from '../types'

/** A parent's photo among one's own: indented, edged in that parent's colour, their name first. */
export function ParentMemoRow({ item, onOpen }: { item: ParentMemo; onOpen: (memo: Memo) => void }) {
  const meta = [item.name, cardMeta(item.memo, undefined)].filter(Boolean).join(' · ')
  return (
    <div className="parent-memo" style={{ '--pc': item.color } as CSSProperties}>
      <MemoRow memo={item.memo} onOpen={() => onOpen(item.memo)} meta={meta} />
    </div>
  )
}

/**
 * A family member's own 오늘 (simple edition): their photo diary of the day,
 * like the parent's day page — the photos they took, by time — with their
 * parents' photos of today and what they sent them woven in, indented.
 */
export function MyDay({ memos, parents, sent, onOpen, onOpenParentMemo, onOpenSent, onYesterday, now = new Date() }: {
  /** One's own memos (any days; today's are picked here). */
  memos: Memo[]
  /** The parents' memos of today. */
  parents: ParentMemo[]
  /** What one sent the parents today. */
  sent: SentEntry[]
  onOpen: (id: string) => void
  onOpenParentMemo: (memo: Memo) => void
  onOpenSent: (id: string) => void
  /** 어제 보기 ›: 지난 기록 at yesterday. */
  onYesterday: () => void
  now?: Date
}) {
  const mine = memosOnDay(memos, now)
  const entries = diaryEntries(mine, parents, sent)
  const serverDown = useWorkerStatus(mine.some((m) => m.status === 'pending')) === 'down'
  return (
    <section className="page home-day my-day" aria-label="내 하루">
      <header className="day-head">
        <div className="h-eyebrow">{dayEyebrow(now)}</div>
        <h1 className="day-title">내 하루</h1>
        <div className="day-caption">사진 {mine.length}장</div>
      </header>

      {entries.length === 0 ? (
        <div className="day-empty" role="status">오늘 아직 사진이 없어요</div>
      ) : (
        <ol className="day-tl" aria-label="오늘의 사진">
          {entries.map((e) => {
            const time = clock(new Date(e.at))
            if (e.kind === 'mine') {
              return <li key={`m-${e.memo.id}`}><MemoRow memo={e.memo} onOpen={onOpen} time={time} serverDown={serverDown} /></li>
            }
            return (
              <li key={`${e.kind}-${e.kind === 'parent' ? e.item.memo.id : e.item.photo.id}`}>
                <div className="day-item">
                  <div className="day-rail"><span className="day-time">{time}</span><span className="day-dot" aria-hidden="true" /></div>
                  {e.kind === 'parent'
                    ? <ParentMemoRow item={e.item} onOpen={onOpenParentMemo} />
                    : <div className="parent-memo sent-in-day"><SentRow photo={e.item.photo} to={e.item.to} color={e.item.color} onOpen={onOpenSent} /></div>}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <button type="button" className="day-more" onClick={onYesterday}>어제 보기 ›</button>
    </section>
  )
}
