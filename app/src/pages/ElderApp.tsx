import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { Home } from './Home'
import { ElderCamera } from './ElderCamera'
import { Today } from './Today'
import { MemoDetail } from './MemoDetail'
import { FamilyNews } from './FamilyNews'
import { FamilyNewsCard } from '../components/FamilyNewsCard'
import { ElderInstallButton } from '../components/ElderInstallButton'
import { FamilyPhotosCard } from '../components/FamilyPhotosCard'
import { FamilyPhotoViewer } from './FamilyPhotoViewer'
import { useFamilyPhotos } from '../hooks/useFamilyPhotos'
import { useElderNews, type OpenNews } from '../hooks/useElderNews'
import { unlinkedFrom } from '../lib/device'
import { resetIfAccountGone } from '../hooks/useAuth'
import { isSimple } from '../lib/edition'
import type { FamilyPhoto, Memo, Reaction, TextReplies } from '../types'
import { cardLine } from '../lib/familyPhotosModel'

/**
 * Everything a family-managed elder's phone shows: the capture screen, one
 * 가족 소식 card, and their own records (plus, until it is done, one button
 * to put the icon on the home screen). No tabs, no settings, no sign-out —
 * family manages all of that from their own phones, and nothing here differs
 * by plan. If family disconnects this phone (연결 해제),
 * the device record flips to 'revoked' and the screen locks. If family
 * deleted the parent altogether, the phone starts over at the first screen.
 * In the simple edition the first screen is the camera itself (ElderCamera).
 */
export function ElderApp({ uid, deviceId, patientName, memos, reactions, voiceOn, textMode, familyPhotosOn = false, onRelink }: {
  uid: string
  deviceId: string
  patientName: string
  memos: Memo[]
  /** This parent's reactions; null while reactions aren't rolled out. */
  reactions: Reaction[] | null
  /** Voice replies are rolled out and were agreed to for this parent. */
  voiceOn: boolean
  /** Written replies family allows for this parent. */
  textMode?: TextReplies
  /** Photos from family are switched on, and received for this parent. */
  familyPhotosOn?: boolean
  onRelink: () => void
}) {
  const [view, setView] = useState<'home' | 'records'>('home')
  const [openId, setOpenId] = useState<string | null>(null)
  const [revoked, setRevoked] = useState(false)
  // The news the parent opened, kept as it was when they tapped the card.
  const [openNews, setOpenNews] = useState<OpenNews | null>(null)
  const news = useElderNews(reactions, uid)
  const familyPhotos = useFamilyPhotos(familyPhotosOn ? uid : undefined)
  const [photosOpen, setPhotosOpen] = useState(false)

  useEffect(() => {
    if (!deviceId) { setRevoked(true); return }
    // Unlinked, or the whole account deleted? Only the first locks the screen.
    const lockUnlessDeleted = async () => { if (!(await resetIfAccountGone())) setRevoked(true) }
    return onSnapshot(
      doc(db, 'users', uid, 'devices', deviceId),
      // Metadata changes too: that is how "the server confirms there is no
      // such device" arrives after a first answer from the empty cache.
      { includeMetadataChanges: true },
      (snap) => {
        const unlinked = unlinkedFrom(snap)
        if (unlinked === true) void lockUnlessDeleted()
        else if (unlinked === false) setRevoked(false)
      },
      // Rules deny every read once the device is revoked.
      (err) => { if (err.code === 'permission-denied') void lockUnlessDeleted() },
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
        {openNews ? (
          <FamilyNews
            uid={uid}
            patientName={patientName}
            item={openNews.item}
            unreadIds={openNews.unreadIds}
            memo={memos.find((m) => m.id === openNews.item.memoId)}
            voiceOn={voiceOn}
            textMode={textMode}
            onDone={() => setOpenNews(null)}
          />
        ) : photosOpen ? (
          <FamilyPhotoViewer photos={familyPhotos} textMode={textMode} onDone={() => setPhotosOpen(false)} />
        ) : open ? (
          <MemoDetail memo={open} onBack={() => setOpenId(null)} readOnly />
        ) : view === 'records' ? (
          <>
            <button className="elder-back" onClick={() => setView('home')}>‹ 처음으로</button>
            <Today memos={memos} onOpen={setOpenId} uid={uid} readOnly />
          </>
        ) : isSimple() ? (
          <ElderCamera
            uid={uid}
            reactions={reactions}
            photos={familyPhotosOn ? newPhotosLine(familyPhotos) : null}
            onOpenRecords={() => setView('records')}
            onOpenPhotos={() => setPhotosOpen(true)}
          />
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
            newsCard={(
              <>
                {news && <FamilyNewsCard news={news} onOpen={() => { if (news.state !== 'none') setOpenNews(news) }} />}
                {familyPhotosOn && <FamilyPhotosCard photos={familyPhotos} onOpen={() => setPhotosOpen(true)} />}
                <ElderInstallButton />
              </>
            )}
          />
        )}
      </main>
    </div>
  )
}

/** The camera's bubble line while a photo from family is new, else null. */
function newPhotosLine(photos: FamilyPhoto[]): string | null {
  const card = cardLine(photos)
  return card?.lit ? card.line : null
}
