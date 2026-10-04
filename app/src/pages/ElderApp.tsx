import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { Home } from './Home'
import { Today } from './Today'
import { MemoDetail } from './MemoDetail'
import type { Memo } from '../types'

/**
 * Everything a family-managed elder's phone shows: the capture screen and
 * their own records. No tabs, no settings, no sign-out — family manages all
 * of that from their own phones. If family disconnects this phone (연결 해제),
 * the device record flips to 'revoked' and the screen locks.
 */
export function ElderApp({ uid, deviceId, patientName, memos, onRelink }: {
  uid: string
  deviceId: string
  patientName: string
  memos: Memo[]
  onRelink: () => void
}) {
  const [view, setView] = useState<'home' | 'records'>('home')
  const [openId, setOpenId] = useState<string | null>(null)
  const [revoked, setRevoked] = useState(false)

  useEffect(() => {
    if (!deviceId) { setRevoked(true); return }
    return onSnapshot(
      doc(db, 'users', uid, 'devices', deviceId),
      (snap) => setRevoked(!snap.exists() || snap.data()?.status !== 'active'),
      // Rules deny every read once the device is revoked.
      (err) => { if (err.code === 'permission-denied') setRevoked(true) },
    )
  }, [uid, deviceId])

  const open = openId ? memos.find((m) => m.id === openId) ?? null : null

  if (revoked) {
    return (
      <div className="app">
        <main>
          <section className="pair">
            <div className="signin-dot" />
            <h1 className="pair-title">연결이 해제되었어요</h1>
            <p className="pair-sub">가족에게 새 연결을 요청해 주세요.</p>
            <button className="pair-btn" onClick={onRelink}>새 코드 입력</button>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="app elder-mode">
      <main>
        {open ? (
          <MemoDetail memo={open} onBack={() => setOpenId(null)} readOnly />
        ) : view === 'records' ? (
          <>
            <button className="elder-back" onClick={() => setView('home')}>‹ 처음으로</button>
            <Today memos={memos} onOpen={setOpenId} readOnly />
          </>
        ) : (
          <Home
            uid={uid}
            patientName={patientName}
            greetingName={patientName}
            memos={memos}
            onOpenAsk={() => setView('records')}
            onOpen={setOpenId}
            canCapture
            recordsLabel
          />
        )}
      </main>
    </div>
  )
}
