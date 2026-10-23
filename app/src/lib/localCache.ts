// The Firestore copy kept on the phone (firebase.ts persistentLocalCache), so
// pages show the last data at once instead of waiting for the server. It
// belongs to one account: before another account signs in on the same
// phone, or once an account is deleted, it is dropped and the page starts
// again, so nothing of one account is ever shown to the next.

import { clearIndexedDbPersistence, terminate } from 'firebase/firestore'
import { db } from '../firebase'

const OWNER_KEY = 'tbp.cacheOwner'

/** Drop the kept copy and start the page again (at `to`, else where it is,
 *  except a /pair link, whose code is spent by then). */
export async function dropLocalCache(to?: string): Promise<void> {
  try { localStorage.removeItem(OWNER_KEY) } catch { /* storage blocked */ }
  try {
    await terminate(db)
    await clearIndexedDbPersistence(db)
  } catch (err) {
    console.warn('[cache] could not clear the kept copy', err)
  }
  window.location.replace(to ?? (window.location.pathname.startsWith('/pair') ? '/' : window.location.href))
}

/** Whose data the kept copy holds. */
export function cacheOwner(): string | null {
  try { return localStorage.getItem(OWNER_KEY) } catch { return null }
}

/**
 * Called for each signed-in (not anonymous) account before anything reads
 * Firestore. True when the copy belongs to someone else and the page is
 * starting again without it; the caller then does nothing more.
 */
export async function claimLocalCache(uid: string): Promise<boolean> {
  const owner = cacheOwner()
  if (owner && owner !== uid) {
    await dropLocalCache()
    return true
  }
  if (owner !== uid) {
    try { localStorage.setItem(OWNER_KEY, uid) } catch { /* storage blocked */ }
  }
  return false
}
