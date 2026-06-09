import { useEffect, useRef, useState } from 'react'
import { useToast } from '../components/Toast'
import { Processing } from '../components/Processing'
import { Ask } from '../components/Ask'
import {
  getGeo,
  uploadPhoto,
  deleteMemo,
  captureNativePhoto,
  analyzePhotoTags,
  generateActivityMemo,
  isNativeApp,
} from '../lib/capture'
import { fmtTime, greeting } from '../util'
import type { Memo } from '../types'

export function Home({ uid, patientName, memos, onOpen }: { uid: string; patientName: string; memos: Memo[]; onOpen: (id: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [busyMsg, setBusyMsg] = useState('사진을 저장하고 있어요…')
  const [asking, setAsking] = useState(false)
  const toast = useToast()
  // Watch for the newest memo to flip from "pending" → "ready" and show a toast.
  const lastReadyId = useRef<string | null>(null)

  useEffect(() => {
    const newestReady = memos.find((m) => m.status === 'ready')
    if (newestReady && lastReadyId.current === null) {
      // First load: just remember it; don't toast for historical memos.
      lastReadyId.current = newestReady.id
      return
    }
    if (newestReady && newestReady.id !== lastReadyId.current) {
      lastReadyId.current = newestReady.id
      toast.show(
        `${fmtTime(newestReady.takenAt.toDate())} · ${newestReady.activity}`,
        `${newestReady.place} — 저장되었어요`,
      )
    }
  }, [memos, toast])

  const onPick = async (file: File, nativePath?: string) => {
    setBusy(true)
    setBusyMsg('사진을 저장하고 있어요…')
    try {
      const takenAt = new Date()
      // Geolocation runs in parallel with the Vision → Foundation Models
      // chain. Vision returns null on web (no native path) which short-
      // circuits the LLM call too.
      const visionThenMemo = (async () => {
        // analyzePhotoTags handles the platform switch internally: real
        // Vision on native, synthetic tags in dev-server web, null in
        // production web. Keep this call site uniform.
        const tags = await analyzePhotoTags(nativePath)
        if (tags) console.log('[capture] vision tags', tags)
        const timeHint = `${takenAt.getHours().toString().padStart(2, '0')}:${takenAt.getMinutes().toString().padStart(2, '0')}`
        const { memo, source } = await generateActivityMemo(tags, { timeHint })
        if (memo) console.log('[capture] on-device memo', memo, `(${source})`)
        return { tags, activity: memo, source }
      })()
      const [geo, { tags, activity, source }] = await Promise.all([getGeo(), visionThenMemo])
      // 'none' means the device couldn't produce a memo (no tags); the function
      // will fill it in and persist its own source ('cloud-stub') downstream.
      const memoSource = source === 'none' ? null : source
      setBusyMsg('업로드 중이에요…')
      await uploadPhoto({ uid, file, geo, takenAt, tags, activity, memoSource })
      setBusyMsg('AI가 활동을 적고 있어요…')
      // Function trigger does the rest; useEffect above will toast on memo arrival.
      // Show processing for a moment so it feels responsive even if function is fast.
      setTimeout(() => setBusy(false), 1500)
    } catch (err) {
      console.error(err)
      toast.show('업로드에 실패했어요', '잠시 후 다시 시도해주세요')
      setBusy(false)
    }
  }

  const recent = memos.slice(0, 8)

  return (
    <section className="page active">
      <div className="hero-greet">
        <span>{greeting(patientName)}</span>
        <small>지금 이 순간을 한 번에 담아보세요.</small>
      </div>

      <div className="capture-wrap">
        <button
          className="capture"
          aria-label="사진 찍기"
          onClick={async () => {
            if (isNativeApp) {
              try {
                const { file, path } = await captureNativePhoto()
                onPick(file, path)
              } catch (err) {
                // User cancelled the camera or denied permission.
                console.warn('[capture] native camera cancelled or failed', err)
              }
            } else {
              inputRef.current?.click()
            }
          }}
        >
          <div className="ico">📷</div>
          <div>사진 찍기</div>
          <div className="sub">크게 한 번 눌러주세요</div>
        </button>
        {/* Secondary action: search past memos. Smaller + neutral tone so it
            doesn't compete with the orange capture button — guardians use it,
            not the patient. */}
        <button
          className="ask-trigger"
          aria-label="찾아보기"
          onClick={() => setAsking(true)}
        >
          <div className="ico">🔎</div>
          <div>물어보기</div>
          <div className="sub">날짜·활동 검색</div>
        </button>
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

      <div className="hint">사진을 찍으면 시간 · 장소 · 활동이 자동으로 저장돼요.</div>

      <div className="recent-title">최근 사진</div>
      {recent.length === 0 ? (
        <div className="empty-recent">아직 사진이 없어요.</div>
      ) : (
        <div className="recent-row">
          {recent.map((m) => (
            <button
              type="button"
              className="recent recent-btn"
              key={m.id}
              onClick={() => onOpen(m.id)}
              aria-label="자세히 보기"
            >
              {m.photoUrl ? (
                <img className="thumb" src={m.photoUrl} alt="" />
              ) : (
                <div className="thumb" style={{ background: '#eee' }} />
              )}
              <span
                className="del-btn"
                role="button"
                aria-label="사진 삭제"
                onClick={(e) => {
                  e.stopPropagation()
                  if (!confirm('이 사진을 삭제할까요?')) return
                  deleteMemo({ memoId: m.id, photoPath: m.photoPath }).catch((err) => {
                    console.error(err)
                    toast.show('삭제에 실패했어요', '잠시 후 다시 시도해주세요')
                  })
                }}
              >
                ✕
              </span>
              <div className="meta">
                <b>{fmtTime(m.takenAt.toDate())}</b>
                {m.activity || (m.status === 'pending' ? '메모 작성 중…' : '')}
              </div>
            </button>
          ))}
        </div>
      )}

      <Processing show={busy} message={busyMsg} />
      {asking && (
        <Ask
          memos={memos}
          onClose={() => setAsking(false)}
          onOpen={onOpen}
        />
      )}
    </section>
  )
}
