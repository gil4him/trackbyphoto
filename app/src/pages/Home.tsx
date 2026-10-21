import { useEffect, useRef } from 'react'
import { useToast } from '../components/Toast'
import { warmUpLocation } from '../lib/location'
import { useOutbox } from '../hooks/useOutbox'
import { useCapture } from '../hooks/useCapture'
import { fmtDate, fmtTime } from '../util'
import { MemoThumb } from '../components/MemoThumb'
import { PatientCard } from '../components/PatientCard'
import { latestActivity, type ParentSummary } from '../lib/dashboard'
import { useWorkerStatus } from '../hooks/useWorkerStatus'
import { cardMeta, cardTitle, clock, dayCaption, dayEyebrow, farthestKm, memosOnDay } from '../lib/memoViews'
import { addressed, honorific } from '../lib/people'
import { trailStops, trailSummary, type LatLng } from '../lib/trail'
import { placesVisited } from '../lib/digest'
import { TrailSketch } from '../components/TrailSketch'
import type { Memo, AppNotification, Reaction } from '../types'

/**
 * The prototype's home is a single-purpose screen: a giant circular capture
 * button + a date eyebrow + a secondary "지난 기록 물어보기" pill that jumps
 * to the Ask tab. Recent thumbnails moved to the 오늘 tab.
 *
 * We still subscribe to the memos snapshot so we can toast when the most
 * recent upload finishes processing (caregiver sees the result without
 * having to leave the home screen).
 */
