// A parent's phone tells the worker which app version it runs and whether it
// can get alerts (reportDevice), so family can see in Settings when it needs
// an update or its alerts are off.

import { callWorker } from './worker'
import { lastReported, nativeAppInfo, rememberReported, shouldReport } from './appVersion'
import { notificationPermission } from './permissions'
import { refreshElderPush } from './push'

type AlertState = 'on' | 'off' | 'not-asked' | 'no-token'

/** Report this phone's version and alert state for `deviceId`. Never throws. */
export async function reportThisDevice(deviceId: string, alerts?: AlertState, now = Date.now()): Promise<void> {
  try {
    const info = await nativeAppInfo()
    if (!info || !shouldReport(lastReported(), info.version, now, alerts)) return
    await callWorker('reportDevice', { deviceId, version: info.version, build: info.build, platform: info.platform, ...(alerts ? { alerts } : {}) })
    rememberReported(info.version, now, alerts)
  } catch (err) {
    console.warn('[device] version not reported', err)
  }
}

/** On open and every return to the app: keep the worker's token current, then
 *  report. Never asks the phone's question. */
export async function syncThisDevice(deviceId: string): Promise<void> {
  const permission = await notificationPermission()
  const alerts = permission === 'granted' ? await refreshElderPush(deviceId)
    : permission === 'denied' ? 'off'
    : permission === 'prompt' ? 'not-asked'
    : undefined
  await reportThisDevice(deviceId, alerts)
}
