/**
 * Pinch, double-tap and pan on a photo's page (view only; owner decision,
 * 2026-10-30). Pure geometry for components/ZoomPhoto.tsx. Offsets are in
 * CSS px from the container's centre; the photo is drawn
 * `translate(pan) scale(scale)` about its centre.
 */

export interface Size { w: number; h: number }
export interface Point { x: number; y: number }

export const MIN_SCALE = 1
export const MAX_SCALE = 4
/** A double tap zooms to this, and back to 1 from anywhere above 1. */
export const DOUBLE_TAP_SCALE = 2.5
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30

/** The largest box of the picture's shape that fits the container (may enlarge). */
export function fitBox(container: Size, natural: Size): Size {
  if (natural.w <= 0 || natural.h <= 0 || container.w <= 0 || container.h <= 0) return { w: 0, h: 0 }
  const s = Math.min(container.w / natural.w, container.h / natural.h)
  return { w: natural.w * s, h: natural.h * s }
}

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/** Keep the zoomed picture covering the container: no empty edge pulled in. */
export function clampPan(pan: Point, scale: number, box: Size, container: Size): Point {
  const maxX = Math.max(0, (box.w * scale - container.w) / 2)
  const maxY = Math.max(0, (box.h * scale - container.h) / 2)
  const c = (v: number, m: number) => (m === 0 ? 0 : Math.min(m, Math.max(-m, v)))
  return { x: c(pan.x, maxX), y: c(pan.y, maxY) }
}

/** The pan that keeps the picture's point under `anchor` there while the scale changes. */
export function zoomAbout(scale: number, pan: Point, nextScale: number, anchor: Point): Point {
  const k = nextScale / scale
  return { x: anchor.x - (anchor.x - pan.x) * k, y: anchor.y - (anchor.y - pan.y) * k }
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** Two fingers moved from startDist apart to nowDist apart: the new scale. */
export function pinch(startScale: number, startDist: number, nowDist: number): number {
  if (startDist <= 0) return clampScale(startScale)
  return clampScale(startScale * (nowDist / startDist))
}

/** 1 → 2.5, anything zoomed → 1. */
export function doubleTapTarget(scale: number): number {
  return scale > MIN_SCALE + 0.01 ? MIN_SCALE : DOUBLE_TAP_SCALE
}

/** A second tap close in time and place to the first. */
export function isDoubleTap(prevTapMs: number | null, nowMs: number, dist: number): boolean {
  return prevTapMs != null && nowMs - prevTapMs >= 0 && nowMs - prevTapMs < DOUBLE_TAP_MS && dist < DOUBLE_TAP_PX
}

/** At 1 a finger scrolls the page; zoomed in, the photo takes every touch. */
export function touchAction(scale: number): 'pan-y' | 'none' {
  return scale > MIN_SCALE + 0.01 ? 'none' : 'pan-y'
}
