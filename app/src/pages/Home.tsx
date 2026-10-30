import { useEffect, useRef, useState } from 'react'
import { useToast } from '../components/Toast'
import { warmUpLocation } from '../lib/location'
import { useOutbox } from '../hooks/useOutbox'
import { useCapture } from '../hooks/useCapture'
import { fmtDate, fmtTime } from '../util'
import { MemoThumb } from '../components/MemoThumb'
import { MemoRow } from '../components/MemoRow'
import { DayCard } from '../components/DayCard'
import { PlaceGroupRow } from '../components/DiaryRows'
import { PatientCard } from '../components/PatientCard'
import { latestActivity, type ParentSummary } from '../lib/dashboard'
import { useWorkerStatus } from '../hooks/useWorkerStatus'
import { clock, dayCaption, dayEyebrow, farthestKm, memosOnDay } from '../lib/memoViews'
import { honorific } from '../lib/people'
import { NoticeCard } from '../components/NoticeCard'
import { tr } from '../lib/lang'
import { AWAY_KM, placeVisits, samePlaceRuns, trailStops, trailSummary, type LatLng, type TrailStop } from '../lib/trail'
import { MAP_KEYS, KAKAO_IN_FRAME, pickProvider, type MapKeys } from '../lib/map'
import { staticMapUrl } from '../lib/map/googleStatic'
import { renderKakaoMap } from '../lib/map/kakao'
import { KakaoFrame } from '../components/KakaoFrame'
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
/**
 * 다녀온 곳 on the parent's day (A13): the route drawn small under the
 * caption, 150px tall, with one pill that opens the full page — the whole
 * box is the button. The keyless sketch shows at once; the map (Kakao in
 * Korea, a Google picture elsewhere) is drawn over it only once the box has
 * scrolled on screen, so the home never asks for map tiles by itself. When
 * the map can't load, the sketch simply stays.
 */
