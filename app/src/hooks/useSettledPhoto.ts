import { useEffect, useState } from 'react'
import { quarter, type Quarter } from '../lib/photoRotate'
import type { Size } from '../lib/photoZoom'

/**
 * A photo whose stored file gets replaced (the worker baked a rotation into
 * it, handlers/rotate.ts, and the download link changed) must not blank out
 * while the new file downloads (owner, 2026-10-30). The old file stays on
 * screen, turned as it was, until the new one has loaded; then both swap in
 * the same render.
 *
 * `rotation` is the turn still to show on the *wanted* file. While the old
 * one is still up, it is shown turned by what it needed last plus any new
 * taps. `size` is the new file's natural size once it has loaded (null before
 * the first swap, or when it would not load).
 */
export function useSettledPhoto(src: string, rotation: number): { src: string; rotation: Quarter; size: Size | null } {
  const wanted = quarter(rotation)
  // `rotation` here: the turn the shown file needed while it was the wanted one.
  const [shown, setShown] = useState<{ src: string; size: Size | null; rotation: Quarter }>({ src, size: null, rotation: wanted })
  const swapping = src !== shown.src
  if (!swapping && shown.rotation !== wanted) setShown({ ...shown, rotation: wanted })
  // Nothing to wait for when the photo goes away.
  if (swapping && !src) setShown({ src, size: null, rotation: 0 })

  useEffect(() => {
    if (!src || src === shown.src) return
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (!alive) return
      const ok = img.naturalWidth > 0 && img.naturalHeight > 0
      setShown({ src, size: ok ? { w: img.naturalWidth, h: img.naturalHeight } : null, rotation: 0 })
    }
    img.onerror = () => { if (alive) setShown({ src, size: null, rotation: 0 }) }
    img.src = src
    return () => { alive = false }
  }, [src, shown.src])

  return {
    src: shown.src,
    rotation: swapping ? quarter(shown.rotation + rotation) : wanted,
    size: shown.size,
  }
}
