import { useEffect, useState } from 'react'
import type { MemoByIdState } from '../hooks/useMemoById'

/** How long the placeholder waits before offering 다시 시도. */
export const SLOW_MS = 8000

/**
 * The photo page while a tapped notification's photo is on its way: the same
 * header and photo frame at once, so the tap is answered straight away.
 */
export function MemoOpeningView({ state, slow, onBack, onRetry, onPhotos }: {
  state: MemoByIdState
  slow: boolean
  onBack: () => void
  onRetry: () => void
  onPhotos: () => void
}) {
  const failed = state === 'error' || (slow && state !== 'missing')
  return (
    <section className="page detail" aria-busy={state === 'loading' || state === 'idle'}>
      <div className="detail-head">
        <button type="button" className="head-btn" onClick={onBack} aria-label="뒤로가기">‹</button>
        <div className="detail-head-when" />
        <span className="head-btn-space" aria-hidden="true" />
      </div>
      <div className="detail-photo memo-opening">
        <div className="detail-photo-empty">
          {state === 'missing' ? '이 사진은 볼 수 없어요' : failed ? '사진을 불러오지 못했어요' : '사진을 불러오는 중…'}
        </div>
      </div>
      {state === 'missing' ? (
        <button type="button" className="memo-opening-btn" onClick={onPhotos}>사진 보기</button>
      ) : failed ? (
        <button type="button" className="memo-opening-btn" onClick={onRetry}>다시 시도</button>
      ) : (
        <div className="memo-opening-lines" aria-hidden="true"><span /><span /></div>
      )}
    </section>
  )
}

export function MemoOpening({ state, onBack, onRetry, onPhotos }: {
  state: MemoByIdState
  onBack: () => void
  onRetry: () => void
  onPhotos: () => void
}) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_MS)
    return () => clearTimeout(t)
  }, [])
  return <MemoOpeningView state={state} slow={slow} onBack={onBack} onPhotos={onPhotos} onRetry={() => { setSlow(false); onRetry() }} />
}