function DayMap({ stops, home, away, onOpen, keys }: { stops: TrailStop[]; home: LatLng | null; away: boolean; onOpen: () => void; keys: MapKeys }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  // Without IntersectionObserver (an old WebView) the map may load at once.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  // A Kakao map that fails to load gives way to the Google picture; a Google
  // picture that fails leaves the sketch.
  const [kakaoFailed, setKakaoFailed] = useState(false)
  const [failed, setFailed] = useState(false)
  const provider = pickProvider(stops, keys, !kakaoFailed)
  const kakao = seen && !failed && provider === 'kakao' && !!keys.kakao
  const picture = seen && !failed && provider === 'googleStatic' && !!keys.google

  useEffect(() => {
    const el = boxRef.current
    if (!el || seen) return
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect() } }, { rootMargin: '80px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])

  useEffect(() => {
    if (!kakao || KAKAO_IN_FRAME || !mapRef.current) return
    let live = true
    renderKakaoMap(
      mapRef.current,
      keys.kakao!,
      placeVisits(stops).map((p) => ({ lat: p.lat, lng: p.lng, label: p.label })),
      home,
      { pad: 28 },
    ).catch((err) => {
      console.warn('[home] kakao map unavailable; trying the Google picture', err)
      if (live) setKakaoFailed(true)
    })
    return () => { live = false }
    // The map is drawn once per set of stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kakao, stops])

  return (
    <div ref={boxRef} className="day-map">
      <TrailSketch stops={stops} home={home} wide />
      {kakao && (KAKAO_IN_FRAME
        ? <KakaoFrame className="day-map-kakao" map={{ key: keys.kakao!, pins: placeVisits(stops).map((p) => ({ lat: p.lat, lng: p.lng, label: p.label })), home, pad: 28 }} onFail={() => setKakaoFailed(true)} />
        : <div ref={mapRef} className="day-map-kakao" aria-hidden="true" />)}
      {picture && <img className="day-map-static" src={staticMapUrl(stops, keys.google!, { width: 640, height: 300 }, true, placeVisits(stops))} alt="" onError={() => setFailed(true)} />}
      <button type="button" className="day-map-open" onClick={onOpen} aria-label={tr(`다녀온 곳 ${placeVisits(stops).length}곳 보기`, `See ${placeVisits(stops).length} place${placeVisits(stops).length === 1 ? '' : 's'} visited`)}>
        <span className="day-map-pill">
          {away && <span className="trail-badge">{tr('여행 중', 'On a trip')}</span>}
          {tr('다녀온 곳', 'Places visited')} {placeVisits(stops).length} ›
        </span>
      </button>
    </div>
  )
}

/**
 * Simple edition, looking at a parent: the parent's day as a timeline
 * (docs/DAYLIE_V3_UI_FIX.md A1, option C). Newest photo at the top; each
 * row opens the photo page. No action buttons on this page (A10): hearts
 * and words are given on each photo, and 사진 보내기 is the link on the
 * 보낸 사진 header at the end (`sentPhotos`).
 */
export function ParentDayHome({ parentName, memos, byMemo, home, onOpen, onYesterday, onOpenTrail, notifications = [], onDismissNotification, onOpenNotification, monthLine, topCard, sentPhotos, now = new Date(), keys = MAP_KEYS }: {
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
  onOpenNotification?: (n: AppNotification) => void
  /** "이번 달 12일째 기록 중" (hooks/useMonthDays.ts). */
  monthLine?: string | null
  /** A one-off card above the header (family's 알림 켜기). */
  topCard?: React.ReactNode
  /** 보낸 사진 with its header row (SentFamilyPhotos, headed), kept under the day. */
  sentPhotos?: React.ReactNode
  /** Injected in tests. */
  now?: Date
  /** Map keys (none in tests: the sketch). */
  keys?: MapKeys
}) {
  const todays = memosOnDay(memos, now)
  const serverDown = useWorkerStatus(todays.some((m) => m.status === 'pending')) === 'down'
  // Where the day went: the stops in the order they were visited, drawn small.
  const stops = onOpenTrail ? trailStops(todays, home) : []
  const summary = trailSummary(stops)
  // Home belongs in the picture on a day out, not on a trip far away.
  const nearHome = home && !summary.away && summary.maxKm !== null && summary.maxKm < AWAY_KM ? home : null
  const who = honorific(parentName)
  return (
    <section className="page home-day" aria-label={tr(`${who}의 하루`, `${who}'s day`)}>
      <NoticeCard notifications={notifications} onDismiss={onDismissNotification} onOpen={onOpenNotification} parentName={parentName} />
      {topCard}
      <header className="day-head">
        <div className="h-eyebrow">{dayEyebrow(now)}</div>
        <h1 className="day-title">{tr(`${who}의 하루`, `${who}'s day`)}</h1>
        <div className="day-caption">{dayCaption(todays.length, farthestKm(todays, home), placeVisits(stops).length)}</div>
        {monthLine && <div className="day-month">{monthLine}</div>}
      </header>

      {stops.length > 0 && <DayMap stops={stops} home={nearHome} away={summary.away} onOpen={() => onOpenTrail?.(now)} keys={keys} />}

      {todays.length === 0 ? (
        <div className="day-empty" role="status">{tr('오늘 아직 사진이 없어요', 'No photos today yet')}</div>
      ) : (
        <DayCard label={tr('오늘의 사진', "Today's photos")}>
          {/* Newest at the top, no numbers (only 다녀온 곳 numbers); photos in a
              row at one place fold into one line (A14.5). */}
          {samePlaceRuns(todays).map((run) => run.length > 1
            ? <PlaceGroupRow key={`g-${run[0].id}`} memos={run} time={clock(run[0].takenAt.toDate())} renderRow={(m) => <MemoRow key={m.id} memo={m} onOpen={onOpen} reactions={byMemo?.get(m.id)} time={clock(m.takenAt.toDate())} serverDown={serverDown} />} />
            : <MemoRow key={run[0].id} memo={run[0]} onOpen={onOpen} reactions={byMemo?.get(run[0].id)} time={clock(run[0].takenAt.toDate())} serverDown={serverDown} />)}
        </DayCard>
      )}

      <button type="button" className="day-more" onClick={onYesterday}>{tr('어제 보기 ›', 'See yesterday ›')}</button>

      {sentPhotos}
    </section>
  )
}

export function Home({ uid, patientName, greetingName, memos, onOpenAsk, onOpen, canCapture = true, notifications = [], onDismissNotification, onOpenNotification, recordsLabel, newsCard, topCard, canSendPhoto = false, sentPhotos, connectOnly = false, simple = false, parents = [], onOpenParent, now }: { /** The parent's 가족 소식 card, shown under the buttons. */ newsCard?: React.ReactNode; /** A one-off card above the greeting (family's 알림 켜기). */ topCard?: React.ReactNode; /** Family on a parent's home: the floating camera button sends the parent a photo. */ canSendPhoto?: boolean; /** Family: what has been sent, with the parent's answers. */ sentPhotos?: React.ReactNode; /** Simple edition, no parent yet: only `topCard` (엄마 연결하기), centred. */ connectOnly?: boolean; /** Simple edition: the family dashboard (A10) — one card per parent and one's own photos today; no 사진 찍기 / 지난 기록 buttons and no notice banner (the cards carry 새 소식). */ simple?: boolean; /** Simple edition: the connected parents, for the cards. */ parents?: ParentSummary[]; /** A card tapped: that parent's day. */ onOpenParent?: (uid: string) => void; /** Injected in tests. */ now?: Date; recordsLabel?: boolean; uid: string; patientName: string; greetingName: string; memos: Memo[]; onOpenAsk: () => void; onOpen: (id: string) => void; canCapture?: boolean; notifications?: AppNotification[]; onOpenNotification?: (n: AppNotification) => void; onDismissNotification?: (id: string) => void }) {
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
        tr(`${newestReady.place} — 저장되었어요`, `${newestReady.place} — saved`),
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
      <section className="page home connect-only" aria-label={tr(`${who}의 홈`, `${who}'s home`)}>
        {!simple && <NoticeCard notifications={notifications} onDismiss={onDismissNotification} onOpen={onOpenNotification} />}
        {topCard}
      </section>
    )
  }

  const outbox = waiting.length > 0 && (
    <div className={`outbox-note ${struggling ? 'weak' : ''}`} role="status">
      {struggling
        ? <>{tr(`인터넷이 약해요. 사진 ${waiting.length}장은 휴대폰에 안전하게 보관했어요.`, `Your connection is weak. We kept ${waiting.length} photo${waiting.length === 1 ? '' : 's'} safe on your phone.`)}<br />{tr('연결되면 자동으로 보내요.', "We'll send them once you're back online.")}</>
        : <>{tr(`사진 ${waiting.length}장을 보내는 중이에요…`, `Sending ${waiting.length} photo${waiting.length === 1 ? '' : 's'}…`)}</>}
    </div>
  )

  if (simple) {
    // The family dashboard (A10): the parents' cards, newest activity first,
    // then one's own photos today with the dashed + for the camera.
    const cards = [...parents].sort((a, b) => latestActivity(b) - latestActivity(a))
    return (
      <section className="page home dash" aria-label={tr(`${who}의 홈`, `${who}'s home`)}>
        {topCard}

        <div className="home-hi">
          <div className="d">{fmtDate(today)}</div>
          <div className="t">{tr(`${greetingName}님, 안녕하세요`, `Hello, ${greetingName}`)}</div>
        </div>

        {cards.length > 0 && (
          <div className="pc-list">
            {cards.map((p) => <PatientCard key={p.uid} parent={p} now={today} onOpen={() => onOpenParent?.(p.uid)} />)}
          </div>
        )}

        {outbox}

        {capture.inputEl}
        {capture.processing}
      </section>
    )
  }

  return (
    <section className="page home" aria-label={tr(`${who}의 홈`, `${who}'s home`)}>
      <NoticeCard notifications={notifications} onDismiss={onDismissNotification} onOpen={onOpenNotification} />

      {topCard}

      <div className="home-hi">
        <div className="d">{fmtDate(today)}</div>
        <div className="t">{tr(`${greetingName}님, 안녕하세요`, `Hello, ${greetingName}`)}</div>
        <div className="sub">{tr('오늘 하루를 기록해요', "Let's keep today")}</div>
      </div>

      <div className="capwrap">
        {/* Caregiver mode: replace the capture button with a friendly notice.
            Cloud storage rules would block a caregiver upload anyway (path
            scoped to the uploader's own uid), so the button has no useful
            action when the active patient isn't the signed-in user. */}
        {!canCapture && (
          <div className="caregiver-note" role="status">
            <b>{tr(`${who}의 기록을 보고 있어요.`, `You're looking at ${who}'s photos.`)}</b>
            <span>{canSendPhoto ? tr(`아래 카메라 버튼으로 ${who}께 사진을 보내 드릴 수 있어요.`, `You can send ${who} a photo with the camera button below.`) : tr('사진 찍기는 본인 계정에서만 가능해요.', 'You can only take photos from your own account.')}</span>
          </div>
        )}
        {/* Take-photo and Ask sit side by side as equal tiles. In caregiver
            mode (no capture) the Ask tile stretches to fill the row alone. */}
        <div className={canCapture ? 'capgrid' : 'capgrid single'}>
          {canCapture && (
            <button
              className="capbtn"
              aria-label={tr('사진 찍기', 'Take a photo')}
              disabled={capture.busy}
              onClick={capture.takePhoto}
            >
              <svg className="cam" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2l.9-1.4A1.5 1.5 0 0 1 8.9 4h6.2a1.5 1.5 0 0 1 1.3.6L17.3 6h1.2A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
                <circle cx="12" cy="12.3" r="3.4" />
              </svg>
              <span className="lab">{tr('사진 찍기', 'Take a photo')}</span>
            </button>
          )}

          <button className="askbtn" onClick={onOpenAsk} aria-label={recordsLabel ? tr('지난 기록 보기', 'See past photos') : tr('지난 기록 물어보기', 'Ask about past photos')}>
            <svg className="ask-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20.5 20.5l-3.6-3.6" />
            </svg>
            <span className="lab">{recordsLabel ? tr('지난 기록 보기', 'See past photos') : tr('지난 기록 물어보기', 'Ask about past photos')}</span>
          </button>
        </div>

        {newsCard}
        {sentPhotos}

        {outbox}

        {capture.inputEl}
      </div>

      {memos.length > 0 && (
        <div className="recent-strip" aria-label={tr('최근 사진', 'Recent photos')}>
          {memos.slice(0, 10).map((m) => (
            <button
              type="button"
              key={m.id}
              className="recent-thumb"
              onClick={() => onOpen(m.id)}
              aria-label={tr('자세히 보기', 'See details')}
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
