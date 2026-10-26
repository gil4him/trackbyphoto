import { useEffect, useMemo } from 'react'
import { dayHeading, fmtTime, landingDay } from '../util'
import { CalendarFab } from '../components/CalendarFab'
import { MemoRow } from '../components/MemoRow'
import { ReceivedRow } from '../components/ReceivedRow'
import { DayCard } from '../components/DayCard'
import { ParentGroupRow, ParentRow, SentDiaryRow } from '../components/DiaryRows'
import { collapseParents, type ParentMemo } from '../lib/diary'
import { useOutbox } from '../hooks/useOutbox'
import { useWorkerStatus } from '../hooks/useWorkerStatus'
import type { OutboxItem } from '../lib/outbox'
import type { ReactionsContext } from '../components/Reactions'
import { clock } from '../lib/memoViews'
import { S } from '../lib/strings'
import type { FamilyPhoto, Memo } from '../types'

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

/** One row of the list: the parent's own photo, or one the family sent. */
type Entry = { kind: 'memo'; at: number; memo: Memo } | { kind: 'received'; at: number; photo: FamilyPhoto } | { kind: 'sent'; at: number; photo: FamilyPhoto; to: string; color: string } | { kind: 'parent'; at: number; item: ParentMemo }

/** A photo this family member sent to one of their parents (SentRow). */
export interface SentEntry { photo: FamilyPhoto; to: string; color: string }

/** A photo still on this phone, waiting to be sent. */
function WaitingPhoto({ item }: { item: OutboxItem }) {
  const url = useMemo(() => URL.createObjectURL(item.blob), [item.blob])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return (
    <div className="memo-row waiting">
      <span className="memo-row-pic"><span className="tl-thumb"><img src={url} alt="" /></span></span>
      <span className="memo-row-body">
        <span className="memo-row-title">보내는 중…</span>
        <span className="memo-row-meta">
          {fmtTime(new Date(item.takenAtMs))} · {item.attempts > 0 ? '인터넷이 약해요. 연결되면 자동으로 보내요.' : '곧 기록돼요.'}
        </span>
        {/* After several failed tries, say why, so it can be reported. */}
        {item.attempts >= 5 && item.lastError && <span className="memo-row-meta">({item.lastError})</span>}
      </span>
    </div>
  )
}

/**
 * `uid` is whose records are shown; photos of theirs still waiting on this
 * phone are listed first. Each photo is one `MemoRow` under its day's header
 * (A13) — the time first on its meta line, then the place and what family
 * left on it; the photo page holds the thread and the ⋯ menu (deleting
 * included). `readOnly` is accepted for the elder's linked phone (nothing to
 * hide here any more).
 */
