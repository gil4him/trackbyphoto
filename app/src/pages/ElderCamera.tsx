import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { App as CapApp } from '@capacitor/app'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { savePhoto } from '../lib/capture'
import { PARENT_CAMERA, captureNativePhoto, photoFromResult } from '../lib/phoneCamera'
import { restoredPhoto, takeAndSend, type Overlay } from '../lib/elderShot'
import { askLocation, warmUpLocation } from '../lib/location'
import { ASK_CAMERA, ASK_LOCATION, ASK_NOTIFY, cameraPermission, locationPermission, notificationPermission } from '../lib/permissions'
import { enableElderPush, refreshElderPush } from '../lib/push'
import { ElderAsk } from '../components/ElderAsk'
import { ElderInstallButton } from '../components/ElderInstallButton'
import { MemoThumb } from '../components/MemoThumb'
import { markRead } from '../lib/reactions'
import { sentToName } from '../lib/people'
import { S } from '../lib/strings'
import { useElderNews, type OpenNews } from '../hooks/useElderNews'
import { useMemberships } from '../hooks/useMemberships'
import type { ElderNews } from '../lib/reactionsModel'
import type { Memo, Reaction } from '../types'
import { tr } from '../lib/lang'
import { useMonthDaysLine } from '../hooks/useMonthDays'

export type { Overlay }

/**
 * The simple edition's parent screen (owner decision, 2026-10-30): one big
 * 사진 찍기 button that opens the phone's own camera — its full quality,
 * zoom, flash and night mode, pixels upright, a copy in Photos — and sends
 * the photo to family on return. Above it floats the newest heart or comment
 * from family until tapped; a small 내 사진 opens today's photos. Nothing
 * else — no settings, prices, limits or warnings.
 * (The in-app viewfinder of simple/Daylie-v3-Simple-Core.md §2 was replaced
 * because its plugin capped quality; see CLAUDE.md "Photo lists".)
 */

const OVERLAY_MS = 1500

/** The plain-sentence screens, in the order the phone's questions come. */
type Ask = 'camera' | 'location' | 'notify'

