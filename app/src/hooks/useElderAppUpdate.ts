// A parent's phone and its app version: report it and its alert state (on open
// and on every return to the app), open the store when the family's update notice is
// tapped, and say whether the store has a newer version (the banner).

import { useEffect, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { isBehind, nativeAppInfo, openStore, storeUrlForPlatform, type NativeAppInfo } from '../lib/appVersion'
import { syncThisDevice } from '../lib/deviceReport'
import { onPushOpened } from '../lib/push'
import { useStoreVersion } from './useStoreVersion'

/** The store page to open while this phone is behind, else null. */
export function useElderAppUpdate(deviceId: string, active: boolean): string | null {
  const [info, setInfo] = useState<NativeAppInfo | null>(null)
  useEffect(() => { void nativeAppInfo().then(setInfo) }, [])
  const latest = useStoreVersion(active && info !== null)

  useEffect(() => {
    if (!active || !info || !deviceId) return
    void syncThisDevice(deviceId)
    const handle = CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) void syncThisDevice(deviceId) })
    return () => { void handle.then((h) => h.remove()).catch(() => {}) }
  }, [active, info, deviceId])

  useEffect(() => {
    if (!active || !info) return
    return onPushOpened((d) => {
      if (d.type === 'app.update') openStore(d.storeUrl ?? storeUrlForPlatform(info.platform))
    })
  }, [active, info])

  return info && isBehind(info.version, latest[info.platform]) ? storeUrlForPlatform(info.platform) : null
}
