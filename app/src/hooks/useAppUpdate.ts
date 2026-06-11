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
