import { useCallback, useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { Home } from './Home'
import { ElderCamera } from './ElderCamera'
import { ElderRecords } from '../components/ElderRecords'
import { MemoDetail } from './MemoDetail'
import { FamilyNews } from './FamilyNews'
import { FamilyNewsCard } from '../components/FamilyNewsCard'
import { ElderInstallButton } from '../components/ElderInstallButton'
import { FamilyPhotosCard } from '../components/FamilyPhotosCard'
import { FamilyPhotoViewer } from './FamilyPhotoViewer'
import { useFamilyPhotos } from '../hooks/useFamilyPhotos'
import { setAppBadge } from '../lib/appBadge'
import { useElderNews, type OpenNews } from '../hooks/useElderNews'
import { byMemo } from '../lib/reactionsModel'
import type { ReactionsContext } from '../components/Reactions'
import { unlinkedFrom } from '../lib/device'
import { resetIfAccountGone } from '../hooks/useAuth'
import { isSimple } from '../lib/edition'
import type { Memo, Reaction, TextReplies } from '../types'
import { cardLine, unseen } from '../lib/familyPhotosModel'

/** The camera's photo bubble: only while a photo from family is new. */
const newPhotosLine = (photos: Parameters<typeof cardLine>[0]) => { const line = cardLine(photos); return line?.lit ? line : null }
import { CameraFab } from '../components/CameraFab'
import { useToast } from '../components/Toast'
import { useIdleReturn } from '../hooks/useIdleReturn'
import { S } from '../lib/strings'

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
  const toast = useToast()
  const [revoked, setRevoked] = useState(false)
  // The news the parent opened, kept as it was when they tapped the card.
  const [openNews, setOpenNews] = useState<OpenNews | null>(null)
  const news = useElderNews(reactions, uid)
  // The family's hearts and words under each of the parent's photos. The
  // parent never reacts from the photo page; 답장 opens 가족 소식.
  const rx = useMemo<ReactionsContext | undefined>(() => reactions ? {
    byMemo: byMemo(reactions),
    me: { uid, name: patientName },
    patientUid: uid,
    patientName,
    canReact: false,
    voiceOn,
    voiceAllowed: true,
    onReply: (item, unreadIds) => setOpenNews({ state: 'new', item, unreadIds }),
  } : undefined, [reactions, uid, patientName, voiceOn])
  const familyPhotos = useFamilyPhotos(familyPhotosOn ? uid : undefined)
  // The family-photo viewer: open from the camera's bubble (true), or on one photo tapped in 내 사진 (its id).
  const [photosOpen, setPhotosOpen] = useState<boolean | string>(false)

  // The number on the phone's icon: photos from family not looked at, and
  // hearts and words not read. Pushes set it while the app is closed
  // (worker pushToElder); here it follows what the parent has seen.
  useEffect(() => {
    setAppBadge(unseen(familyPhotos).length + (news?.state === 'new' ? news.unreadIds.length : 0))
  }, [familyPhotos, news])

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

  // The floating camera on 내 사진 and a memo: straight back to the first
  // screen (the camera in the simple edition, Home with 사진 찍기 in full).
  const backToCamera = useCallback(() => {
    setOpenNews(null)
    setPhotosOpen(false)
    setOpenId(null)
    setView('home')
  }, [])
  // Simple edition: any screen but the camera goes back to it after a minute
  // without a touch (A9), so the phone is always ready for the next photo.
  useIdleReturn(isSimple() && !revoked && (openNews !== null || photosOpen !== false || openId !== null || view === 'records'), backToCamera)

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
          <FamilyPhotoViewer
            photos={familyPhotos}
            textMode={textMode}
            startId={typeof photosOpen === 'string' ? photosOpen : undefined}
            onDone={(allSeen) => { setPhotosOpen(false); if (allSeen) toast.show(S.familyPhotoAllSeen, '') }}
          />
        ) : open ? (
          <div className="elder-scroll">
            <MemoDetail memo={open} onBack={() => setOpenId(null)} readOnly rx={rx} />
            <CameraFab label="카메라로 돌아가기" onClick={backToCamera} />
          </div>
        ) : view === 'records' ? (
          <div className="elder-scroll">
            <header className="elder-records-head">
              <button type="button" className="back" onClick={() => setView('home')}>‹ 카메라</button>
              <h1 className="elder-records-title">내 사진</h1>
              <span className="head-btn-space" aria-hidden="true" />
            </header>
            <ElderRecords
              memos={memos}
              received={familyPhotosOn ? familyPhotos : []}
              byMemo={rx?.byMemo}
              patientUid={uid}
              onOpen={setOpenId}
              onOpenReceived={setPhotosOpen}
              onCamera={backToCamera}
            />
          </div>
        ) : isSimple() ? (
          <ElderCamera
            uid={uid}
            deviceId={deviceId}
            reactions={reactions}
            // Only a new photo is announced on the camera; the ones already seen live in 내 사진.
            photos={familyPhotosOn ? newPhotosLine(familyPhotos) : null}
            recent={memos[0] ?? null}
            onOpenRecords={() => setView('records')}
            onOpenPhotos={() => setPhotosOpen(true)}
            onOpenNews={setOpenNews}
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
