import { MemoThumb } from './MemoThumb'
import { DateJumpInput } from './CalendarFab'
import { CameraGlyph } from './CameraFab'
import { listPhoto } from '../lib/listPhoto'
import { subject } from '../lib/strings'
import { hasUnseen, receivedLine, recordDays, tileAria, tileChip, tileTime, type RecordItem } from '../lib/elderRecords'
import { dayHeading, landingDay } from '../util'
import type { FamilyPhoto, Memo, Reaction } from '../types'

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

/**
 * One of the parent's photos as a square tile (A14.7): the photo, a white
 * chip with the family's hearts/words, an accent 새 소식 chip while unread,
 * and only the time underneath. The tile opens the photo; place, 동/구,
 * category and the AI line wait there.
 */
export function ElderRecordTile({ memo, reactions, patientUid, wide, onOpen }: { memo: Memo; reactions?: Reaction[]; patientUid: string; wide: boolean; onOpen: (id: string) => void }) {
  const chip = tileChip(reactions, patientUid, wide)
  const unseen = hasUnseen(reactions, patientUid)
  return (
    <button type="button" className="elder-tile" data-unseen={unseen ? '' : undefined} onClick={() => onOpen(memo.id)} aria-label={tileAria(memo, reactions, patientUid)}>
      <span className="elder-tile-photo">
        <MemoThumb memo={memo} />
        {unseen && <span className="elder-tile-new" aria-hidden="true">새 소식</span>}
        {chip && <span className="elder-tile-chip" aria-hidden="true">{chip}</span>}
      </span>
      <span className="elder-tile-time">{tileTime(memo, wide)}</span>
    </button>
  )
}

/** A photo the family sent: one horizontal card that breaks the grid, indented and edged in the accent. */
export function ElderReceivedCard({ photo, onOpen }: { photo: FamilyPhoto; onOpen: (id: string) => void }) {
  const second = [receivedLine(photo), photo.caption ? `“${photo.caption}”` : ''].filter(Boolean)
  return (
    <button type="button" className="elder-received" onClick={() => onOpen(photo.id)} aria-label={`${subject(photo.senderName)} 보낸 사진${photo.seenAtMs ? '' : ', 새 소식'}`}>
      <span className="elder-received-photo"><span className="tl-thumb">{photo.photoUrl && <img src={listPhoto(photo)} alt="" loading="lazy" />}</span></span>
      <span className="elder-received-body">
        <span className="elder-received-title">{!photo.seenAtMs && <span className="elder-tile-new static">새 소식</span>}{subject(photo.senderName)} 보냈어요</span>
        <span className="elder-received-line">{photo.caption && !photo.reply ? `${receivedLine(photo)} · “${photo.caption}”` : second.join(' · ')}</span>
      </span>
    </button>
  )
}

/** Runs of tiles between received cards, in the day's order. */
function runsOf(items: RecordItem[]): (RecordItem[] | RecordItem)[] {
  const out: (RecordItem[] | RecordItem)[] = []
  for (const it of items) {
    if (it.kind === 'received') { out.push(it); continue }
    const last = out[out.length - 1]
    if (Array.isArray(last)) last.push(it)
    else out.push([it])
  }
  return out
}

/**
 * The parent's 내 사진: a 3-column photo grid by day (2 columns with 큰 글자,
 * one more on a tablet), received photos as cards between the tiles in time
 * order, a 새 소식 n › line on days with something unread, and a fixed
 * bottom bar with 날짜로 찾기 and 카메라 (OWNER DECISION A14.7: BOTTOM BAR).
 */
export function ElderRecords({ memos, received, byMemo, patientUid, bigText = false, onOpen, onOpenReceived, onCamera }: {
  memos: Memo[]
  received: FamilyPhoto[]
  byMemo?: Map<string, Reaction[]>
  patientUid: string
  /** 설정 › 큰 글자: two columns instead of three. */
  bigText?: boolean
  onOpen: (id: string) => void
  onOpenReceived: (id: string) => void
  onCamera: () => void
}) {
  const days = recordDays(memos, received)
  const jump = (picked: Date) => {
    const day = landingDay(days.map((d) => d.day), picked)
    if (day) document.querySelector(`[data-day="${dayKey(day)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  const unseenOf = (items: RecordItem[]) => items.filter((it) => it.kind === 'memo' ? hasUnseen(byMemo?.get(it.memo.id), patientUid) : !it.photo.seenAtMs).length
  const firstUnseen = (key: string) => document.querySelector(`[data-day="${key}"] [data-unseen], [data-day="${key}"] .elder-received .elder-tile-new`)?.closest('button')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  return (
    <>
      <section className={`page elder-records${bigText ? ' big' : ''}`} aria-label="내 사진">
        {days.length === 0 ? (
          <div className="elder-records-empty" role="status">아직 사진이 없어요.<br />카메라로 한 장 찍어 보세요.</div>
        ) : days.map((g) => {
          const key = dayKey(g.day)
          const photos = g.items.filter((it) => it.kind === 'memo').length
          const unseen = unseenOf(g.items)
          return (
            <div key={key} data-day={key} className="elder-day">
              <div className="elder-day-row">
                <h2 className="elder-day-head">{dayHeading(g.day)}</h2>
                <span className="elder-day-count">{photos}장</span>
              </div>
              {unseen > 0 && (
                <button type="button" className="elder-day-news" onClick={() => firstUnseen(key)}>새 소식 {unseen} ›</button>
              )}
              {runsOf(g.items).map((run, i) => Array.isArray(run)
                ? (
                  <div key={`g-${i}`} className="elder-grid" role="list">
                    {run.map((it) => it.kind === 'memo' && <ElderRecordTile key={it.memo.id} memo={it.memo} reactions={byMemo?.get(it.memo.id)} patientUid={patientUid} wide={bigText} onOpen={onOpen} />)}
                  </div>
                )
                : run.kind === 'received' && <ElderReceivedCard key={run.photo.id} photo={run.photo} onOpen={onOpenReceived} />)}
            </div>
          )
        })}
      </section>
      <nav className="elder-bar" aria-label="내 사진 메뉴">
        <label className={`elder-bar-btn elder-bar-date${days.length === 0 ? ' is-off' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
            <path d="M3.5 10h17M8 3v4M16 3v4" />
          </svg>
          날짜로 찾기
          {days.length > 0 && <DateJumpInput days={days.map((d) => d.day)} onPick={jump} />}
        </label>
        <button type="button" className="elder-bar-btn elder-bar-camera" onClick={onCamera}>
          <CameraGlyph />
          카메라
        </button>
      </nav>
    </>
  )
}
