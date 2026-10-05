import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { MemoThumb } from '../components/MemoThumb'
import { albumMonths } from '../lib/plan'
import { loadVoiceReplies } from '../lib/planApi'
import { S } from '../lib/strings'
import { fmtTime } from '../util'
import type { Memo, Reaction } from '../types'

/** Photos fetched for the album beyond the ones the app already has. */
const MAX_FETCHED_PHOTOS = 60

/** The album once its replies are loaded (kept apart so it can be rendered in tests). */
export function VoiceAlbumView({ patientName, patientUid, voices, memoOf, onOpenMemo, canOpen }: {
  patientName: string
  patientUid: string
  voices: Reaction[]
  /** The photo a reply answered, when it is still kept. */
  memoOf: (memoId: string) => Memo | undefined
  onOpenMemo?: (memoId: string) => void
  /** Which photos the app can open; all of them when not given. */
  canOpen?: (memoId: string) => boolean
}) {
  const months = albumMonths(voices, patientUid)
  return (
    <>
      <div className="h-eyebrow">{patientName}님의 답장</div>
      <h2 className="h-title">{S.voiceAlbum}</h2>
      {months.length === 0 ? (
        <div className="empty">
          <div className="big">🎙️</div>
          <div>아직 음성 답장이 없어요.</div>
          <div className="help">{patientName}님이 목소리로 답장하면 여기에 모여요.</div>
        </div>
      ) : months.map((month) => (
        <div key={month.label}>
          <div className="q-datehdr">{month.label}</div>
          {month.items.map((r) => {
            const memo = memoOf(r.memoId)
            const when = new Date(r.createdAtMs)
            return (
              <div className="va-item" key={r.id}>
                {memo && (onOpenMemo && (canOpen?.(memo.id) ?? true)
                  ? <button type="button" className="va-photo" onClick={() => onOpenMemo(memo.id)} aria-label="답장한 사진 보기"><MemoThumb memo={memo} /></button>
                  : <div className="va-photo"><MemoThumb memo={memo} /></div>)}
                <div className="va-body">
                  <div className="va-when">{when.getMonth() + 1}월 {when.getDate()}일 {fmtTime(when)}</div>
                  <audio controls preload="none" src={r.audioUrl} />
                  <div className="rx-transcript">{r.transcript ? `“${r.transcript}”` : S.voiceNoTranscript}</div>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}

/**
 * 목소리 앨범: every voice reply the parent has left, by month, each with
 * the photo it answered. Part of the plan that includes it; family only.
 */
export function VoiceAlbum({ patientUid, patientName, knownMemos, onBack, onOpenMemo }: {
  patientUid: string
  patientName: string
  /** Memos already loaded in the app; photos of older replies are fetched. */
  knownMemos: Memo[]
  onBack: () => void
  onOpenMemo: (memoId: string) => void
}) {
  const [state, setState] = useState<{ uid: string; voices: Reaction[]; fetched: Map<string, Memo> } | 'failed' | null>(null)

  useEffect(() => {
    let live = true
    const known = new Set(knownMemos.map((m) => m.id))
    loadVoiceReplies(patientUid).then(async (voices) => {
      const missing = [...new Set(voices.map((v) => v.memoId))].filter((id) => !known.has(id)).slice(0, MAX_FETCHED_PHOTOS)
      const fetched = new Map<string, Memo>()
      await Promise.all(missing.map(async (id) => {
        // A photo that is gone (deleted, or past what the plan keeps) simply has no thumbnail.
        const snap = await getDoc(doc(db, 'memos', id)).catch(() => null)
        if (snap?.exists()) fetched.set(id, { id, ...(snap.data() as Omit<Memo, 'id'>) })
      }))
      if (live) setState({ uid: patientUid, voices, fetched })
    }).catch((err) => {
      console.warn('[voice album] could not load', err)
      if (live) setState('failed')
    })
    return () => { live = false }
    // Loaded once per parent; photos that arrive later don't matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientUid])

  const loaded = state && state !== 'failed' && state.uid === patientUid ? state : null
  const known = new Map(knownMemos.map((m) => [m.id, m]))
  return (
    <section className="page">
      <button className="back" onClick={onBack} aria-label="뒤로가기">‹ 뒤로</button>
      {state === 'failed' ? (
        <div className="empty"><div>목소리 앨범을 열 수 없어요.</div><div className="help">잠시 후 다시 시도해 주세요.</div></div>
      ) : !loaded ? (
        <div className="empty"><div>불러오는 중…</div></div>
      ) : (
        <VoiceAlbumView
          patientName={patientName}
          patientUid={patientUid}
          voices={loaded.voices}
          memoOf={(id) => known.get(id) ?? loaded.fetched.get(id)}
          onOpenMemo={onOpenMemo}
          canOpen={(id) => known.has(id)}
        />
      )}
    </section>
  )
}
