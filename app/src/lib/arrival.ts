// 어디서 들어왔나 (운영실 D11, owner decision 2026-10-26): at a family member's
// first sign-in the app stamps `arrival` on their own users doc — the
// platform the app runs on (ios / android / web) and, on the web, where the
// page came from (`?from=tester` on the tester link, else the referring
// site's host). Once per account, by the account itself (rules: isOwner +
// lastModifiedBy), never on a parent's phone. No third-party analytics.

import { Capacitor } from '@capacitor/core'
import { serverTimestamp } from 'firebase/firestore'

const KEY = 'daylie.arrival.ref'

export type ArrivalPlatform = 'ios' | 'android' | 'web'

/** The `from` / `utm_source` of the opening URL, else the referring site's host; null when neither. */
export function refFrom(search: string, referrer: string, ownHost: string): string | null {
  const q = new URLSearchParams(search)
  const from = (q.get('from') || q.get('utm_source') || '').trim().toLowerCase().slice(0, 40)
  if (from) return from
  try {
    const host = referrer ? new URL(referrer).hostname.replace(/^www\./, '').toLowerCase() : ''
    return host && host !== ownHost ? host.slice(0, 60) : null
  } catch {
    return null
  }
}

/** On the web, remember where this visit came from before sign-in sends the page away. First visit wins. */
export function noteArrivalRef(): void {
  if (Capacitor.isNativePlatform() || typeof window === 'undefined') return
  try {
    if (localStorage.getItem(KEY) !== null) return
    const ref = refFrom(location.search, document.referrer, location.hostname.replace(/^www\./, '').toLowerCase())
    if (ref) localStorage.setItem(KEY, ref)
  } catch {
    /* storage off: nothing to remember */
  }
}

export function platformNow(): ArrivalPlatform {
  const p = Capacitor.getPlatform()
  return p === 'ios' || p === 'android' ? p : 'web'
}

/** The stamp for users.arrival; takes the remembered ref with it so a second account on this browser starts clean. */
export function arrivalNow(): { platform: ArrivalPlatform; ref: string | null; at: ReturnType<typeof serverTimestamp> } {
  let ref: string | null = null
  try {
    ref = localStorage.getItem(KEY)
    localStorage.removeItem(KEY)
  } catch {
    /* storage off */
  }
  return { platform: platformNow(), ref: ref || null, at: serverTimestamp() }
}