export function Today({ memos, onOpen, uid, rx, onOpenTrail, onOpenVoiceAlbum, focusDay, onFocused, received = [], onOpenReceived, sent = [], onOpenSent, before, parents = [], onOpenParentMemo, calendar = false }: { memos: Memo[]; onOpen: (id: string) => void; uid?: string; readOnly?: boolean; /** The parent's phone: photos the family sent, listed among the day's own (ReceivedRow). */ received?: FamilyPhoto[]; onOpenReceived?: (id: string) => void; /** A family member's own 사진: the photos they sent their parents (SentRow). */ sent?: SentEntry[]; onOpenSent?: (id: string) => void; /** 과거 (the simple edition's family): only what came before this moment (start of today); today lives on 오늘. */ before?: Date; /** A family member's own 과거: their parents' photos, indented in each parent's colour. */ parents?: ParentMemo[]; onOpenParentMemo?: (memo: Memo) => void; /** A floating calendar to jump to a day (과거, the parent's 내 사진). */ calendar?: boolean; /** Hearts and comments per photo (family feed), for the counts. */ rx?: ReactionsContext; /** 다녀온 곳 for one day (shown on days that have a located photo). */ onOpenTrail?: (day: Date) => void; /** 목소리 앨범, on a plan that includes it (family only). */ onOpenVoiceAlbum?: () => void; /** Open scrolled to this day's photos (어제 보기 on the home), once. */ focusDay?: Date | null; onFocused?: () => void }) {
  // Hide a waiting photo once its memo shows up from the server.
  const memoIds = useMemo(() => new Set(memos.map((m) => m.id)), [memos])
  const outbox = useOutbox(uid).filter((i) => !memoIds.has(i.photoId))
  // Photos still going out are today's: 오늘 shows them, not 과거.
  const waiting = before ? [] : outbox
  // While a memo is waiting, check the memo server is actually up.
  const serverDown = useWorkerStatus(memos.some((m) => m.status === 'pending')) === 'down'

  // Group recent shots by calendar day, newest day first. `memos` already
  // arrives ordered by takenAt desc (useMemos), so iterating in order keeps
  // both the groups and the cards within each group newest-first.
  // Photos the family sent slot into the same days by the time they came.
  const groups = useMemo(() => {
    const entries: Entry[] = [
      ...memos.map((m) => ({ kind: 'memo' as const, at: m.takenAt.toDate().getTime(), memo: m })),
      ...received.filter((f) => f.status === 'ready' && !!f.photoUrl).map((f) => ({ kind: 'received' as const, at: f.createdAtMs, photo: f })),
      ...sent.filter((s) => !!s.photo.photoUrl).map((s) => ({ kind: 'sent' as const, at: s.photo.createdAtMs, ...s })),
      ...parents.map((item) => ({ kind: 'parent' as const, at: item.memo.takenAt.toDate().getTime(), item })),
    ].filter((e) => !before || e.at < before.getTime()).sort((a, b) => b.at - a.at)
    const map = new Map<string, { date: Date; items: Memo[]; entries: Entry[] }>()
    for (const e of entries) {
      const d = new Date(e.at)
      const key = dayKey(d)
      if (!map.has(key)) map.set(key, { date: d, items: [], entries: [] })
      const g = map.get(key)!
      g.entries.push(e)
      if (e.kind === 'memo') g.items.push(e.memo)
    }
    // A past day reads like a diary, morning first; today keeps the newest on top.
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const out = Array.from(map.values())
    for (const g of out) if (g.date.getTime() < todayStart.getTime()) g.entries.reverse()
    return out
  }, [memos, received, sent, before, parents])

  // 어제 보기: land on that day's header, then forget the request.
  useEffect(() => {
    if (!focusDay) return
    const el = document.querySelector(`[data-day="${dayKey(focusDay)}"]`)
    el?.scrollIntoView({ block: 'start' })
    onFocused?.()
  }, [focusDay, onFocused, groups])

  return (
    <section className={`page${calendar ? ' page-past' : ''}`}>
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
          {before ? (
            <>
              <div>아직 지난 사진이 없어요.</div>
              <div style={{ marginTop: 6, fontSize: 14 }}>오늘 찍은 사진은 내일 여기로 와요.</div>
            </>
          ) : (
            <>
              <div>아직 기록이 없어요.</div>
              <div style={{ marginTop: 6, fontSize: 14 }}>홈에서 사진을 한 장 찍어보세요.</div>
            </>
          )}
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.date.toISOString()} data-day={dayKey(g.date)}>
            <div className="tl-day">
              {dayHeading(g.date)}
              {/* 다녀온 곳 is a parent's day out: on a parent's 과거, days with a located photo. */}
              {onOpenTrail && parents.length === 0 && g.items.some((m) => typeof m.lat === 'number' && typeof m.lng === 'number') && (
                <button type="button" className="trail-link" onClick={() => onOpenTrail(g.date)}>다녀온 곳 ›</button>
              )}
            </div>
            <DayCard label={dayHeading(g.date)}>
              {collapseParents(g.entries).map((e) => {
                const time = clock(new Date(e.at))
                if (e.kind === 'received') return <ReceivedRow key={`f-${e.photo.id}`} photo={e.photo} onOpen={(id) => onOpenReceived?.(id)} />
                if (e.kind === 'parent') return <ParentRow key={`p-${e.item.memo.id}`} item={e.item} onOpen={(m) => onOpenParentMemo?.(m)} time={time} />
                if (e.kind === 'parentGroup') return <ParentGroupRow key={`g-${e.items[0].memo.id}`} items={e.items} onOpen={(m) => onOpenParentMemo?.(m)} time={time} timeOf={(m) => clock(m.takenAt.toDate())} />
                if (e.kind === 'sent') return <SentDiaryRow key={`s-${e.photo.id}`} photo={e.photo} to={e.to} color={e.color} onOpen={(id) => onOpenSent?.(id)} time={time} />
                const m = e.memo
                const items = rx?.byMemo.get(m.id)
                // On the parent's own phone: family left something they have not seen yet.
                const fresh = !!rx && !rx.canReact && (items ?? []).some((r) => r.actorUid !== rx.patientUid && r.status === 'ready' && !r.readByElderAt)
                return <MemoRow key={m.id} memo={m} onOpen={onOpen} reactions={items} time={time} fresh={fresh} serverDown={serverDown} />
              })}
            </DayCard>
          </div>
        ))
      )}
      {calendar && (
        <CalendarFab
          days={groups.map((g) => new Date(g.date.getFullYear(), g.date.getMonth(), g.date.getDate()))}
          onPick={(picked) => {
            const day = landingDay(groups.map((g) => new Date(g.date.getFullYear(), g.date.getMonth(), g.date.getDate())), picked)
            if (day) document.querySelector(`[data-day="${dayKey(day)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
          }}
        />
      )}
    </section>
  )
}
