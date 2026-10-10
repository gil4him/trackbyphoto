import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { pairCodeFromText } from '../lib/pairing'

/**
 * A /pair link that opened the native app (Universal Links on iOS, App Links
 * on Android): the one the app was started with, and any that arrive while
 * it runs. Only our own pairing links count (pairCodeFromText).
 */
export function useLaunchUrl(onPairCode: (code: string) => void): void {
  const onCode = useRef(onPairCode)
  useEffect(() => { onCode.current = onPairCode }, [onPairCode])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let alive = true
    const handle = (url: string | undefined) => {
      const code = url ? pairCodeFromText(url) : null
      if (code && alive) onCode.current(code)
    }
    CapApp.getLaunchUrl().then((res) => handle(res?.url)).catch(() => {})
    const sub = CapApp.addListener('appUrlOpen', ({ url }) => handle(url))
    return () => {
      alive = false
      void sub.then((h) => h.remove())
    }
  }, [])
}
