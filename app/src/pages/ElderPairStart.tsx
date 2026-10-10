import { useCallback, useEffect, useRef, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { Clipboard } from '@capacitor/clipboard'
import { captureSampleBlob, startPreview, stopPreview } from '../lib/cameraPreview'
import { firstTimeOnly, pairCodeFromText } from '../lib/pairing'
import { startQrScan } from '../lib/qrScan'
import { referrerPairCode } from '../lib/installReferrer'
import type { CameraPhase } from './ElderCamera'

/**
 * The simple edition's first screen on a phone that isn't linked yet: the
 * camera is already on, looking for the family's 엄마 연결하기 QR. Holding the
 * phone up to it is all it takes — the code goes straight to PairDevice.
 * A parent on her own taps the family's link again (it opens the app) or
 * types its code (코드 입력).
 * A code copied by the /pair link page (PairLanding) is picked up from the
 * clipboard too, on the app's first launch only, so iOS asks to allow
 * pasting at most once.
 * docs/Daylie-v3-Simple-Core.md §1.
 */

const FEED_ID = 'elder-pair-feed'

export function ElderPairStartView({ phase, onFamily, onEnterCode, onRetry }: {
  phase: CameraPhase
  onFamily: () => void
  onEnterCode: () => void
  onRetry: () => void
}) {
  return (
    <div className="elder-cam">
      <div id={FEED_ID} className="elder-cam-feed" />

      {phase === 'denied' ? (
        <div className="elder-cam-denied" role="alert">
          <p className="elder-cam-denied-title">카메라를 사용할 수 없어요</p>
          <p className="elder-cam-denied-sub">설정에서 카메라를 허용해 주세요</p>
          <button type="button" className="elder-cam-retry" onClick={onRetry}>다시 시도</button>
        </div>
      ) : (
        <>
          <div className="elder-pair-hint" role="status">
            <span className="elder-pair-hint-title">가족이 보낸 링크를 누르거나 QR을 비춰주세요</span>
            <span className="elder-pair-hint-sub">가족이 옆에 있다면 가족 휴대폰의 QR을 여기에 비춰요</span>
          </div>
          <div className="elder-pair-frame" aria-hidden="true" />
        </>
      )}

      {/* A parent on her own: the link from the family, or its code. */}
      <div className="elder-pair-bar">
        <p className="elder-pair-again">가족이 보낸 링크를 한 번 더 눌러주세요</p>
        <button type="button" className="elder-pair-code" onClick={onEnterCode}>코드 입력</button>
        <button type="button" className="elder-pair-link" onClick={onFamily}>가족이에요</button>
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
    launch()
    // Installed from the family's link on Android: Play hands over its code.
    if (firstTimeOnly('tbp.pair.referrerChecked')) {
      void referrerPairCode().then((code) => { if (code) found(code) })
    }
    // A link copied by the /pair page — looked for on the first launch only.
    if (firstTimeOnly('tbp.pair.clipboardChecked')) {
      Clipboard.read()
        .then(({ value }) => {
          const code = pairCodeFromText(value ?? '')
          if (code) found(code)
        })
        .catch(() => {}) // empty clipboard, or pasting not allowed — just scan
    }
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (done.current) return
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

  return (
    <ElderPairStartView
      phase={phase}
      onFamily={leave(onFamily)}
      onEnterCode={leave(onEnterCode)}
      onRetry={restart}
    />
  )
}
