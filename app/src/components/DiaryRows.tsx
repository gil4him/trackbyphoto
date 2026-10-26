import { useState, type CSSProperties } from 'react'
import { MemoThumb } from './MemoThumb'
import { listPhoto } from '../lib/listPhoto'
import { sentStatus } from '../lib/familyPhotosModel'
import { placeName } from '../lib/memoViews'
import type { ParentMemo } from '../lib/diary'
import type { FamilyPhoto, Memo } from '../types'

/** The left time column, as on one's own rows. */
function Timed({ time, children }: { time?: string; children: React.ReactNode }) {
  if (time === undefined) return <>{children}</>
  return <div className="day-item"><span className="day-time">{time}</span>{children}</div>
}

/**
 * A parent's photo in one's own diary (A14.3): indented, a 3pt edge in the
 * parent's colour, a 40pt thumbnail and one line — the parent's name in
 * their colour's dark ink, then the place.
 */
export function ParentRow({ item, onOpen, time }: { item: ParentMemo; onOpen: (memo: Memo) => void; time?: string }) {
  return (
    <Timed time={time}>
      <button type="button" className="memo-row diary-row" style={{ '--pc': item.color } as CSSProperties} onClick={() => onOpen(item.memo)} aria-label={`${item.name} 사진 보기`}>
        <span className="diary-thumb"><MemoThumb memo={item.memo} /></span>
        <span className="diary-line"><b className="diary-who">{item.name}</b> {placeName(item.memo.place)}</span>
      </button>
    </Timed>
  )
}

/** A photo one sent a parent: `엄마에게 보냄`, and where it stands at the right end. */
export function SentDiaryRow({ photo, to, color, onOpen, time }: { photo: FamilyPhoto; to: string; color: string; onOpen: (id: string) => void; time?: string }) {
  return (
    <Timed time={time}>
      <button type="button" className="memo-row diary-row" style={{ '--pc': color } as CSSProperties} onClick={() => onOpen(photo.id)} aria-label={`${to}에게 보낸 사진 보기`}>
        <span className="diary-thumb"><span className="tl-thumb">{photo.photoUrl && <img src={listPhoto(photo)} alt="" loading="lazy" />}</span></span>
        <span className="diary-line"><b className="diary-who">{to}</b>에게 보냄</span>
        <span className="diary-status">{sentStatus(photo)}</span>
      </button>
    </Timed>
  )
}

/**
 * A parent's run of photos as one row: `엄마 · 사진 n장`, two or three
 * stacked thumbnails, `펼치기 ›`. Tapping opens the run in place.
 */
export function ParentGroupRow({ items, onOpen, time, timeOf }: { items: ParentMemo[]; onOpen: (memo: Memo) => void; time?: string; timeOf?: (m: Memo) => string }) {
  const [open, setOpen] = useState(false)
  const first = items[0]
  if (open) {
    return <>{items.map((it) => <ParentRow key={it.memo.id} item={it} onOpen={onOpen} time={timeOf?.(it.memo)} />)}</>
  }
  return (
    <Timed time={time}>
      <button type="button" className="memo-row diary-row diary-group" style={{ '--pc': first.color } as CSSProperties} onClick={() => setOpen(true)} aria-expanded="false" aria-label={`${first.name} 사진 ${items.length}장 펼치기`}>
        <span className="diary-stack" aria-hidden="true">
          {items.slice(0, 3).map((it, i) => <span key={it.memo.id} className="diary-stack-thumb" style={{ '--i': i } as CSSProperties}><MemoThumb memo={it.memo} /></span>)}
        </span>
        <span className="diary-line"><b className="diary-who">{first.name}</b> · 사진 {items.length}장</span>
        <span className="diary-status diary-open">펼치기 ›</span>
      </button>
    </Timed>
  )
}

/**
 * Photos in a row at one place on a parent's day (A14.5): `{place} · 사진 n장`
 * with stacked thumbnails; tapping shows each photo in place.
 */
export function PlaceGroupRow({ memos, time, renderRow }: { memos: Memo[]; time?: string; renderRow: (m: Memo) => React.ReactNode }) {
  const [open, setOpen] = useState(false)
  if (open) return <>{memos.map((m) => renderRow(m))}</>
  const place = placeName(memos[0].place) || '같은 곳'
  return (
    <Timed time={time}>
      <button type="button" className="memo-row place-group" onClick={() => setOpen(true)} aria-expanded="false" aria-label={`${place} 사진 ${memos.length}장 펼치기`}>
        <span className="diary-stack place-stack" aria-hidden="true">
          {memos.slice(0, 3).map((m, i) => <span key={m.id} className="diary-stack-thumb" style={{ '--i': i } as CSSProperties}><MemoThumb memo={m} /></span>)}
        </span>
        <span className="memo-row-body">
          <span className="memo-row-title">{place} · 사진 {memos.length}장</span>
        </span>
        <span className="diary-status diary-open">펼치기 ›</span>
      </button>
    </Timed>
  )
}
