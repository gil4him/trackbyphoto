import { useEffect, useRef } from 'react'
import { frameMessage, kakaoFrameUrl, type FramePins } from '../lib/map/kakaoFrame'

/** Give up on the framed map after this long (offline, site down). */
const READY_TIMEOUT_MS = 10_000

/**
 * The Kakao map inside the store apps: the site's map page in an iframe
 * (lib/map/kakaoFrame.ts). `onFail` when it doesn't come up, so the caller
 * can show the Google picture instead; `onPick` when a pin is tapped.
 */
export function KakaoFrame({ map, className, onFail, onPick }: { map: FramePins; className: string; onFail: () => void; onPick?: (index: number) => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const src = kakaoFrameUrl(map)
  const done = useRef(false)

  useEffect(() => {
    done.current = false
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const msg = frameMessage(e.data)
      if (!msg) return
      if (msg.type === 'ready') done.current = true
      else if (msg.type === 'error' && !done.current) { done.current = true; onFail() }
      else if (msg.type === 'pick') onPick?.(msg.index)
    }
    window.addEventListener('message', onMessage)
    const timer = setTimeout(() => { if (!done.current) { done.current = true; onFail() } }, READY_TIMEOUT_MS)
    return () => { window.removeEventListener('message', onMessage); clearTimeout(timer) }
    // onFail / onPick are fresh closures each render; the frame is set up once per map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  return <iframe ref={frame} className={className} src={src} title="지도" loading="lazy" referrerPolicy="origin" />
}