function Notices({ notifications, onDismiss, parentName }: { notifications: AppNotification[]; onDismiss?: (id: string) => void; parentName?: string }) {
  if (notifications.length === 0) return null
  return (
    <div className="notice-stack" role="status" aria-label="가족 활동 알림">
      {notifications.map((n) => (
        <div key={n.id} className="notice">
          <span className="notice-msg">{parentName ? addressed(n.message, parentName) : n.message}</span>
          {onDismiss && (
            <button className="notice-x" aria-label="알림 지우기" onClick={() => onDismiss(n.id)}>✕</button>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Simple edition, looking at a parent: the parent's day as a timeline
 * (docs/DAYLIE_V3_UI_FIX.md A1, option C). Newest photo at the top; each
 * card opens the photo page. No action buttons on this page (A10): hearts
 * and words are given on each photo, and 사진 보내기 is the link on the
 * 보낸 사진 header at the end (`sentPhotos`).
 */
export function ParentDayHome({ parentName, memos, byMemo, home, onOpen, onYesterday, onOpenTrail, notifications = [], onDismissNotification, topCard, sentPhotos, now = new Date() }: {
  parentName: string
  memos: Memo[]
  /** Hearts and words per memo (the reactions feed), when rolled out. */
  byMemo?: Map<string, Reaction[]>
  /** The parent's home, for 집에서 최대 N km; null when unknown. */
  home: LatLng | null
  onOpen: (id: string) => void
  /** 어제 보기 ›: the 사진 tab scrolled to yesterday. */
  onYesterday: () => void
  /** 다녀온 곳 for today — the trail map (App passes it only while the trail
   *  map is rolled out). The card shows once a photo today has a location. */
  onOpenTrail?: (day: Date) => void
  notifications?: AppNotification[]
  onDismissNotification?: (id: string) => void
  /** A one-off card above the header (family's 알림 켜기). */
  topCard?: React.ReactNode
  /** 보낸 사진 with its header row (SentFamilyPhotos, headed), kept under the day. */
  sentPhotos?: React.ReactNode
  /** Injected in tests. */
  now?: Date
}) {
  const todays = memosOnDay(memos, now)
  const serverDown = useWorkerStatus(todays.some((m) => m.status === 'pending')) === 'down'
  // Where the day went: the stops in the order they were visited, drawn small.
  const stops = onOpenTrail ? trailStops(todays, home) : []
  const summary = trailSummary(stops)
  const places = placesVisited(stops.flatMap((s) => s.memos)).join(' → ')
  const trailSub = places || summary.text
  const who = honorific(parentName)
  return (
    <section className="page home-day" aria-label={`${who}의 하루`}>
      <Notices notifications={notifications} onDismiss={onDismissNotification} parentName={parentName} />
      {topCard}
      <header className="day-head">
        <div className="h-eyebrow">{dayEyebrow(now)}</div>
        <h1 className="day-title">{who}의 하루</h1>
        <div className="day-caption">{dayCaption(todays.length, farthestKm(todays, home))}</div>
      </header>

      {stops.length > 0 && (
        <button type="button" className="day-trail" onClick={() => onOpenTrail?.(now)}>
          <span className="day-trail-map" aria-hidden="true"><TrailSketch stops={stops} /></span>
          <span className="day-trail-body">
            <span className="day-trail-title">다녀온 곳 {stops.length}곳</span>
            {(summary.away || trailSub) && (
              <span className="day-trail-sub">
                {summary.away && <span className="trail-badge">여행 중</span>}
                {trailSub}
              </span>
            )}
          </span>
          <span className="day-trail-chev" aria-hidden="true">›</span>
        </button>
      )}

      {todays.length === 0 ? (
        <div className="day-empty" role="status">오늘 아직 사진이 없어요</div>
      ) : (
        <ol className="day-tl" aria-label="오늘의 사진">
          {todays.map((m) => (
            <li key={m.id} className="day-item">
              <div className="day-rail">
                <span className="day-time">{clock(m.takenAt.toDate())}</span>
                <span className="day-dot" aria-hidden="true" />
              </div>
              <button type="button" className="day-card" onClick={() => onOpen(m.id)} aria-label="자세히 보기">
                <MemoThumb memo={m} />
                <div className="day-card-body">
                  <div className="day-card-title">{cardTitle(m, serverDown)}</div>
                  <div className="day-card-meta">{cardMeta(m, byMemo?.get(m.id))}</div>
                </div>
              </button>
            </li>
          ))}
        </ol>
      )}

      <button type="button" className="day-more" onClick={onYesterday}>어제 보기 ›</button>

      {sentPhotos}
    </section>
  )
}

export function Home({ uid, patientName, greetingName, memos, onOpenAsk, onOpen, canCapture = true, notifications = [], onDismissNotification, recordsLabel, newsCard, topCard, canSendPhoto = false, sentPhotos, connectOnly = false, simple = false, parents = [], onOpenParent, now }: { /** The parent's 가족 소식 card, shown under the buttons. */ newsCard?: React.ReactNode; /** A one-off card above the greeting (family's 알림 켜기). */ topCard?: React.ReactNode; /** Family on a parent's home: the floating camera button sends the parent a photo. */ canSendPhoto?: boolean; /** Family: what has been sent, with the parent's answers. */ sentPhotos?: React.ReactNode; /** Simple edition, no parent yet: only `topCard` (엄마 연결하기), centred. */ connectOnly?: boolean; /** Simple edition: the family dashboard (A10) — one card per parent and one's own photos today; no 사진 찍기 / 지난 기록 buttons and no notice banner (the cards carry 새 소식). */ simple?: boolean; /** Simple edition: the connected parents, for the cards. */ parents?: ParentSummary[]; /** A card tapped: that parent's day. */ onOpenParent?: (uid: string) => void; /** Injected in tests. */ now?: Date; recordsLabel?: boolean; uid: string; patientName: string; greetingName: string; memos: Memo[]; onOpenAsk: () => void; onOpen: (id: string) => void; canCapture?: boolean; notifications?: AppNotification[]; onDismissNotification?: (id: string) => void }) {
  const toast = useToast()
  const capture = useCapture(uid)
  const lastReadyId = useRef<string | null>(null)

  useEffect(() => {
    const newestReady = memos.find((m) => m.status === 'ready')
    if (newestReady && lastReadyId.current === null) {
      lastReadyId.current = newestReady.id
      return
    }
    if (newestReady && newestReady.id !== lastReadyId.current) {
      lastReadyId.current = newestReady.id
      toast.show(
        `${fmtTime(newestReady.takenAt.toDate())} · ${newestReady.memo}`,
        `${newestReady.place} — 저장되었어요`,
      )
    }
  }, [memos, toast])

  // Start finding the phone's location while the screen is open, so it is
  // ready by the time a photo is taken.
  useEffect(() => { if (canCapture) warmUpLocation() }, [canCapture])

  // Photos still on the phone, waiting to be sent.
  const waiting = useOutbox(canCapture ? uid : undefined)
  const struggling = waiting.some((i) => i.attempts > 0)

  const today = now ?? new Date()
  const who = honorific(patientName)

  if (connectOnly) {
    return (
      <section className="page home connect-only" aria-label={`${who}의 홈`}>
        {!simple && <Notices notifications={notifications} onDismiss={onDismissNotification} />}
        {topCard}
      </section>
    )
  }

  const outbox = waiting.length > 0 && (
    <div className={`outbox-note ${struggling ? 'weak' : ''}`} role="status">
      {struggling
        ? <>인터넷이 약해요. 사진 {waiting.length}장은 휴대폰에 안전하게 보관했어요.<br />연결되면 자동으로 보내요.</>
        : <>사진 {waiting.length}장을 보내는 중이에요…</>}
    </div>
  )

  if (simple) {
    // The family dashboard (A10): the parents' cards, newest activity first,
    // then one's own photos today with the dashed + for the camera.
    const cards = [...parents].sort((a, b) => latestActivity(b) - latestActivity(a))
    const mine = memosOnDay(memos, today)
    return (
      <section className="page home dash" aria-label={`${who}의 홈`}>
        {topCard}

        <div className="home-hi">
          <div className="d">{fmtDate(today)}</div>
          <div className="t">{greetingName}님, 안녕하세요</div>
        </div>

        {cards.length > 0 && (
          <div className="pc-list">
            {cards.map((p) => <PatientCard key={p.uid} parent={p} now={today} onOpen={() => onOpenParent?.(p.uid)} />)}
          </div>
        )}

        <div className="mine">
          <div className="h-eyebrow">내 오늘 · 사진 {mine.length}장</div>
          <div className="mine-strip" aria-label="내 오늘 사진">
            {mine.map((m) => (
              <button type="button" key={m.id} className="mine-thumb" onClick={() => onOpen(m.id)} aria-label="자세히 보기">
                <MemoThumb memo={m} />
              </button>
            ))}
            <button type="button" className="mine-add" aria-label="사진 찍기" disabled={capture.busy} onClick={capture.takePhoto}>+</button>
            {mine.length === 0 && <span className="mine-hint">카메라 버튼으로 남겨요</span>}
          </div>
          {outbox}
        </div>

        {capture.inputEl}
        {capture.processing}
      </section>
    )
  }

  return (
    <section className="page home" aria-label={`${who}의 홈`}>
      <Notices notifications={notifications} onDismiss={onDismissNotification} />

      {topCard}

      <div className="home-hi">
        <div className="d">{fmtDate(today)}</div>
        <div className="t">{greetingName}님, 안녕하세요</div>
        <div className="sub">오늘 하루를 기록해요</div>
      </div>

      <div className="capwrap">
        {/* Caregiver mode: replace the capture button with a friendly notice.
            Cloud storage rules would block a caregiver upload anyway (path
            scoped to the uploader's own uid), so the button has no useful
            action when the active patient isn't the signed-in user. */}
        {!canCapture && (
          <div className="caregiver-note" role="status">
            <b>{who}의 기록을 보고 있어요.</b>
            <span>{canSendPhoto ? `아래 카메라 버튼으로 ${who}께 사진을 보내 드릴 수 있어요.` : '사진 찍기는 본인 계정에서만 가능해요.'}</span>
          </div>
        )}
        {/* Take-photo and Ask sit side by side as equal tiles. In caregiver
            mode (no capture) the Ask tile stretches to fill the row alone. */}
        <div className={canCapture ? 'capgrid' : 'capgrid single'}>
          {canCapture && (
            <button
              className="capbtn"
              aria-label="사진 찍기"
              disabled={capture.busy}
              onClick={capture.takePhoto}
            >
              <svg className="cam" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2l.9-1.4A1.5 1.5 0 0 1 8.9 4h6.2a1.5 1.5 0 0 1 1.3.6L17.3 6h1.2A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
                <circle cx="12" cy="12.3" r="3.4" />
              </svg>
              <span className="lab">사진 찍기</span>
            </button>
          )}

          <button className="askbtn" onClick={onOpenAsk} aria-label={recordsLabel ? '지난 기록 보기' : '지난 기록 물어보기'}>
            <svg className="ask-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20.5 20.5l-3.6-3.6" />
            </svg>
            <span className="lab">{recordsLabel ? '지난 기록 보기' : '지난 기록 물어보기'}</span>
          </button>
        </div>

        {newsCard}
        {sentPhotos}

        {outbox}

        {capture.inputEl}
      </div>

      {memos.length > 0 && (
        <div className="recent-strip" aria-label="최근 사진">
          {memos.slice(0, 10).map((m) => (
            <button
              type="button"
              key={m.id}
              className="recent-thumb"
              onClick={() => onOpen(m.id)}
              aria-label="자세히 보기"
            >
              <MemoThumb memo={m} showLocation />
            </button>
          ))}
        </div>
      )}

      {capture.processing}
    </section>
  )
}