export function ElderCameraView({ busy, denied = false, overlay, news, photos = null, recent = null, ask = null, askNext, corner = null, onShutter, onDismissNews, onOpenRecords, onRetry, onOpenPhotos = () => {}, onAskNext = () => {}, monthLine = null }: {
  /** "이번 달 12일째 기록 중" (hooks/useMonthDays.ts). */
  monthLine?: string | null
  busy: boolean
  /** The phone refused the camera: say so, with a big retry. */
  denied?: boolean
  /** The parent's newest photo, shown in the 내 사진 circle; null before the first one. */
  recent?: Memo | null
  /** Next to 내 사진: the web's 아이콘 만들기. */
  corner?: ReactNode
  /** "민수가 사진을 보냈어요" while a photo from family is new (lit), the dim
   *  "가족 사진 다시 보기" whenever there are photos at all, else null. */
  photos?: { line: string; lit: boolean } | null
  onOpenPhotos?: () => void
  /** A plain sentence before a permission question (ElderAsk), or null. */
  ask?: string | null
  /** The button under the sentence: 카메라 켜기 for the camera, 다음 otherwise. */
  askNext?: string
  onAskNext?: () => void
  overlay: Overlay | null
  news: ElderNews | null
  onShutter: () => void
  onDismissNews: () => void
  onOpenRecords: () => void
  onRetry: () => void
}) {
  // A new photo from family comes first; a new heart or word next; the
  // quiet 가족 사진 다시 보기 only when there is nothing new to show.
  const item = (!photos || !photos.lit) && news?.state === 'new' ? news.item : null
  const photoBubble = photos && (photos.lit || !item) ? photos : null
  return (
    <div className="elder-launch">
      {!ask && photoBubble && (
        <button type="button" className={`elder-cam-bubble${photoBubble.lit ? '' : ' dim'}`} onClick={onOpenPhotos}>
          <span className="elder-cam-bubble-icon" aria-hidden="true">🖼️</span>
          <span className="elder-cam-bubble-body"><span>{photoBubble.line}</span></span>
        </button>
      )}

      {!ask && item && (
        <button type="button" className="elder-cam-bubble" onClick={onDismissNews}>
          <span className="elder-cam-bubble-icon" aria-hidden="true">{item.kind === 'comment' ? '💬' : '❤️'}</span>
          <span className="elder-cam-bubble-body">
            <span>{item.kind === 'comment' ? S.elderCardComment(item.actorName) : S.elderCardHeart(item.actorName)}</span>
            {item.kind === 'comment' && item.text && <span className="elder-cam-bubble-text">{item.text}</span>}
          </span>
        </button>
      )}

      {ask && <ElderAsk text={ask} next={askNext} onNext={onAskNext} />}

      {!ask && denied && (
        <div className="elder-cam-denied" role="alert">
          <p className="elder-cam-denied-title">{tr('카메라를 사용할 수 없어요', "Can't use the camera")}</p>
          <p className="elder-cam-denied-sub">{tr('설정에서 카메라를 허용해 주세요', 'Please allow the camera in Settings')}</p>
          <button type="button" className="elder-cam-retry" onClick={onRetry}>{tr('다시 시도', 'Try again')}</button>
        </div>
      )}

      {/* The one thing to do: a giant shutter in the middle of the screen. */}
      {!ask && !denied && (
        <button
          type="button"
          className="elder-launch-shutter"
          aria-label={tr('사진 찍기', 'Take a photo')}
          disabled={busy}
          onClick={onShutter}
        >
          <span className="elder-launch-ring" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h2l1.3-2h4.4L15.5 6h2A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" />
              <circle cx="12" cy="12.5" r="3.5" />
            </svg>
          </span>
          <span className="elder-launch-label">{tr('사진 찍기', 'Take a photo')}</span>
        </button>
      )}

      {overlay && (
        <div className={`elder-cam-overlay ${overlay.ok ? 'ok' : 'fail'}`} role="status">
          {/* "지은에게 보냈어요 ♥": the heart in the brand's orange, never on a line of its own. */}
          {overlay.ok && overlay.text.endsWith('♥')
            ? <span>{overlay.text.slice(0, -1).trimEnd()}{' '}<span className="elder-cam-heart" aria-hidden="true">♥</span></span>
            : <span>{overlay.text}</span>}
          {!overlay.ok && <span className="elder-cam-overlay-sub">{overlay.sub}</span>}
        </div>
      )}

      {/* The bottom row: 내 사진 on the left, the web's 아이콘 만들기 on the right. */}
      {!ask && !denied && monthLine && <div className="elder-launch-month">{monthLine}</div>}

      {!ask && <div className="elder-launch-row">
        <button type="button" className="elder-launch-records" onClick={onOpenRecords}>
          <span className="elder-launch-recent" aria-hidden="true">
            {recent
              ? <MemoThumb memo={recent} />
              : (
                <svg className="elder-launch-recent-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="3" />
                  <circle cx="9" cy="10" r="1.6" />
                  <path d="M21 16l-5-5-8 8" />
                </svg>
              )}
          </span>
          <span className="elder-launch-label">{tr('내 사진', 'My photos')}</span>
        </button>
        {corner && <span className="elder-launch-side">{corner}</span>}
      </div>}
    </div>
  )
}

