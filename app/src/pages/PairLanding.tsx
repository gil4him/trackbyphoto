import { useEffect, useState } from 'react'
import { formatPairCode, normalizePairCode } from '../lib/pairing'
import { PUBLIC_ORIGIN } from '../lib/publicUrl'
import { storeKind, storeUrlFor, type StoreKind } from '../lib/storeLinks'

/**
 * Simple edition, web: what a /pair link shows when the app didn't open it —
 * the app isn't installed yet, or KakaoTalk opened the link in its own
 * browser. The link is copied to the clipboard (on opening where the browser
 * allows it, and again on 앱 설치하기), so the app finds it on its first start
 * (ElderPairStart). If that doesn't work, tapping the link again once the
 * app is installed opens it directly (Universal/App Links).
 * 앱 없이 이 화면에서 연결하기 links the phone right here in the browser
 * instead (the web pairing flow, then the camera in the browser).
 */

export function PairLandingView({ code, kind, storeUrl, onInstall, onWebPair }: {
  code: string
  kind: StoreKind
  storeUrl: string | null
  onInstall: () => void
  /** Link this phone in the browser, without the app. */
  onWebPair?: () => void
}) {
  return (
    <section className="pair">
      <div className="signin-dot" />
      <h1 className="pair-title">오늘하루 앱으로<br />연결해요</h1>
      {storeUrl ? (
        <>
          <p className="pair-sub">앱을 설치해 주세요.<br /><b>설치 후 이 링크를 한 번 더 눌러주세요.</b></p>
          <button className="pair-btn" onClick={onInstall}>앱 설치하기</button>
        </>
      ) : kind === 'ios' ? (
        <p className="pair-sub">App Store에서 ‘오늘하루’를 찾아 설치해 주세요.<br /><b>설치 후 이 링크를 한 번 더 눌러주세요.</b></p>
      ) : (
        <p className="pair-sub">연결할 휴대폰에서 이 링크를 열어 주세요.</p>
      )}
      {onWebPair && code.length === 8 && kind !== 'other' && (
        <button className="pair-link pair-web-link" onClick={onWebPair}>앱 없이 이 화면에서 연결하기</button>
      )}
      {code.length === 8 && (
        <div className="pair-code-box">
          <div className="help">앱에서 직접 넣을 때 코드</div>
          <div className="invite-code-display">{formatPairCode(code)}</div>
        </div>
      )}
    </section>
  )
}

/** Copy the canonical link: the host the page is on may differ (firebaseapp.com). */
async function copyLink(code: string): Promise<void> {
  if (code.length !== 8) return
  await navigator.clipboard?.writeText(`${PUBLIC_ORIGIN}/pair?c=${code}`)
}

export function PairLanding({ initialCode, onWebPair }: { initialCode: string; onWebPair?: () => void }) {
  const [code] = useState(() => normalizePairCode(initialCode))
  const [kind] = useState(() => storeKind(navigator.userAgent))
  const storeUrl = storeUrlFor(kind)

  useEffect(() => {
    // Without a tap most browsers refuse; 앱 설치하기 tries again.
    copyLink(code).catch(() => {})
  }, [code])

  const onInstall = async () => {
    await copyLink(code).catch(() => {})
    if (storeUrl) window.location.href = storeUrl
  }

  return <PairLandingView code={code} kind={kind} storeUrl={storeUrl} onInstall={() => void onInstall()} onWebPair={onWebPair} />
}
