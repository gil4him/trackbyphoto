import { MemoThumb } from './MemoThumb'
import { DateJumpInput } from './CalendarFab'
import { CameraGlyph } from './CameraFab'
import { listPhoto } from '../lib/listPhoto'
import { placeName } from '../lib/memoViews'
import { subject } from '../lib/strings'
import { hasUnseen, reactionSentence, receivedLine, recordDays, recordLine } from '../lib/elderRecords'
import { dayHeading, landingDay } from '../util'
import type { FamilyPhoto, Memo, Reaction } from '../types'

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

/**
 * One of the parent's photos on their 내 사진 (A14.7): the photo across the
 * card at 3:2, one line `오전 8:55 · 석촌호수`, and what the family did as a
 * sentence (`새 소식` first while unread). The card opens the photo.
 */
export function ElderRecordCard({ memo, reactions, patientUid, onOpen }: { memo: Memo; reactions?: Reaction[]; patientUid: string; onOpen: (id: string) => void }) {
  const sentence = reactionSentence(reactions, patientUid)
  const unseen = hasUnseen(reactions, patientUid)
  return (
    <button type="button" className="elder-card" onClick={() => onOpen(memo.id)} aria-label={`${recordLine(memo, placeName(memo.place))} 사진 보기`}>
      <span className="elder-card-photo"><MemoThumb memo={memo} /></span>
      <span className="elder-card-line">{recordLine(memo, placeName(memo.place))}</span>
      {sentence && (
        <span className="elder-card-news">
          {unseen && <span className="elder-new-pill">새 소식</span>}
          {sentence}
        </span>
      )}
    </button>
  )
}

/** A photo the family sent: indented, tinted, edged in the accent, who sent it and what the parent answered. */
export function ElderReceivedCard({ photo, onOpen }: { photo: FamilyPhoto; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="elder-card elder-card-received" onClick={() => onOpen(photo.id)} aria-label={`${subject(photo.senderName)} 보낸 사진 보기`}>
      <span className="elder-card-photo"><span className="tl-thumb">{photo.photoUrl && <img src={listPhoto(photo)} alt="" loading="lazy" />}</span></span>
      <span className="elder-card-title">
        {!photo.seenAtMs && <span className="elder-new-pill">새 소식</span>}
        {subject(photo.senderName)} 보냈어요
      </span>
      {photo.caption && <span className="elder-card-caption">“{photo.caption}”</span>}
      <span className="elder-card-line">{receivedLine(photo)}</span>
    </button>
  )
}

/**
 * The parent's 내 사진: big cards by day, and a fixed bottom bar with
 * 날짜로 찾기 (the phone's date picker, then that day) and 카메라
 * (OWNER DECISION A14.7: BOTTOM BAR).
 */
export function ElderRecords({ memos, received, byMemo, patientUid, onOpen, onOpenReceived, onCamera }: {
  memos: Memo[]
  received: FamilyPhoto[]
  byMemo?: Map<string, Reaction[]>
  patientUid: string
  onOpen: (id: string) => void
  onOpenReceived: (id: string) => void
  onCamera: () => void
}) {
  const days = recordDays(memos, received)
  const jump = (picked: Date) => {
    const day = landingDay(days.map((d) => d.day), picked)
    if (day) document.querySelector(`[data-day="${dayKey(day)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  return (
    <>
      <section className="page elder-records" aria-label="내 사진">
        {days.length === 0 ? (
          <div className="elder-records-empty" role="status">아직 사진이 없어요.<br />카메라로 한 장 찍어 보세요.</div>
        ) : days.map((g) => (
          <div key={dayKey(g.day)} data-day={dayKey(g.day)} className="elder-day">
            <h2 className="elder-day-head">{dayHeading(g.day)}</h2>
            {g.items.map((it) => it.kind === 'memo'
              ? <ElderRecordCard key={it.memo.id} memo={it.memo} reactions={byMemo?.get(it.memo.id)} patientUid={patientUid} onOpen={onOpen} />
              : <ElderReceivedCard key={it.photo.id} photo={it.photo} onOpen={onOpenReceived} />)}
          </div>
        ))}
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
