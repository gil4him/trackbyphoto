import { useEffect, useRef, useState } from 'react'
import { useToast } from '../components/Toast'
import { warmUpLocation } from '../lib/location'
import { useOutbox } from '../hooks/useOutbox'
import { useCapture } from '../hooks/useCapture'
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
export function Home({ uid, patientName, greetingName, memos, onOpenAsk, onOpen, canCapture = true, notifications = [], onDismissNotification, recordsLabel, newsCard, topCard, onSendPhoto, sentPhotos, sendTargets, onSendTo }: { /** Family on their own home: parents they may send a photo to. */ sendTargets?: { uid: string; name: string }[]; onSendTo?: (t: { uid: string; name: string }) => void; /** The parent's 가족 소식 card, shown under the buttons. */ newsCard?: React.ReactNode; /** A one-off card above the greeting (family's 알림 켜기). */ topCard?: React.ReactNode; /** Family: send the parent a photo (when switched on for them). */ onSendPhoto?: () => void; /** Family: what has been sent, with the parent's answers. */ sentPhotos?: React.ReactNode; recordsLabel?: boolean; uid: string; patientName: string; greetingName: string; memos: Memo[]; onOpenAsk: () => void; onOpen: (id: string) => void; canCapture?: boolean; notifications?: AppNotification[]; onDismissNotification?: (id: string) => void }) {
  const toast = useToast()
  const capture = useCapture(uid)
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

  // Start finding the phone's location while the screen is open, so it is
  // ready by the time a photo is taken.
  useEffect(() => { if (canCapture) warmUpLocation() }, [canCapture])

  // Photos still on the phone, waiting to be sent.
  const waiting = useOutbox(canCapture ? uid : undefined)
  const struggling = waiting.some((i) => i.attempts > 0)

  const today = new Date()

  return (
    <section className="page home" aria-label={`${patientName}님의 홈`}>
      {notifications.length > 0 && (
        <div className="notice-stack" role="status" aria-label="가족 활동 알림">
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

      {topCard}

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
            <span>{onSendPhoto ? `${patientName}님께 사진을 보내 드릴 수 있어요.` : '사진 찍기는 본인 계정에서만 가능해요.'}</span>
          </div>
        )}
        {!canCapture && onSendPhoto && (
          <button type="button" className="linkbtn fp-send-btn" onClick={onSendPhoto}>
            <span>📷 {patientName}님께 사진 보내기</span><span aria-hidden="true">→</span>
          </button>
        )}
        {/* Take-photo and Ask sit side by side as equal tiles. In caregiver
            mode (no capture) the Ask tile stretches to fill the row alone. */}
        <div className={canCapture ? 'capgrid' : 'capgrid single'}>
          {canCapture && (
            <button
              className="capbtn"
              aria-label="사진 찍기"
              disabled={capture.busy}
              onClick={capture.takePhoto}
            >
              <svg className="cam" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2l.9-1.4A1.5 1.5 0 0 1 8.9 4h6.2a1.5 1.5 0 0 1 1.3.6L17.3 6h1.2A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
                <circle cx="12" cy="12.3" r="3.4" />
              </svg>
              <span className="lab">사진 찍기</span>
            </button>
          )}

          <button className="askbtn" onClick={onOpenAsk} aria-label={recordsLabel ? '지난 기록 보기' : '지난 기록 물어보기'}>
            <svg className="ask-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20.5 20.5l-3.6-3.6" />
            </svg>
            <span className="lab">{recordsLabel ? '지난 기록 보기' : '지난 기록 물어보기'}</span>
          </button>
        </div>

        {canCapture && sendTargets && sendTargets.length > 0 && onSendTo && (
          <SendTargets targets={sendTargets} onSendTo={onSendTo} />
        )}

        {newsCard}
        {sentPhotos}

        {waiting.length > 0 && (
          <div className={`outbox-note ${struggling ? 'weak' : ''}`} role="status">
            {struggling
              ? <>인터넷이 약해요. 사진 {waiting.length}장은 휴대폰에 안전하게 보관했어요.<br />연결되면 자동으로 보내요.</>
              : <>사진 {waiting.length}장을 보내는 중이에요…</>}
          </div>
        )}

        {canCapture && (
          <div className="cap-help">
            버튼을 누르면 사진이 찍히고<br />
            {sendTargets && sendTargets.length > 0 ? '내 기록으로 저장돼요' : '자동으로 기록돼요'}
          </div>
        )}

        {capture.inputEl}
      </div>

      {memos.length > 0 && (
        <div className="recent-strip" aria-label="최근 사진">
          {memos.slice(0, 10).map((m) => (
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

      {capture.processing}
    </section>
  )
}

/** 사진 보내기 on one's own home: a button per parent (the name is the
 *  choice); with three or more, one button that opens the list. */
function SendTargets({ targets, onSendTo }: { targets: { uid: string; name: string }[]; onSendTo: (t: { uid: string; name: string }) => void }) {
  const [open, setOpen] = useState(false)
  const button = (t: { uid: string; name: string }) => (
    <button key={t.uid} type="button" className="linkbtn fp-send-btn" onClick={() => onSendTo(t)}>
      <span>📷 {t.name}님께 사진 보내기</span><span aria-hidden="true">→</span>
    </button>
  )
  return (
    <div className="fp-send-stack">
      {targets.length <= 2 || open
        ? targets.map(button)
        : (
          <button type="button" className="linkbtn fp-send-btn" onClick={() => setOpen(true)}>
            <span>📷 부모님께 사진 보내기</span><span aria-hidden="true">→</span>
          </button>
        )}
    </div>
  )
}
