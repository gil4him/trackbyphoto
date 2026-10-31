// When this person last looked at their day, so a parent's photos from since
// then stay in view (lib/diary.ts). The answer holds for the whole visit: a new
// photo doesn't fold away on a tab switch, only the next time the app is opened
// or returned to. Kept per device.

import { useEffect, useSyncExternalStore } from 'react'

const KEY = 'tbp.parents.seenAt'

let seenAt: number | null = null
let pagesOpen = 0
let watching = false
const listeners = new Set<() => void>()

const stored = () => {
  try { return Number(localStorage.getItem(KEY)) || null } catch { return null }
}
const markSeen = () => {
  try { localStorage.setItem(KEY, String(Date.now())) } catch { /* private mode */ }
}
const beginVisit = () => { seenAt = stored() ?? Date.now() }

function getSeenAt(): number {
  if (seenAt === null) beginVisit()
  return seenAt as number
}

function subscribe(listener: () => void) {
  if (!watching) {
    watching = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      beginVisit()
      listeners.forEach((l) => l())
      if (pagesOpen > 0) markSeen()
    })
  }
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** For a page showing a parent's photos. Opening it counts as having looked. */
export function useParentsSeenAt(): number {
  const at = useSyncExternalStore(subscribe, getSeenAt, getSeenAt)
  useEffect(() => {
    pagesOpen += 1
    markSeen()
    return () => { pagesOpen -= 1 }
  }, [])
  return at
}
