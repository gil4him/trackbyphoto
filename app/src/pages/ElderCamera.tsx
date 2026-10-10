import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { App as CapApp } from '@capacitor/app'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { capturePhoto, startPreview, stopPreview } from '../lib/cameraPreview'
import { savePhoto } from '../lib/capture'
import { askLocation, warmUpLocation } from '../lib/location'
import { ASK_CAMERA, ASK_LOCATION, cameraPermission, locationPermission } from '../lib/permissions'
import { ElderAsk } from '../components/ElderAsk'
import { ElderInstallButton } from '../components/ElderInstallButton'
import { markRead } from '../lib/reactions'
import { sentToName } from '../lib/people'
import { S } from '../lib/strings'
import { useElderNews } from '../hooks/useElderNews'
import { useMemberships } from '../hooks/useMemberships'
import type { ElderNews } from '../lib/reactionsModel'
import type { Reaction } from '../types'

/**
 * The simple edition's parent screen: the phone is a camera. Opening the app
 * (or coming back to it) shows the rear viewfinder straight away; one big
 * shutter sends the photo to family. Above it floats the newest heart or
 * comment from family until tapped; a small 내 사진 opens today's photos.
 * Nothing else — no settings, prices, limits or warnings.
 * docs/Daylie-v3-Simple-Core.md §2.
 */

/** Where the web build puts its <video>; native draws behind the page. */
const FEED_ID = 'elder-cam-feed'
const OVERLAY_MS = 1500

export type CameraPhase = 'starting' | 'live' | 'denied'
export type Overlay = { ok: true; text: string } | { ok: false; text: string; sub: string }

export function ElderCameraView({ phase, busy, overlay, news, photos = null, ask = null, corner = null, onShutter, onDismissNews, onOpenRecords, onRetry, onOpenPhotos = () => {}, onAskNext = () => {} }: {
  phase: CameraPhase
  /** Bottom-right of the bar, opposite 내 사진: the web's 아이콘 만들기. */
  corner?: ReactNode
  /** "민수가 사진을 보냈어요" while a photo from family is new, else null. */
  photos?: string | null
  onOpenPhotos?: () => void
  /** A plain sentence before a permission question (ElderAsk), or null. */
  ask?: string | null
  onAskNext?: () => void
  busy: boolean
  overlay: Overlay | null
  news: ElderNews | null
  onShutter: () => void
  onDismissNews: () => void
  onOpenRecords: () => void
  onRetry: () => void
}) {
  // A photo from family comes first; hearts and comments after it.
  const item = !photos && news?.state === 'new' ? news.item : null
  return (
    <div className="elder-cam">
      <div id={FEED_ID} className="elder-cam-feed" />

      {photos && (
        <button type="button" className="elder-cam-bubble" onClick={onOpenPhotos}>
          <span className="elder-cam-bubble-icon" aria-hidden="true">🖼️</span>
          <span className="elder-cam-bubble-body"><span>{photos}</span></span>
        </button>
      )}

      {item && (
        <button type="button" className="elder-cam-bubble" onClick={onDismissNews}>
          <span className="elder-cam-bubble-icon" aria-hidden="true">{item.kind === 'comment' ? '💬' : '❤️'}</span>
          <span className="elder-cam-bubble-body">
            <span>{item.kind === 'comment' ? S.elderCardComment(item.actorName) : S.elderCardHeart(item.actorName)}</span>
            {item.kind === 'comment' && item.text && <span className="elder-cam-bubble-text">{item.text}</span>}
          </span>
        </button>
      )}

      {phase === 'denied' && (
        <div className="elder-cam-denied" role="alert">
          <p className="elder-cam-denied-title">카메라를 사용할 수 없어요</p>
          <p className="elder-cam-denied-sub">설정에서 카메라를 허용해 주세요</p>
          <button type="button" className="elder-cam-retry" onClick={onRetry}>다시 시도</button>
        </div>
      )}

      {overlay && (
        <div className={`elder-cam-overlay ${overlay.ok ? 'ok' : 'fail'}`} role="status">
          <span>{overlay.text}</span>
          {!overlay.ok && <span className="elder-cam-overlay-sub">{overlay.sub}</span>}
        </div>
      )}

      {ask && <ElderAsk text={ask} onNext={onAskNext} />}

      {!ask && <div className="elder-cam-bar">
        <button type="button" className="elder-cam-records" onClick={onOpenRecords}>내 사진</button>
        <button
          type="button"
          className="elder-cam-shutter"
          aria-label="사진 찍기"
          disabled={phase !== 'live' || busy}
          onClick={onShutter}
        />
        <span className="elder-cam-bar-spacer">{corner}</span>
      </div>}
    </div>
  )
}

