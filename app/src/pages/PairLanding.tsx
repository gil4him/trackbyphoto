import { useEffect, useState } from 'react'
import { formatPairCode, normalizePairCode } from '../lib/pairing'
import { PUBLIC_ORIGIN } from '../lib/publicUrl'
import { androidOpenUrl, storeKind, storeUrlFor, type StoreKind } from '../lib/storeLinks'
import { tr } from '../lib/lang'

/**
 * Simple edition, web: what a /pair link shows when the app didn't open it —
 * the app isn't installed yet, or KakaoTalk opened the link in its own
 * browser. The link is copied to the clipboard (on opening where the browser
 * allows it, and again on 앱 설치하기), so the app finds it on its first start
 * (ElderPairStart). If that doesn't work, tapping the link again once the
 * app is installed opens it directly (Universal/App Links).
 * A parent's phone uses the app: the browser pairing (연결하기, then the
 * camera in the browser) is offered only where the phone's store has no app.
 */

export function PairLandingView({ code, kind, storeUrl, onInstall, onWebPair, onBack }: {
  code: string
  kind: StoreKind
  storeUrl: string | null
  onInstall: () => void
  /** Link this phone in the browser (only where its store has no app). */
  onWebPair?: () => void
  /** Back to sign-in (opened from 자녀에게 받은 연결 코드가 있어요, no link). */
  onBack?: () => void
}) {
  return (
    <section className="pair">
      <div className="signin-dot" />
      <h1 className="pair-title">{storeUrl ? <>{tr('Daylie 앱으로', 'Connect with')}<br />{tr('연결해요', 'the Daylie app')}</> : <>{tr('휴대폰을 자녀와', 'Connect this phone')}<br />{tr('연결해요', 'with your family')}</>}</h1>
      {storeUrl ? (
        <>
          {kind === 'android' && code.length === 8 ? (
            // The button opens the app when it is there, else Play (androidOpenUrl).
            <>
              <p className="pair-sub">{tr('아래 버튼을 눌러 주세요.', 'Tap the button below.')}<br /><b>{tr('앱이 없으면 설치 화면이 열려요.', "If the app isn't installed, the install screen opens.")}</b></p>
              <button className="pair-btn" onClick={onInstall}>{tr('앱으로 연결하기', 'Open in the app')}</button>
            </>
          ) : (
            <>
              <p className="pair-sub">{tr('앱을 설치해 주세요.', 'Please install the app.')}<br /><b>{code.length === 8 ? tr('설치 후 이 링크를 한 번 더 눌러주세요.', 'After installing, tap this link once more.') : tr('설치 후 앱을 열고 ‘코드 입력’을 눌러 주세요.', 'After installing, open the app and tap ‘Enter code’.')}</b></p>
              <button className="pair-btn" onClick={onInstall}>{tr('앱 설치하기', 'Install the app')}</button>
            </>
          )}
        </>
      ) : kind !== 'other' && onWebPair && code.length === 8 ? (
        // Not in this phone's store yet: connect right here in the browser.
        <>
          <p className="pair-sub">{tr('아래 버튼을 한 번 눌러 주세요.', 'Tap the button below once.')}</p>
          <button className="pair-btn" onClick={onWebPair}>{tr('연결하기', 'Connect')}</button>
        </>
      ) : (
        <p className="pair-sub">{tr('연결할 휴대폰에서 이 링크를 열어 주세요.', 'Open this link on the phone you want to connect.')}</p>
      )}
      {code.length === 8 && (
        <div className="pair-code-box">
          <div className="help">{tr('앱에서 직접 넣을 때 코드', 'Code to type into the app')}</div>
          <div className="invite-code-display">{formatPairCode(code)}</div>
        </div>
      )}
      {onBack && <button className="pair-link" onClick={onBack}>{tr('돌아가기', 'Back')}</button>}
    </section>
  )
}

/** Copy the canonical link: the host the page is on may differ (firebaseapp.com). */
async function copyLink(code: string): Promise<void> {
  if (code.length !== 8) return
  await navigator.clipboard?.writeText(`${PUBLIC_ORIGIN}/pair?c=${code}`)
}

export function PairLanding({ initialCode, onWebPair, onBack }: { initialCode: string; onWebPair?: () => void; onBack?: () => void }) {
  const [code] = useState(() => normalizePairCode(initialCode))
  const [kind] = useState(() => storeKind(navigator.userAgent))
  const storeUrl = storeUrlFor(kind, undefined, code)

  useEffect(() => {
    // Without a tap most browsers refuse; 앱 설치하기 tries again.
    copyLink(code).catch(() => {})
  }, [code])

  const onInstall = async () => {
    await copyLink(code).catch(() => {})
    if (kind === 'android' && storeUrl && code.length === 8) window.location.href = androidOpenUrl(code, PUBLIC_ORIGIN)
    else if (storeUrl) window.location.href = storeUrl
  }

  return <PairLandingView code={code} kind={kind} storeUrl={storeUrl} onInstall={() => void onInstall()} onWebPair={onWebPair} onBack={onBack} />
}
