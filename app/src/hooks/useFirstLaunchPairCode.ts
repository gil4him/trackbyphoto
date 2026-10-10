import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { Clipboard } from '@capacitor/clipboard'
import { firstTimeOnly, pairCodeFromText } from '../lib/pairing'
import { referrerPairCode } from '../lib/installReferrer'

/**
 * A parent who installed the app from the family's link shouldn't have to
 * choose anything: on the app's first launch (signed out), look once for the
 * link's code — Play's install referrer on Android, then the link the /pair
 * page copied to the clipboard — and hand it to pairing. Each check runs once
 * per phone (firstTimeOnly), so iOS's 붙여넣기 허용 question comes at most
 * once.
 */
export function useFirstLaunchPairCode(enabled: boolean, onCode: (code: string) => void): void {
  const handOver = useRef(onCode)
  useEffect(() => { handOver.current = onCode }, [onCode])

  useEffect(() => {
    if (!enabled || !Capacitor.isNativePlatform()) return
    let found = false
    const take = (code: string | null) => {
      if (!code || found) return
      found = true
      handOver.current(code)
    }
    void (async () => {
      if (firstTimeOnly('tbp.pair.referrerChecked')) take(await referrerPairCode())
      if (!found && firstTimeOnly('tbp.pair.clipboardChecked')) {
        try {
          take(pairCodeFromText((await Clipboard.read()).value ?? ''))
        } catch {
          // Empty clipboard, or pasting not allowed.
        }
      }
    })()
  }, [enabled])
}
