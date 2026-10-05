import { useEffect, useState } from 'react'
import { DIGEST_TILES, loadDigest, loadDigestMemos, placesVisited, repliesSummary } from '../lib/digest'
import { TrailSketch } from '../components/TrailSketch'
import { trailStops } from '../lib/trail'
import type { Digest, Memo } from '../types'

const TITLE: Record<Digest['kind'], string> = { daily: '오늘 하루', weekly: '이번 주 하이라이트', monthly: '지난달 앨범' }

/** What the page shows once the digest is loaded (kept apart so it can be rendered in tests). */
export function DigestView({ digest, memos, onOpenMemo, onMore, onOpenTrail }: {
  digest: Digest
  memos: Memo[]
  onOpenMemo: (memoId: string) => void
  onMore: () => void
  /** Opens 다녀온 곳 for the digest's period; without it the places are only listed. */
  onOpenTrail?: () => void
}) {
  const more = digest.photoCount - memos.length
  const replies = repliesSummary(digest.replies)
  const places = placesVisited(memos)
  // A sketch of the route, never a map: opening a digest makes no map request.
  const stops = onOpenTrail ? trailStops(memos, null) : []
  return (
    <>
      <div className="h-eyebrow">{digest.label} · 사진 {digest.photoCount}장</div>
      <h2 className="h-title">{digest.patientName}님의 {TITLE[digest.kind]}</h2>

      <p className="dg-summary">{digest.summary}</p>

      {memos.length > 0 && (
        <div className="dg-grid">
          {memos.map((m) => (
            <button key={m.id} type="button" className="dg-tile" onClick={() => onOpenMemo(m.id)} aria-label={m.memo || '사진'}>
              {m.photoUrl ? <img src={m.photoUrl} alt="" loading="lazy" /> : <span className="dg-tile-empty" />}
            </button>
          ))}
        </div>
      )}
      {more > 0 && <button type="button" className="dg-more" onClick={onMore}>+ {more}장 더 보기</button>}

      {replies && (
        <div className="sect">
          <div className="sect-lab">{digest.patientName}님의 답장</div>
          <div className="dg-replies">
            <div><b>{replies}</b></div>
            {[...(digest.replies.texts ?? []), ...digest.replies.transcripts].map((t, i) => <div key={i} className="dg-quote">“{t}”</div>)}
          </div>
        </div>
      )}

      {(places.length > 0 || stops.length > 0) && (
        <div className="sect">
          <div className="sect-lab">다녀온 곳</div>
          {onOpenTrail && stops.length > 0 ? (
            <button type="button" className="dg-trail" onClick={onOpenTrail} aria-label="다녀온 곳 지도 보기">
              <TrailSketch stops={stops} />
              {places.length > 0 && <div className="dg-places">{places.join(' → ')}</div>}
            </button>
          ) : (
            <div className="dg-places">{places.join(' → ')}</div>
          )}
        </div>
      )}

      <div className="dg-foot">오늘하루 · Daylie AI</div>
    </>
  )
}

/**
 * The page a digest link opens (push, e-mail, message, or the 알림 list):
 * the summary, the first photos, and what the parent answered.
 */
export function DigestPage({ digestId, knownMemos, onBack, onOpenMemo, onMore, onOpenTrail }: {
  digestId: string
  /** Memos already loaded in the app; the rest are fetched. */
  knownMemos: Memo[]
  onBack: () => void
  onOpenMemo: (digest: Digest, memoId: string) => void
  onMore: (digest: Digest) => void
  onOpenTrail?: (digest: Digest) => void
}) {
  const [state, setState] = useState<{ id: string; digest: Digest | null; memos: Memo[] } | null>(null)

  useEffect(() => {
    let live = true
    loadDigest(digestId).then(async (digest) => {
      const memos = digest ? await loadDigestMemos(digest, knownMemos, DIGEST_TILES) : []
      if (live) setState({ id: digestId, digest, memos })
    })
    return () => { live = false }
    // The photos are fetched once per digest; later memo updates don't matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digestId])

  const loaded = state && state.id === digestId ? state : null
  return (
    <section className="page dg">
      <button className="back" onClick={onBack} aria-label="뒤로가기">‹ 뒤로</button>
      {!loaded ? (
        <div className="empty"><div>요약을 불러오는 중…</div></div>
      ) : !loaded.digest ? (
        <div className="empty">
          <div>요약을 열 수 없어요.</div>
          <div className="help">가족으로 연결된 계정으로 로그인했는지 확인해 주세요.</div>
        </div>
      ) : (
        <DigestView
          digest={loaded.digest}
          memos={loaded.memos}
          onOpenMemo={(memoId) => onOpenMemo(loaded.digest!, memoId)}
          onMore={() => onMore(loaded.digest!)}
          onOpenTrail={onOpenTrail ? () => onOpenTrail(loaded.digest!) : undefined}
        />
      )}
    </section>
  )
}
