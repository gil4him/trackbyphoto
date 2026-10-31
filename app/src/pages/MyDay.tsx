import { MemoRow } from '../components/MemoRow'
import { DayCard } from '../components/DayCard'
import { ParentGroupRow, ParentRow, SentDiaryRow } from '../components/DiaryRows'
import { useWorkerStatus } from '../hooks/useWorkerStatus'
import { clock, dayEyebrow, memosOnDay } from '../lib/memoViews'
import { collapseParents, diaryEntries, isNewParentPhoto, myDayCaption, type ParentMemo } from '../lib/diary'
import { useParentsSeenAt } from '../hooks/useParentsSeenAt'
import { tr } from '../lib/lang'
import type { SentEntry } from './Today'
import type { Memo } from '../types'

/**
 * A family member's own 오늘 (simple edition): their photo diary of the day,
 * in one white card (A14) — the photos they took, by time — with their
 * parents' photos of today (a run of one parent folds into one row) and what
 * they sent them woven in, indented. Sending lives in ⋯ on one's own photo.
 */
export function MyDay({ memos, parents, sent, onOpen, onOpenParentMemo, onOpenSent, onYesterday, afterDay, now = new Date() }: {
  /** One's own memos (any days; today's are picked here). */
  memos: Memo[]
  /** The parents' memos of today. */
  parents: ParentMemo[]
  /** What one sent the parents today. */
  sent: SentEntry[]
  onOpen: (id: string) => void
  onOpenParentMemo: (memo: Memo) => void
  onOpenSent: (id: string) => void
  /** 어제 보기 ›: 과거 at yesterday. */
  onYesterday: () => void
  /** Below the day's rows, above 어제 보기 (the one-time 가족·친구에게 알리기 card). */
  afterDay?: React.ReactNode
  now?: Date
}) {
  const mine = memosOnDay(memos, now)
  const seenAt = useParentsSeenAt()
  const rows = collapseParents(diaryEntries(mine, parents, sent), (p) => isNewParentPhoto(p.memo, seenAt))
  const serverDown = useWorkerStatus(mine.some((m) => m.status === 'pending')) === 'down'
  const timeOf = (m: Memo) => clock(m.takenAt.toDate())
  return (
    <section className="page home-day my-day" aria-label={tr('내 하루', 'My day')}>
      <header className="day-head">
        <div className="h-eyebrow">{dayEyebrow(now)}</div>
        <h1 className="day-title">{tr('내 하루', 'My day')}</h1>
        <div className="day-caption">{myDayCaption(mine.length, parents)}</div>
      </header>

      {rows.length === 0 ? (
        <div className="day-empty" role="status">
          {tr('오늘 아직 사진이 없어요', 'No photos today yet')}
          <div className="day-empty-sub">{tr('찍은 사진은 ⋯ 에서 부모님께 보낼 수 있어요', 'You can send a photo to your parent from ⋯')}</div>
        </div>
      ) : (
        <DayCard label={tr('오늘의 사진', "Today's photos")}>
          {rows.map((r) => {
            const time = clock(new Date(r.at))
            if (r.kind === 'mine') return <MemoRow key={`m-${r.memo.id}`} memo={r.memo} onOpen={onOpen} time={time} serverDown={serverDown} />
            if (r.kind === 'parent') return <ParentRow key={`p-${r.item.memo.id}`} item={r.item} onOpen={onOpenParentMemo} time={time} />
            if (r.kind === 'parentGroup') return <ParentGroupRow key={`g-${r.items[0].memo.id}`} items={r.items} onOpen={onOpenParentMemo} time={time} timeOf={timeOf} />
            return <SentDiaryRow key={`s-${r.item.photo.id}`} photo={r.item.photo} to={r.item.to} color={r.item.color} onOpen={onOpenSent} time={time} />
          })}
        </DayCard>
      )}

      {afterDay}

      <button type="button" className="day-more" onClick={onYesterday}>{tr('어제 보기 ›', 'See yesterday ›')}</button>
    </section>
  )
}
