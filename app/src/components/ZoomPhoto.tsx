import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { rotateStyle, rotatedSize } from '../lib/photoRotate'
import {
  clampPan, clampScale, distance, doubleTapTarget, fitBox, isDoubleTap, midpoint, pinch, touchAction, zoomAbout,
  type Point, type Size,
} from '../lib/photoZoom'
import { tr } from '../lib/lang'

/**
 * The photo on its own page (owner decision, 2026-10-30): pinch, double-tap
 * and pan to look closer (view only, nothing saved), and ↻ for those who may
 * turn it (`canRotate`). `rotation` is how far the photo still has to be
 * turned on screen (a rotation not yet saved into the stored photo).
 *
 * Until the photo and its box are measured (and when rendered on the
 * server), the photo is drawn as before: full width, at most 75vh tall.
 * Remount it (`key`) to reset the zoom; ↻ resets it too.
 */
export function ZoomPhoto({ src, rotation, canRotate, onRotate, alt = '' }: {
  src: string
  rotation: number
  canRotate: boolean
  onRotate: () => void
  alt?: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [maxH, setMaxH] = useState(0)
  const [natural, setNatural] = useState<Size | null>(null)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })

  // The container's width, and 75% of the screen's height. A ResizeObserver
  // reports once as soon as it starts watching.
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      setWidth(el.clientWidth)
      setMaxH(Math.round(window.innerHeight * 0.75))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  const shown = natural ? rotatedSize(natural.w, natural.h, rotation) : null
  // The box follows the turned photo's shape: full width, at most 75vh.
  const height = shown && width ? Math.min(maxH || Infinity, (width * shown.h) / shown.w) : 0
  const container: Size = { w: width, h: height }
  const box = shown && height ? fitBox(container, shown) : null
  const measured = !!box && box.w > 0
  // Kept inside the photo even when the box changes under a zoom (a turn
  // made on another phone, a resize).
  const view = { scale, pan: box ? clampPan(pan, scale, box, container) : { x: 0, y: 0 } }

  // Gesture state lives in refs: pointer events come faster than renders.
  const live = useRef(view)
  const geo = useRef({ box, container })
  useLayoutEffect(() => {
    live.current = view
    geo.current = { box, container }
  })
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<null | { kind: 'pan'; start: Point; pan: Point } | { kind: 'pinch'; dist: number; mid: Point; scale: number; pan: Point }>(null)
  const tap = useRef<{ p: Point; moved: boolean; down: number } | null>(null)
  const lastTap = useRef<{ at: number; p: Point } | null>(null)

  // Two fingers or a zoomed photo: the page must not scroll or zoom itself.
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2 || live.current.scale > 1) e.preventDefault()
    }
    const onGesture = (e: Event) => e.preventDefault() // iOS Safari's own pinch
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('gesturestart', onGesture)
    return () => {
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('gesturestart', onGesture)
    }
  }, [])

  /** A pointer's position from the container's centre. */
  const local = (e: ReactPointerEvent): Point => {
    const r = boxRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }
  }
  const apply = (nextScale: number, nextPan: Point) => {
    const { box: b, container: c } = geo.current
    const s = clampScale(nextScale)
    const p = b ? clampPan(nextPan, s, b, c) : { x: 0, y: 0 }
    live.current = { scale: s, pan: p }
    setScale(s)
    setPan(p)
  }
  const startGesture = () => {
    const pts = [...pointers.current.values()]
    const { scale: s, pan: p } = live.current
    if (pts.length >= 2) gesture.current = { kind: 'pinch', dist: distance(pts[0], pts[1]), mid: midpoint(pts[0], pts[1]), scale: s, pan: p }
    else if (pts.length === 1) gesture.current = { kind: 'pan', start: pts[0], pan: p }
    else gesture.current = null
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!measured) return
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    if (pointers.current.size === 1) tap.current = { p, moved: false, down: e.timeStamp }
    else tap.current = null
    if (pointers.current.size >= 2 || live.current.scale > 1) e.currentTarget.setPointerCapture?.(e.pointerId)
    startGesture()
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    if (tap.current && distance(tap.current.p, p) > 10) tap.current.moved = true
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pinch') {
      const pts = [...pointers.current.values()]
      if (pts.length < 2) return
      const mid = midpoint(pts[0], pts[1])
      const next = pinch(g.scale, g.dist, distance(pts[0], pts[1]))
      const about = zoomAbout(g.scale, g.pan, next, g.mid)
      apply(next, { x: about.x + mid.x - g.mid.x, y: about.y + mid.y - g.mid.y })
    } else if (live.current.scale > 1) {
      apply(live.current.scale, { x: g.pan.x + p.x - g.start.x, y: g.pan.y + p.y - g.start.y })
    }
  }
  const onPointerEnd = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    const p = pointers.current.get(e.pointerId)!
    pointers.current.delete(e.pointerId)
    const t = tap.current
    tap.current = null
    if (e.type === 'pointerup' && t && !t.moved && pointers.current.size === 0 && e.timeStamp - t.down < 300) {
      const prev = lastTap.current
      if (prev && isDoubleTap(prev.at, e.timeStamp, distance(prev.p, p))) {
        lastTap.current = null
        const { scale: s, pan: cur } = live.current
        const target = doubleTapTarget(s)
        apply(target, target === 1 ? { x: 0, y: 0 } : zoomAbout(s, cur, target, p))
      } else {
        lastTap.current = { at: e.timeStamp, p }
      }
    }
    startGesture()
  }

  const turn = rotation ? ` rotate(${rotation}deg)` : ''
  // The img's own box is the photo's unturned shape; turned, it fills `box`.
  const sideways = rotation === 90 || rotation === 270
  const imgW = box ? (sideways ? box.h : box.w) : 0
  const imgH = box ? (sideways ? box.w : box.h) : 0

  return (
    <div
      ref={boxRef}
      className={`detail-photo has-img zoom${measured ? ' measured' : ''}`}
      style={measured ? { height, touchAction: touchAction(scale) } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(e) => {
          const el = e.currentTarget
          if (el.naturalWidth && el.naturalHeight) setNatural({ w: el.naturalWidth, h: el.naturalHeight })
        }}
        style={measured
          ? {
            width: imgW, height: imgH, left: (width - imgW) / 2, top: (height - imgH) / 2,
            transform: `translate(${view.pan.x}px, ${view.pan.y}px) scale(${scale})${turn}`,
          }
          : rotateStyle(rotation)}
      />
      {canRotate && (
        <button
          type="button"
          className="photo-rotate"
          aria-label={tr('사진 돌리기', 'Rotate photo')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => { apply(1, { x: 0, y: 0 }); onRotate() }}
        >↻</button>
      )}
    </div>
  )
}
