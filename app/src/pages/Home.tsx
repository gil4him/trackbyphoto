import { useEffect, useRef, useState } from 'react'
import { useToast } from '../components/Toast'
import { Processing } from '../components/Processing'
import { getGeo, uploadPhoto } from '../lib/capture'
import { fmtTime, greeting } from '../util'
import type { Memo } from '../types'

export function Home({ uid, patientName, memos }: { uid: string; patientName: string; memos: Memo[] }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [busyMsg, setBusyMsg] = useState('사진을 저장하고 있어요…')
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

  const onPick = async (file: File) => {
    setBusy(true)
    setBusyMsg('사진을 저장하고 있어요…')
    try {
      const takenAt = new Date()
      const geo = await getGeo()
      setBusyMsg('업로드 중이에요…')
      await uploadPhoto({ uid, file, geo, takenAt })
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
          onClick={() => inputRef.current?.click()}
        >
          <div className="ico">📷</div>
          <div>사진 찍기</div>
          <div className="sub">크게 한 번 눌러주세요</div>
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
            <div className="recent" key={m.id}>
              {m.photoUrl ? (
                <img className="thumb" src={m.photoUrl} alt="" />
              ) : (
                <div className="thumb" style={{ background: '#eee' }} />
              )}
              <div className="meta">
                <b>{fmtTime(m.takenAt.toDate())}</b>
                {m.activity || (m.status === 'pending' ? '메모 작성 중…' : '')}
              </div>
            </div>
          ))}
        </div>
      )}

      <Processing show={busy} message={busyMsg} />
    </section>
  )
}
