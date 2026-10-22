import { Capacitor } from '@capacitor/core'
import { Badge } from '@capawesome/capacitor-badge'

/**
 * The number on the app icon: how many notices this person hasn't seen.
 * The store apps set it through the phone (the browser API below doesn't
 * exist in their web view); an installed home-screen web app uses the
 * browser's badge; a plain tab has no icon and does nothing here (the
 * favicon and the tab title are handled by the caller). Never throws.
 */
export function setAppBadge(count: number, native = Capacitor.isNativePlatform()): void {
  if (native) {
    void (count > 0 ? Badge.set({ count }) : Badge.clear()).catch(() => {})
    return
  }
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  if (count > 0) nav.setAppBadge?.(count).catch(() => {})
  else nav.clearAppBadge?.().catch(() => {})
}
