import { useCallback, useEffect, useRef, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { captureSampleBlob, startPreview, stopPreview } from '../lib/cameraPreview'
import { startQrScan } from '../lib/qrScan'
import { ASK_CAMERA_TO_LINK, cameraPermission } from '../lib/permissions'
import { ElderAsk } from '../components/ElderAsk'
import { tr } from '../lib/lang'

/** The pairing viewfinder's state: starting, live, or refused by the phone. */
export type CameraPhase = 'starting' | 'live' | 'denied'

/**
 * The simple edition's first screen on a phone that isn't linked yet: the
 * camera is already on, looking for the family's 엄마 연결하기 QR. Holding the
 * phone up to it is all it takes — the code goes straight to PairDevice.
 * A parent on her own taps the family's link again (it opens the app) or
 * types its code (코드 입력).
 * (A code from the family's link is picked up on the app's first launch,
 * before this screen: hooks/useFirstLaunchPairCode.)
 * simple/Daylie-v3-Simple-Core.md §1.
 */

const FEED_ID = 'elder-pair-feed'

export function ElderPairStartView({ phase, asking = false, onFamily, onEnterCode, onRetry, onAskNext = () => {} }: {
  phase: CameraPhase
  /** The camera's plain sentence before the phone asks (ElderAsk). */
  asking?: boolean
  onAskNext?: () => void
  onFamily: () => void
  onEnterCode: () => void
  onRetry: () => void
}) {
  return (
    <div className="elder-cam">
      <div id={FEED_ID} className="elder-cam-feed" />

      {phase === 'denied' ? (
        <div className="elder-cam-denied" role="alert">
          <p className="elder-cam-denied-title">{tr('카메라를 사용할 수 없어요', "Can't use the camera")}</p>
          <p className="elder-cam-denied-sub">{tr('설정에서 카메라를 허용해 주세요', 'Please allow the camera in Settings')}</p>
          <button type="button" className="elder-cam-retry" onClick={onRetry}>{tr('다시 시도', 'Try again')}</button>
        </div>
      ) : (
        <>
          <div className="elder-pair-hint" role="status">
            <span className="elder-pair-hint-title">{tr('자녀가 보낸 링크를 누르거나 QR을 비춰주세요', 'Tap the link your family sent, or point at their QR code')}</span>
            <span className="elder-pair-hint-sub">{tr('자녀가 옆에 있다면 자녀 휴대폰의 QR을 여기에 비춰요', "If your family is with you, point this at the QR code on their phone")}</span>
          </div>
          <div className="elder-pair-frame" aria-hidden="true" />
        </>
      )}

      {asking && <ElderAsk text={ASK_CAMERA_TO_LINK} onNext={onAskNext} />}

      {/* A parent on her own: the link from the family, or its code. */}
      <div className="elder-pair-bar">
        <p className="elder-pair-again">{tr('자녀가 보낸 링크를 한 번 더 눌러주세요', 'Please tap the link your family sent once more')}</p>
        <button type="button" className="elder-pair-code" onClick={onEnterCode}>{tr('코드 입력', 'Enter code')}</button>
        <button type="button" className="elder-pair-link" onClick={onFamily}>{tr('자녀예요', "I'm family")}</button>
      </div>
    </div>
  )
}

export function ElderPairStart({ onCode, onFamily, onEnterCode }: {
  /** A pair code from a scanned QR or the clipboard. */
  onCode: (code: string) => void
  /** The daughter's own phone: go to sign-in. */
  onFamily: () => void
  onEnterCode: () => void
}) {
  const [phase, setPhase] = useState<CameraPhase>('starting')
  const alive = useRef(true)
  const done = useRef(false)
  const stopScan = useRef<(() => void) | null>(null)
  // The camera's plain sentence, shown until 다음 when the phone hasn't asked yet.
  const [asking, setAsking] = useState(false)
  const askingRef = useRef(false)

  const found = useCallback((code: string) => {
    if (done.current || !alive.current) return
    done.current = true
    stopScan.current?.()
    void stopPreview().finally(() => onCode(code))
  }, [onCode])

  const launch = useCallback(() => {
    startPreview(FEED_ID, { storeToFile: false })
      .then(() => {
        if (!alive.current || done.current) return
        setPhase('live')
        stopScan.current?.()
        stopScan.current = startQrScan({ sample: () => captureSampleBlob(50), onCode: found })
      })
      .catch((err) => {
        console.warn('[ElderPairStart] preview failed', err)
        if (alive.current) setPhase('denied')
      })
  }, [found])
  const pause = useCallback(() => {
    stopScan.current?.()
    stopScan.current = null
    void stopPreview()
  }, [])
  const restart = useCallback(() => {
    setPhase('starting')
    launch()
  }, [launch])

  useEffect(() => {
    alive.current = true
    void cameraPermission().then((s) => {
      if (!alive.current || done.current) return
      if (s === 'prompt') {
        askingRef.current = true
        setAsking(true)
      } else launch()
    })
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (done.current || askingRef.current) return
      if (isActive) restart()
      else pause()
    })
    return () => {
      alive.current = false
      void sub.then((h) => h.remove())
      pause()
    }
  }, [launch, restart, pause, found])

  // Leaving for the code form or sign-in: the camera goes off first.
  const leave = (next: () => void) => () => {
    done.current = true
    stopScan.current?.()
    void stopPreview().finally(next)
  }

  const onAskNext = () => {
    askingRef.current = false
    setAsking(false)
    restart() // the phone asks now
  }

  return (
    <ElderPairStartView
      phase={phase}
      asking={asking}
      onFamily={leave(onFamily)}
      onEnterCode={leave(onEnterCode)}
      onRetry={restart}
      onAskNext={onAskNext}
    />
  )
}
