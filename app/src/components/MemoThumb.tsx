import { useEffect, useState } from 'react'
import { ref, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'
import { categoryThumbClass } from '../lib/categoryStyle'
import type { Memo } from '../types'

/**
 * Square memo thumbnail used on Today / Ask / Home.
 *
 * Prefers the denormalized `photoUrl` written by the Cloud Function. When that's
 * missing (older docs, re-analyzed/backfilled memos), it falls back to resolving
 * a fresh download URL from `photoPath` via the Storage SDK so the photo still
 * shows instead of a bare category-gradient block. Only blanks pay the extra
 * lookup; memos that already carry a photoUrl render immediately.
 */
export function MemoThumb({ memo, showLocation = false }: { memo: Memo; showLocation?: boolean }) {
  const [url, setUrl] = useState(memo.photoUrl || '')

  useEffect(() => {
    if (memo.photoUrl) { setUrl(memo.photoUrl); return }
    if (!memo.photoPath) { setUrl(''); return }
    let alive = true
    getDownloadURL(ref(storage, memo.photoPath))
      .then((u) => { if (alive) setUrl(u) })
      .catch(() => { /* leave the gradient fallback in place */ })
    return () => { alive = false }
  }, [memo.photoUrl, memo.photoPath])

  return (
    <div className={`tl-thumb ${url ? '' : categoryThumbClass(memo.activity)}`}>
      {url && <img src={url} alt="" />}
      {showLocation && memo.place && <span className="rt-loc">{memo.place}</span>}
    </div>
  )
}
