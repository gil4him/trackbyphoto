import { useEffect, useState } from 'react'
import { reloadToLatest } from '../lib/sw'

// "A new version is live" detector — independent of the service worker.
//
// The website keeps its files on the phone (vite.config.ts), so the page a
// person is looking at may be older than what is deployed. We compare the
// hashed entry bundle we loaded against the one the server is serving now:
// poll index.html and diff the `assets/index-<hash>.js` filename. The request
// carries a query the service worker has no cached answer for and bypasses
// the HTTP cache, so it always reaches the server. When the name changes, a
// new build was deployed → prompt the user to reload (see reloadToLatest).

function entryBundle(html?: string): string {
  if (html === undefined) {
    const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')
    html = el?.src ?? ''
  }
  const m = html.match(/index-[A-Za-z0-9_-]+\.js/)
  return m ? m[0] : ''
}

/** Where to ask what is deployed; unique each time so no cache can answer. */
export const freshIndexUrl = (now = Date.now()) => `/index.html?fresh=${now}`

async function latestBundle(): Promise<string> {
  const res = await fetch(freshIndexUrl(), { cache: 'no-store' })
  if (!res.ok) return ''
  return entryBundle(await res.text())
}

/** Whether a newer build than the one running is deployed. False on error. */
export async function newerBuildDeployed(): Promise<boolean> {
  if (!import.meta.env.PROD) return false
  const current = entryBundle()
  if (!current) return false
  try {
    const latest = await latestBundle()
    return !!latest && latest !== current
  } catch {
    return false
  }
}

export function useAppUpdate(): boolean {
  const [updateReady, setUpdateReady] = useState(false)

  useEffect(() => {
    // Only meaningful against a real deployed build with hashed assets.
    if (!import.meta.env.PROD) return
    const current = entryBundle()
    if (!current) return

    let stopped = false
    const check = async () => {
      if (stopped || updateReady) return
      try {
        const latest = await latestBundle()
        if (!stopped && latest && latest !== current) setUpdateReady(true)
      } catch {
        /* offline / transient — try again next tick */
      }
    }
    const id = window.setInterval(check, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    check()

    return () => {
      stopped = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [updateReady])

  return updateReady
}

// Taking a photo on the website opens the phone's camera, which puts this
// page in the background; reloading on the way back would lose the photo.
const CAPTURE_GRACE_MS = 10 * 60 * 1000
let captureStartedAt = 0

/** Call when 사진 찍기 is tapped. */
export function noteCaptureStarted() {
  captureStartedAt = Date.now()
}

/** Whether coming back to the page now may be the camera handing over a photo. */
export function mayBeReturningFromCamera(now = Date.now()): boolean {
  return now - captureStartedAt < CAPTURE_GRACE_MS
}

/** At most one automatic reload per this long, so a reload can never loop. */
const AUTO_RELOAD_GAP_MS = 2 * 60 * 1000
const AUTO_RELOAD_KEY = 'tbp.autoReloadAt'

/** Whether an automatic reload may happen now (and remember that it did). */
export function mayAutoReload(now = Date.now(), storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.sessionStorage): boolean {
  try {
    const last = Number(storage?.getItem(AUTO_RELOAD_KEY) ?? 0)
    if (now - last < AUTO_RELOAD_GAP_MS) return false
    storage?.setItem(AUTO_RELOAD_KEY, String(now))
  } catch {
    // No storage: allow it; the gap can't be kept, but nothing breaks.
  }
  return true
}

/**
 * A parent's linked phone has no "새 버전이 있어요" button to tap (it has no
 * prompts at all), so it takes a new version by itself: right when the app
 * opens (the home-screen icon starts from the copy kept on the phone) and
 * each time the parent comes back to it — unless they are coming back from
 * the phone's camera. A photo still being sent stays in the on-phone outbox
 * and goes out after the reload.
 */
export function useReloadOnReturn(active: boolean) {
  useEffect(() => {
    if (!active) return
    let stopped = false
    const takeNewer = async () => {
      if (mayBeReturningFromCamera()) return
      if (!(await newerBuildDeployed()) || stopped) return
      if (mayAutoReload()) void reloadToLatest()
    }
    void takeNewer()
    const onVisible = () => { if (document.visibilityState === 'visible') void takeNewer() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active])
}
