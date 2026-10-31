import { useState } from 'react'
import { useToast } from './Toast'
import { markShareCardDone, shareApp, shareCardDone } from '../lib/shareApp'

const LABEL = '가족·친구에게 알리기'

function useShareApp() {
  const toast = useToast()
  return async () => {
    if (await shareApp() === 'copied') toast.show('메시지를 복사했어요', '문자나 메신저에 붙여넣어 보내주세요')
  }
}

/** The row in the family's own Settings. */
export function ShareAppRow() {
  const share = useShareApp()
  return (
    <button className="linkbtn" onClick={() => void share()}>
      <span>{LABEL}</span><span aria-hidden="true">→</span>
    </button>
  )
}

/** The Today card, once the 3rd photo has arrived. Gone for good after a tap or 닫기. */
export function ShareAppCard({ uid }: { uid: string }) {
  const share = useShareApp()
  const [done, setDone] = useState(() => shareCardDone(uid))
  if (done) return null
  const finish = () => { markShareCardDone(uid); setDone(true) }
  return (
    <div className="share-app-card">
      <p className="share-app-msg">사진이 잘 오고 있어요.<br />주변에도 알려 보세요.</p>
      <div className="share-app-actions">
        <button type="button" className="share-app-close" onClick={finish}>닫기</button>
        <button type="button" className="share-app-btn" onClick={() => { finish(); void share() }}>{LABEL}</button>
      </div>
    </div>
  )
}
