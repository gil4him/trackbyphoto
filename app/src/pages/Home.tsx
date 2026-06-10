import { useEffect, useRef, useState } from 'react'
import { useToast } from '../components/Toast'
import { Processing } from '../components/Processing'
import {
  getGeo,
  uploadPhoto,
  captureNativePhoto,
  analyzePhotoTags,
  generateActivityMemo,
  isNativeApp,
} from '../lib/capture'
import { fmtDate, fmtTime } from '../util'
import { MemoThumb } from '../components/MemoThumb'
import type { Memo, AppNotification } from '../types'

/**
 * The prototype's home is a single-purpose screen: a giant circular capture
 * button + a date eyebrow + a secondary "지난 기록 물어보기" pill that jumps
 * to the Ask tab. Recent thumbnails moved to the 오늘 tab.
 *
 * We still subscribe to the memos snapshot so we can toast when the most
 * recent upload finishes processing (caregiver sees the result without
 * having to leave the home screen).
 */
export function Home({ uid, patientName, greetingName, memos, onOpenAsk, onOpen, canCapture = true, notifications = [], onDismissNotification }: { uid: string; patientName: string; greetingName: string; memos: Memo[]; onOpenAsk: () => void; onOpen: (id: string) => void; canCapture?: boolean; notifications?: AppNotification[]; onDismissNotification?: (id: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [busyMsg, setBusyMsg] = useState('사진을 저장하고 있어요…')
  const [busySub] = useState('시간 · 장소 · 활동을 자동으로 적어요')
  const toast = useToast()
  const lastReadyId = useRef<string | null>(null)

  useEffect(() => {
    const newestReady = memos.find((m) => m.status === 'ready')
    if (newestReady && lastReadyId.current === null) {
      lastReadyId.current = newestReady.id
      return
    }
    if (newestReady && newestReady.id !== lastReadyId.current) {
      lastReadyId.current = newestReady.id
      toast.show(
        `${fmtTime(newestReady.takenAt.toDate())} · ${newestReady.memo}`,
        `${newestReady.place} — 저장되었어요`,
      )
    }
  }, [memos, toast])

  const onPick = async (file: File, nativePath?: string) => {
    setBusy(true)
    setBusyMsg('기록하는 중이에요…')
    try {
      const takenAt = new Date()
      const visionThenMemo = (async () => {
        const tags = await analyzePhotoTags(nativePath)
        if (tags) console.log('[capture] vision tags', tags)
        const timeHint = `${takenAt.getHours().toString().padStart(2, '0')}:${takenAt.getMinutes().toString().padStart(2, '0')}`
        const { memo, source } = await generateActivityMemo(tags, { timeHint })
        if (memo) console.log('[capture] on-device memo', memo, `(${source})`)
        return { tags, memo, source }
      })()
      const [geo, { tags, memo, source }] = await Promise.all([getGeo(), visionThenMemo])
      const memoSource = source === 'none' ? null : source
      setBusyMsg('업로드 중이에요…')
      await uploadPhoto({ uid, file, geo, takenAt, tags, memo, memoSource })
      setBusyMsg('AI가 활동을 적고 있어요…')
      // Cloud Function trigger does the rest; useEffect above toasts on arrival.
      setTimeout(() => setBusy(false), 1500)
    } catch (err) {
      console.error(err)
      toast.show('업로드에 실패했어요', '잠시 후 다시 시도해주세요')
      setBusy(false)
    }
  }

  const today = new Date()

  return (
    <section className="page home" aria-label={`${patientName}님의 홈`}>
      {notifications.length > 0 && (
        <div className="notice-stack" role="status" aria-label="보호자 활동 알림">
          {notifications.map((n) => (
            <div key={n.id} className="notice">
              <span className="notice-msg">{n.message}</span>
              {onDismissNotification && (
                <button
                  className="notice-x"
                  aria-label="알림 지우기"
                  onClick={() => onDismissNotification(n.id)}
                >✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="home-hi">
        <div className="d">{fmtDate(today)}</div>
        <div className="t">{greetingName}님, 안녕하세요</div>
        <div className="sub">오늘 하루를 기록해요</div>
      </div>

      <div className="capwrap">
        {/* Caregiver mode: replace the capture button with a friendly notice.
            Cloud storage rules would block a caregiver upload anyway (path
            scoped to the uploader's own uid), so the button has no useful
            action when the active patient isn't the signed-in user. */}
        {!canCapture && (
          <div className="caregiver-note" role="status">
            <b>{patientName}님의 기록을 보고 있어요.</b>
            <span>사진 찍기는 본인 계정에서만 가능해요.</span>
          </div>
        )}
        {/* Take-photo and Ask sit side by side as equal tiles. In caregiver
            mode (no capture) the Ask tile stretches to fill the row alone. */}
        <div className={canCapture ? 'capgrid' : 'capgrid single'}>
          {canCapture && (
            <button
              className="capbtn"
              aria-label="사진 찍기"
              onClick={async () => {
                if (isNativeApp) {
                  try {
                    const { file, path } = await captureNativePhoto()
                    onPick(file, path)
                  } catch (err) {
                    console.warn('[capture] native camera cancelled or failed', err)
                  }
                } else {
                  inputRef.current?.click()
                }
              }}
            >
              <svg className="cam" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2l.9-1.4A1.5 1.5 0 0 1 8.9 4h6.2a1.5 1.5 0 0 1 1.3.6L17.3 6h1.2A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
                <circle cx="12" cy="12.3" r="3.4" />
              </svg>
              <span className="lab">사진 찍기</span>
            </button>
          )}

          <button className="askbtn" onClick={onOpenAsk} aria-label="지난 기록 물어보기">
            <svg className="ask-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20.5 20.5l-3.6-3.6" />
            </svg>
            <span className="lab">지난 기록<br />물어보기</span>
          </button>
        </div>

        {canCapture && (
          <div className="cap-help">
            버튼을 누르면 사진이 찍히고<br />
            자동으로 기록돼요
          </div>
        )}

        <input
          ref={inputRef}
          className="hidden-input"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onPick(f)
            e.currentTarget.value = ''
          }}
        />
      </div>

      {memos.length > 0 && (
        <div className="recent-strip" aria-label="최근 사진">
          {memos.slice(0, 4).map((m) => (
            <button
              type="button"
              key={m.id}
              className="recent-thumb"
              onClick={() => onOpen(m.id)}
              aria-label="자세히 보기"
            >
              <MemoThumb memo={m} showLocation />
            </button>
          ))}
        </div>
      )}

      <Processing show={busy} message={busyMsg} sub={busySub} />
    </section>
  )
}
