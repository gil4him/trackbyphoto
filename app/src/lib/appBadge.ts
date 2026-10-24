import { Capacitor } from '@capacitor/core'
import { Badge } from '@capawesome/capacitor-badge'
import { FirebaseMessaging } from '@capacitor-firebase/messaging'

/**
 * The number on the app icon: how many notices this person hasn't seen.
 * The store apps set it through the phone (the browser API below doesn't
 * exist in their web view); an installed home-screen web app uses the
 * browser's badge; a plain tab has no icon and does nothing here (the
 * favicon and the tab title are handled by the caller). Never throws.
 *
 * In the store apps, while the app is on screen, the notifications it left
 * in the phone's tray go too: they are what it now shows, and on many
 * Android phones (Samsung) the icon number is counted from the tray, so
 * reading something in the app would never bring the number down.
 */
export function setAppBadge(count: number, native = Capacitor.isNativePlatform()): void {
  if (native) {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void FirebaseMessaging.removeAllDeliveredNotifications().catch(() => {})
    }
    void (count > 0 ? Badge.set({ count }) : Badge.clear()).catch(() => {})
    return
  }
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  if (count > 0) nav.setAppBadge?.(count).catch(() => {})
  else nav.clearAppBadge?.().catch(() => {})
}
