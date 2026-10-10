// Where a parent's phone gets the simple edition's app (the /pair link page,
// PairLanding). Both stores list one app id, com.zymer.daylie.

export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.zymer.daylie'
/** Empty until the App Store record exists (VITE_APPSTORE_URL). */
export const APP_STORE_URL = (import.meta.env.VITE_APPSTORE_URL as string | undefined) || ''
/** The app is live on Google Play (VITE_PLAY_LIVE=1). Until then Play answers
 *  "Item not found", so nothing links there. */
export const PLAY_LIVE = import.meta.env.VITE_PLAY_LIVE === '1'

/** Whether a phone of this kind can get the app from its store yet. */
export function inStore(kind: StoreKind, playLive = PLAY_LIVE, appStoreUrl = APP_STORE_URL): boolean {
  return kind === 'android' ? playLive : kind === 'ios' ? !!appStoreUrl : false
}

/** Either store has the app (decides what the KakaoTalk message asks for). */
export function inAnyStore(playLive = PLAY_LIVE, appStoreUrl = APP_STORE_URL): boolean {
  return playLive || !!appStoreUrl
}

export type StoreKind = 'ios' | 'android' | 'other'

export function storeKind(ua: string): StoreKind {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'other'
}

/**
 * The Play page carrying the pair code as the install referrer: Play hands it
 * to the app on its first launch (lib/installReferrer.ts), so a parent who
 * installs from the link is connected without copying or a second tap.
 */
export function playStoreUrl(code?: string): string {
  return code && code.length === 8 ? `${PLAY_STORE_URL}&referrer=${encodeURIComponent(`c=${code}`)}` : PLAY_STORE_URL
}

/** The store page for this phone, or null (a computer, or no App Store link yet). */
export function storeUrlFor(kind: StoreKind, appStoreUrl = APP_STORE_URL, code?: string, playLive = PLAY_LIVE): string | null {
  if (kind === 'android') return playLive ? playStoreUrl(code) : null
  if (kind === 'ios') return appStoreUrl || null
  return null
}
