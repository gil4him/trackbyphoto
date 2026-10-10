// Where a parent's phone gets the simple edition's app (the /pair link page,
// PairLanding). Both stores list one app id, com.zymer.daylie.

export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.zymer.daylie'
/** Empty until the App Store record exists (VITE_APPSTORE_URL). */
export const APP_STORE_URL = (import.meta.env.VITE_APPSTORE_URL as string | undefined) || ''

export type StoreKind = 'ios' | 'android' | 'other'

export function storeKind(ua: string): StoreKind {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'other'
}

/** The store page for this phone, or null (a computer, or no App Store link yet). */
export function storeUrlFor(kind: StoreKind, appStoreUrl = APP_STORE_URL): string | null {
  if (kind === 'android') return PLAY_STORE_URL
  if (kind === 'ios') return appStoreUrl || null
  return null
}
