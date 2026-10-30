import { useEffect, useState } from 'react'
import { ref, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'
import { categoryThumbClass } from '../lib/categoryStyle'
import { listPhoto } from '../lib/listPhoto'
import { pendingRotation, rotateStyle } from '../lib/photoRotate'
import { useSettledPhoto } from '../hooks/useSettledPhoto'
import type { Memo } from '../types'

/**
 * Square memo thumbnail used on Today / Ask / Home.
 *
 * Prefers the denormalized `photoUrl` written by the Mac mini worker. When that's
 * missing (older docs, re-analyzed/backfilled memos), it falls back to resolving
 * a fresh download URL from `photoPath` via the Storage SDK so the photo still
 * shows instead of a bare category-gradient block. Only blanks pay the extra
 * lookup; memos that already carry a photoUrl render immediately.
 */
export function MemoThumb({ memo, showLocation = false }: { memo: Memo; showLocation?: boolean }) {
  const small = listPhoto(memo)
  const [url, setUrl] = useState(small)

  useEffect(() => {
    if (small) { setUrl(small); return }
    if (!memo.photoPath) { setUrl(''); return }
    let alive = true
    getDownloadURL(ref(storage, memo.photoPath))
      .then((u) => { if (alive) setUrl(u) })
      .catch(() => { /* leave the gradient fallback in place */ })
    return () => { alive = false }
  }, [small, memo.photoPath])
  // A replaced file (a baked rotation) swaps in only once loaded: no blank tile.
  const photo = useSettledPhoto(url, pendingRotation(memo))

  return (
    <div className={`tl-thumb ${url ? '' : categoryThumbClass(memo.activity)}`}>
      {/* A thumbnail that won't load (removed by hand, say) gives way to the full photo. */}
      {url && photo.src && <img src={photo.src} alt="" style={rotateStyle(photo.rotation)} onError={() => { if (memo.photoUrl && url !== memo.photoUrl) setUrl(memo.photoUrl) }} />}
      {showLocation && memo.place && <span className="rt-loc">{memo.place}</span>}
    </div>
  )
}