export function ElderCamera({ uid, deviceId, reactions, photos = null, recent = null, onOpenRecords, onOpenPhotos, onOpenNews }: {
  uid: string
  /** The phone's device record; the push token is registered against it. */
  deviceId?: string
  /** The parent's newest photo, for the 내 사진 circle. */
  recent?: Memo | null
  /** This parent's reactions; null while reactions aren't rolled out. */
  reactions: Reaction[] | null
  /** The family-photo bubble (familyPhotosModel cardLine), or null. */
  photos?: { line: string; lit: boolean } | null
  onOpenRecords: () => void
  onOpenPhotos?: () => void
  /** A family member's message was tapped: open 가족 소식 to answer it. */
  onOpenNews?: (news: OpenNews) => void
}) {
  const [busy, setBusy] = useState(false)
  const [denied, setDenied] = useState(false)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  // Hidden as soon as it's tapped, before the read stamps come back.
  const [dismissed, setDismissed] = useState<string[]>([])
  const news = useElderNews(reactions, uid)
  const monthLine = useMonthDaysLine(uid)
  const { caregivers } = useMemberships(uid, { withPatients: false })
  const toName = sentToName(caregivers)
  const alive = useRef(true)
  const busyRef = useRef(false)
  // The plain-sentence screen before the phone's camera / location question.
  const [ask, setAsk_] = useState<Ask | null>(null)
  const asking = useRef<Ask | null>(null)
  const setAsk = useCallback((a: Ask | null) => {
    asking.current = a
    setAsk_(a)
  }, [])
  // The location and notification questions follow the camera's once.
  const chained = useRef(false)

  // After location: family news on the icon. The plain sentence first if the
  // phone hasn't asked; already allowed → just keep the token current.
  const afterLocation = useCallback(() => {
    if (!deviceId) return
    void notificationPermission().then((s) => {
      if (!alive.current) return
      if (s === 'prompt') setAsk('notify')
      else if (s === 'granted') void refreshElderPush(deviceId)
    })
  }, [deviceId, setAsk])

  // Once the camera is allowed: location next — its plain sentence first if
  // the phone hasn't asked yet, else just start locating for the next shot.
  const afterCamera = useCallback(() => {
    if (chained.current) return
    chained.current = true
    void locationPermission().then((s) => {
      if (!alive.current) return
      if (s === 'prompt') setAsk('location')
      else { warmUpLocation(); afterLocation() }
    })
  }, [setAsk, afterLocation])

  /** One shot: the phone's camera (or a photo it handed back later), then the family. */
  const shoot = useCallback(async (take: () => Promise<{ file: File; path?: string }>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {})
    // A fix ready for the photo, when the phone already allows location.
    void locationPermission().then((s) => { if (s === 'granted') warmUpLocation() })
    const result = await takeAndSend({ uid, toName, take, save: savePhoto })
    if (!alive.current) return
    if (result === 'cancelled' || result === 'denied') {
      if (result === 'denied') setDenied(true)
      busyRef.current = false
      setBusy(false)
      afterCamera()
      return
    }
    setDenied(false)
    setOverlay(result)
    setTimeout(() => {
      if (!alive.current) return
      setOverlay(null)
      busyRef.current = false
      setBusy(false)
      afterCamera()
    }, OVERLAY_MS)
  }, [uid, toName, afterCamera])

  useEffect(() => {
    alive.current = true
    // The camera's plain sentence first if the phone hasn't asked yet.
    void cameraPermission().then((s) => {
      if (!alive.current) return
      if (s === 'prompt') setAsk('camera')
      else afterCamera()
    })
    // Android may kill the app behind its camera; the photo comes back here.
    const sub = CapApp.addListener('appRestoredResult', (ev) => {
      const photo = restoredPhoto(ev)
      if (photo) void shoot(() => photoFromResult(photo))
    })
    return () => {
      alive.current = false
      void sub.then((h) => h.remove())
    }
  }, [afterCamera, setAsk, shoot])

  const onShutter = () => { void shoot(() => captureNativePhoto(PARENT_CAMERA)) }

  const onAskNext = () => {
    if (asking.current === 'camera') {
      setAsk(null)
      // The phone asks for the camera as it opens; the first shot is the answer.
      onShutter()
    } else if (asking.current === 'location') {
      setAsk(null)
      // Denial is fine: photos then just have no place.
      void askLocation().finally(() => { if (alive.current) afterLocation() })
    } else if (asking.current === 'notify' && deviceId) {
      setAsk(null)
      // Denial is fine too: the news still waits on this screen.
      void enableElderPush(deviceId).catch((err) => console.warn('[ElderCamera] push not enabled', err))
    }
  }

  const shown = news?.state === 'new' && news.unreadIds.every((id) => dismissed.includes(id)) ? null : news
  const onDismissNews = () => {
    if (news?.state !== 'new') return
    setDismissed((d) => [...d, ...news.unreadIds])
    // A written message gets the reply screen (it stamps them read itself);
    // a heart needs no answer and just goes.
    if (news.item.kind === 'comment' && onOpenNews) onOpenNews(news)
    else markRead(news.unreadIds, 'elder')
  }

  return (
    <ElderCameraView
      monthLine={monthLine}
      busy={busy}
      denied={denied}
      overlay={overlay}
      news={shown}
      onShutter={onShutter}
      onDismissNews={onDismissNews}
      onOpenRecords={onOpenRecords}
      onRetry={() => { setDenied(false); onShutter() }}
      photos={photos}
      recent={recent}
      corner={<ElderInstallButton compact />}
      onOpenPhotos={() => onOpenPhotos?.()}
      ask={ask === 'camera' ? ASK_CAMERA : ask === 'location' ? ASK_LOCATION : ask === 'notify' ? ASK_NOTIFY : null}
      askNext={ask === 'camera' ? tr('카메라 켜기', 'Turn on camera') : tr('다음', 'Next')}
      onAskNext={onAskNext}
    />
  )
}
