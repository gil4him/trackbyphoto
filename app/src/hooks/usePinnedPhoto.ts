import { useCallback, useState } from 'react'
import { followPhoto, pinnedTurn, startPin, type PhotoPin, type Quarter } from '../lib/photoRotate'

/**
 * The picture on screen is never reloaded because a rotation was saved
 * (owner, 2026-10-30): swapping in the worker's new file made the photo blink
 * however it was timed, since a phone decodes a new file after the swap. So
 * the file that first loaded stays up for as long as this component lives,
 * turned on screen as far as the turns made since; the saved file arrives the
 * next time the photo is opened.
 *
 * `rotation` is the turn still pending on the current `src`. `repin` gives up
 * the pinned file when it won't load (its link died): the current one follows.
 */
export function usePinnedPhoto(src: string, rotation: number): { src: string; rotation: Quarter; repin: () => void } {
  const [pin, setPin] = useState<PhotoPin | null>(() => startPin(src, rotation))
  const next = pin ? followPhoto(pin, src, rotation) : startPin(src, rotation)
  if (next !== pin) setPin(next)
  const repin = useCallback(() => setPin(null), [])
  return { src: next.pinned, rotation: pinnedTurn(next, rotation), repin }
}
