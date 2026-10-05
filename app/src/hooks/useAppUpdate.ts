import { useEffect, useState } from 'react'

// "A new version is live" detector — service-worker-independent.
//
// The app ships a self-destroying SW (vite.config.ts) so there's no precache to
// hang an update event off of. Instead we compare the hashed entry bundle we
// loaded against the one the server is currently serving: poll index.html
// (bypassing the HTTP cache) and diff the `assets/index-<hash>.js` filename.
// When it changes, a new build was deployed → prompt the user to reload.

function entryBundle(html?: string): string {
  if (html === undefined) {
    const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')
    html = el?.src ?? ''
  }
  const m = html.match(/index-[A-Za-z0-9_-]+\.js/)
  return m ? m[0] : ''
}

async function latestBundle(): Promise<string> {
  const res = await fetch('/', { cache: 'no-store' })
  if (!res.ok) return ''
  return entryBundle(await res.text())
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

/**
 * A parent's linked phone has no "새 버전이 있어요" button to tap (it has no
 * prompts at all), so it takes a new version by itself: once one is ready,
 * the page reloads the next time the parent comes back to it, unless they
 * are coming back from the camera. A photo still being sent stays in the
 * on-phone outbox and goes out after the reload.
 */
export function useReloadOnReturn(active: boolean) {
  useEffect(() => {
    if (!active) return
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !mayBeReturningFromCamera()) window.location.reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [active])
}
