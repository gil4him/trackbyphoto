import { useEffect, useRef } from 'react'
import { useToast } from '../components/Toast'
import { warmUpLocation } from '../lib/location'
import { useOutbox } from '../hooks/useOutbox'
import { useCapture } from '../hooks/useCapture'
import { fmtDate, fmtTime } from '../util'
import { MemoThumb } from '../components/MemoThumb'
import { useWorkerStatus } from '../hooks/useWorkerStatus'
import { cardMeta, cardTitle, clock, dayCaption, dayEyebrow, farthestKm, memosOnDay } from '../lib/memoViews'
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
function Notices({ notifications, onDismiss }: { notifications: AppNotification[]; onDismiss?: (id: string) => void }) {
  if (notifications.length === 0) return null
  return (
    <div className="notice-stack" role="status" aria-label="가족 활동 알림">
      {notifications.map((n) => (
        <div key={n.id} className="notice">
          <span className="notice-msg">{n.message}</span>
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
 * card opens the photo page. The child's own camera is the floating button.
 */
export function ParentDayHome({ parentName, memos, byMemo, home, onOpen, onYesterday, onOpenTrail, onSendPhoto, notifications = [], onDismissNotification, topCard, sentPhotos, now = new Date() }: {
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
  /** 사진 보내기: send this parent a photo (when the parent receives them and
   *  this family member may send). Inline here — the floating camera never
   *  sits over a parent's view (A2). */
  onSendPhoto?: () => void
  notifications?: AppNotification[]
  onDismissNotification?: (id: string) => void
  /** A one-off card above the header (family's 알림 켜기). */
  topCard?: React.ReactNode
  /** What the family sent this parent, with the answers (kept under the day). */
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
  return (
    <section className="page home-day" aria-label={`${parentName}님의 하루`}>
      <Notices notifications={notifications} onDismiss={onDismissNotification} />
      {topCard}
      <header className="day-head">
        <div className="h-eyebrow">{dayEyebrow(now)}</div>
        <h1 className="day-title">{parentName}의 하루</h1>
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

      {onSendPhoto && (
        <button type="button" className="day-send" onClick={onSendPhoto} aria-label="사진 보내기">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2l.9-1.4A1.5 1.5 0 0 1 8.9 4h6.2a1.5 1.5 0 0 1 1.3.6L17.3 6h1.2A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
            <circle cx="12" cy="12.3" r="3.4" />
          </svg>
          {parentName}님께 사진 보내기
        </button>
      )}
      {sentPhotos}
    </section>
  )
}

export function Home({ uid, patientName, greetingName, memos, onOpenAsk, onOpen, canCapture = true, notifications = [], onDismissNotification, recordsLabel, newsCard, topCard, canSendPhoto = false, sentPhotos, connectOnly = false, simple = false }: { /** The parent's 가족 소식 card, shown under the buttons. */ newsCard?: React.ReactNode; /** A one-off card above the greeting (family's 알림 켜기). */ topCard?: React.ReactNode; /** Family on a parent's home: the floating camera button sends the parent a photo. */ canSendPhoto?: boolean; /** Family: what has been sent, with the parent's answers. */ sentPhotos?: React.ReactNode; /** Simple edition, no parent yet: only `topCard` (엄마 연결하기), centred. */ connectOnly?: boolean; /** Simple edition: no 사진 찍기 / 지난 기록 buttons — the camera is the floating button and there is no Ask page (A2). */ simple?: boolean; recordsLabel?: boolean; uid: string; patientName: string; greetingName: string; memos: Memo[]; onOpenAsk: () => void; onOpen: (id: string) => void; canCapture?: boolean; notifications?: AppNotification[]; onDismissNotification?: (id: string) => void }) {
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

  const today = new Date()

  if (connectOnly) {
    return (
      <section className="page home connect-only" aria-label={`${patientName}님의 홈`}>
        <Notices notifications={notifications} onDismiss={onDismissNotification} />
        {topCard}
      </section>
    )
  }

  return (
    <section className="page home" aria-label={`${patientName}님의 홈`}>
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
            <b>{patientName}님의 기록을 보고 있어요.</b>
            <span>{canSendPhoto ? `아래 카메라 버튼으로 ${patientName}님께 사진을 보내 드릴 수 있어요.` : '사진 찍기는 본인 계정에서만 가능해요.'}</span>
          </div>
        )}
        {/* Take-photo and Ask sit side by side as equal tiles. In caregiver
            mode (no capture) the Ask tile stretches to fill the row alone.
            The simple edition has neither (floating camera, no Ask page). */}
        {!simple && <div className={canCapture ? 'capgrid' : 'capgrid single'}>
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
        </div>}

        {newsCard}
        {sentPhotos}

        {waiting.length > 0 && (
          <div className={`outbox-note ${struggling ? 'weak' : ''}`} role="status">
            {struggling
              ? <>인터넷이 약해요. 사진 {waiting.length}장은 휴대폰에 안전하게 보관했어요.<br />연결되면 자동으로 보내요.</>
              : <>사진 {waiting.length}장을 보내는 중이에요…</>}
          </div>
        )}

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
