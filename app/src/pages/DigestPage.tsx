import { useEffect, useState } from 'react'
import { DIGEST_TILES, loadDigest, loadDigestMemos, placesVisited, repliesSummary } from '../lib/digest'
import { TrailSketch } from '../components/TrailSketch'
import { trailStops } from '../lib/trail'
import type { Digest, Memo } from '../types'
import { honorific } from '../lib/people'
import { listPhoto } from '../lib/listPhoto'
import { tr } from '../lib/lang'

const TITLE: Record<Digest['kind'], string> = {
  daily: tr('오늘 하루', 'day'),
  weekly: tr('이번 주 하이라이트', 'week in photos'),
  monthly: tr('지난달 앨범', 'album from last month'),
}

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
      <div className="h-eyebrow">{digest.label} · {tr(`사진 ${digest.photoCount}장`, `${digest.photoCount} photos`)}</div>
      <h2 className="h-title">{tr(`${honorific(digest.patientName)}의 ${TITLE[digest.kind]}`, `${honorific(digest.patientName)}'s ${TITLE[digest.kind]}`)}</h2>

      {digest.title && <h3 className="dg-title">{digest.title}</h3>}
      <p className="dg-summary">{digest.summary}</p>

      {memos.length > 0 && (
        <div className="dg-grid">
          {memos.map((m) => (
            <button key={m.id} type="button" className="dg-tile" onClick={() => onOpenMemo(m.id)} aria-label={m.memo || tr('사진', 'Photo')}>
              {m.photoUrl ? <img src={listPhoto(m)} alt="" loading="lazy" /> : <span className="dg-tile-empty" />}
            </button>
          ))}
        </div>
      )}
      {more > 0 && <button type="button" className="dg-more" onClick={onMore}>{tr(`+ ${more}장 더 보기`, `+ ${more} more`)}</button>}

      {replies && (
        <div className="sect">
          <div className="sect-lab">{tr(`${honorific(digest.patientName)}의 답장`, `${honorific(digest.patientName)}'s replies`)}</div>
          <div className="dg-replies">
            <div><b>{replies}</b></div>
            {[...(digest.replies.texts ?? []), ...digest.replies.transcripts].map((t, i) => <div key={i} className="dg-quote">“{t}”</div>)}
          </div>
        </div>
      )}

      {(places.length > 0 || stops.length > 0) && (
        <div className="sect">
          <div className="sect-lab">{tr('다녀온 곳', 'Places visited')}</div>
          {onOpenTrail && stops.length > 0 ? (
            <button type="button" className="dg-trail" onClick={onOpenTrail} aria-label={tr('다녀온 곳 지도 보기', 'See the places on a map')}>
              <TrailSketch stops={stops} />
              {places.length > 0 && <div className="dg-places">{places.join(' → ')}</div>}
            </button>
          ) : (
            <div className="dg-places">{places.join(' → ')}</div>
          )}
        </div>
      )}

      <div className="dg-foot">Daylie AI</div>
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
      <button className="back" onClick={onBack} aria-label={tr('뒤로가기', 'Back')}>{tr('‹ 뒤로', '‹ Back')}</button>
      {!loaded ? (
        <div className="empty"><div>{tr('요약을 불러오는 중…', 'Loading the summary…')}</div></div>
      ) : !loaded.digest ? (
        <div className="empty">
          <div>{tr('요약을 열 수 없어요.', "This summary can't be opened.")}</div>
          <div className="help">{tr('가족으로 연결된 계정으로 로그인했는지 확인해 주세요.', 'Please check that you signed in with the account linked to this family.')}</div>
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