export function ElderCamera({ uid, reactions, photos = null, onOpenRecords, onOpenPhotos }: {
  uid: string
  /** This parent's reactions; null while reactions aren't rolled out. */
  reactions: Reaction[] | null
  /** The line for a new photo from family (familyPhotosModel cardLine), or null. */
  photos?: string | null
  onOpenRecords: () => void
  onOpenPhotos?: () => void
}) {
  const [phase, setPhase] = useState<CameraPhase>('starting')
  const [busy, setBusy] = useState(false)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  // Hidden as soon as it's tapped, before the read stamps come back.
  const [dismissed, setDismissed] = useState<string[]>([])
  const news = useElderNews(reactions, uid)
  const { caregivers } = useMemberships(uid, { withPatients: false })
  const toName = sentToName(caregivers)
  const alive = useRef(true)
  // The plain-sentence screen before the phone's camera / location question.
  const [ask, setAsk_] = useState<'camera' | 'location' | null>(null)
  const asking = useRef<'camera' | 'location' | null>(null)
  const setAsk = useCallback((a: 'camera' | 'location' | null) => {
    asking.current = a
    setAsk_(a)
  }, [])

  // Once the camera is on: location next — its plain sentence first if the
  // phone hasn't asked yet, else just start locating for the first shot.
  const afterLive = useCallback(() => {
    void locationPermission().then((s) => {
      if (!alive.current) return
      if (s === 'prompt') setAsk('location')
      else warmUpLocation()
    })
  }, [setAsk])

  // Only sets state once the camera answers, so the mount effect may call it.
  const launch = useCallback(() => {
    startPreview(FEED_ID)
      .then(() => {
        if (!alive.current) return
        setPhase('live')
        afterLive()
      })
      .catch((err) => {
        console.warn('[ElderCamera] preview failed', err)
        if (alive.current) setPhase('denied')
      })
  }, [afterLive])
  const restart = useCallback(() => {
    setPhase('starting')
    launch()
  }, [launch])

  // Viewfinder on while the screen is open and the app is in front: on mount,
  // and again whenever the app comes back (on web, @capacitor/app reports
  // tab visibility the same way). Off in the background and on leaving.
  useEffect(() => {
    alive.current = true
    // The camera's plain sentence first if the phone hasn't asked yet.
    void cameraPermission().then((s) => {
      if (!alive.current) return
      if (s === 'prompt') setAsk('camera')
      else launch()
    })
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) { if (asking.current !== 'camera') restart() }
      else void stopPreview()
    })
    return () => {
      alive.current = false
      void sub.then((h) => h.remove())
      void stopPreview()
    }
  }, [launch, restart, setAsk])

  const onAskNext = () => {
    if (asking.current === 'camera') {
      setAsk(null)
      restart() // the phone asks now
    } else if (asking.current === 'location') {
      setAsk(null)
      void askLocation() // denial is fine: photos then just have no place
    }
  }

  const onShutter = async () => {
    if (busy || phase !== 'live') return
    setBusy(true)
    void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {})
    let result: Overlay
    try {
      const { file, nativePath } = await capturePhoto()
      await savePhoto({ uid, file, nativePath })
      result = { ok: true, text: `${toName}에게 보냈어요 ♥` }
    } catch (err) {
      console.error('[ElderCamera] capture failed', err)
      result = { ok: false, text: '사진을 저장하지 못했어요', sub: '다시 한 번 찍어 주세요' }
    }
    if (!alive.current) return
    setOverlay(result)
    setTimeout(() => {
      if (!alive.current) return
      setOverlay(null)
      setBusy(false)
    }, OVERLAY_MS)
  }

  const shown = news?.state === 'new' && news.unreadIds.every((id) => dismissed.includes(id)) ? null : news
  const onDismissNews = () => {
    if (news?.state !== 'new') return
    setDismissed((d) => [...d, ...news.unreadIds])
    markRead(news.unreadIds, 'elder')
  }

  return (
    <ElderCameraView
      phase={phase}
      busy={busy}
      overlay={overlay}
      news={shown}
      onShutter={() => void onShutter()}
      onDismissNews={onDismissNews}
      onOpenRecords={onOpenRecords}
      onRetry={restart}
      photos={photos}
      corner={<ElderInstallButton compact />}
      onOpenPhotos={() => { void stopPreview(); onOpenPhotos?.() }}
      ask={ask === 'camera' ? ASK_CAMERA : ask === 'location' ? ASK_LOCATION : null}
      onAskNext={onAskNext}
    />
  )
}
