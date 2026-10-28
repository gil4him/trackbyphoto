// A parent's phone tells the worker which app version it runs (reportDevice),
// so family can see in Settings when it needs an update.

import { callWorker } from './worker'
import { lastReported, nativeAppInfo, rememberReported, shouldReport } from './appVersion'

/** Report this phone's version for `deviceId`. Never throws. */
export async function reportThisDevice(deviceId: string, now = Date.now()): Promise<void> {
  try {
    const info = await nativeAppInfo()
    if (!info || !shouldReport(lastReported(), info.version, now)) return
    await callWorker('reportDevice', { deviceId, version: info.version, build: info.build, platform: info.platform })
    rememberReported(info.version, now)
  } catch (err) {
    console.warn('[device] version not reported', err)
  }
}
