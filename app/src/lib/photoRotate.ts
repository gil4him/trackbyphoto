import type { CSSProperties } from 'react'
import type { Memo } from '../types'

/**
 * 사진 돌리기 (owner decision, 2026-10-30). `memo.rotation` is a pending
 * request: clockwise degrees the worker has not yet baked into the stored
 * photo (handlers/rotate.ts). Until it does, screens turn the photo with a
 * CSS transform; afterwards the field is gone and the pixels are upright.
 */

export type Quarter = 0 | 90 | 180 | 270

/** Any degrees → 0, 90, 180 or 270 (clockwise). */
export function quarter(deg: number): Quarter {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return 0
  return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as Quarter
}

/** How far the photo still has to be turned on screen. */
export function pendingRotation(memo: Pick<Memo, 'rotation'>): Quarter {
  return typeof memo.rotation === 'number' ? quarter(memo.rotation) : 0
}

/** A w×h picture turned by deg: its footprint (sides swap on a quarter turn). */
export function rotatedSize(w: number, h: number, deg: number): { w: number; h: number } {
  const q = quarter(deg)
  return q === 90 || q === 270 ? { w: h, h: w } : { w, h }
}

/** The CSS turn for a pending rotation; none when there is nothing to turn. */
export function rotateStyle(deg: number): CSSProperties | undefined {
  const q = quarter(deg)
  return q ? { transform: `rotate(${q}deg)` } : undefined
}
