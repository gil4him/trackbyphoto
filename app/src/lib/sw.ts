// The website's service worker: keeps the app's own files on the phone so it
// opens at once (see vite.config.ts). Website only: the installed apps carry
// their files inside the app and must never be served a cached copy of an
// older build.

import { Capacitor } from '@capacitor/core'

const SW_URL = '/sw.js'
/** How long a reload waits for the new version to be fully on the phone. */
const INSTALL_WAIT_MS = 10_000

const supported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !Capacitor.isNativePlatform()

/** Call once at startup. */
export function registerAppCache() {
  if (!import.meta.env.PROD || !supported()) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(SW_URL, { scope: '/' }).catch((err) => console.warn('[sw] not registered', err))
  })
}

/** Resolves when `worker` has taken over (or given up), or after `ms`. */
function settled(worker: ServiceWorker, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const check = () => { if (worker.state === 'activated' || worker.state === 'redundant') resolve() }
    worker.addEventListener('statechange', check)
    check()
    setTimeout(resolve, ms)
  })
}

/**
 * Reload into the newest deployed version. A plain reload would be answered
 * from the files already on the phone, which may still be the old ones if
 * the new version hasn't finished arriving; so fetch it first, wait for it
 * to take over, then reload. Without a service worker this is just a reload.
 */
export async function reloadToLatest(): Promise<void> {
  try {
    const reg = supported() ? await navigator.serviceWorker.getRegistration('/') : undefined
    if (reg) {
      await reg.update()
      const incoming = reg.installing ?? reg.waiting
      if (incoming) await settled(incoming, INSTALL_WAIT_MS)
    }
  } catch (err) {
    console.warn('[sw] update before reload failed', err)
  }
  window.location.reload()
}
