/**
 * The hosted web app this worker makes links for (pair, push, digest).
 * Full: https://trackbyphoto.web.app (default). The simple-core worker sets
 * APP_URL=https://dayliesimple.web.app. No trailing slash.
 */
export const APP_URL = (process.env.APP_URL || 'https://trackbyphoto.web.app').replace(/\/+$/, '')

/**
 * The store pages a parent's phone opens from the family's app-update notice
 * (handlers/device.ts sendUpdateNudge).
 */
export const APP_STORE_URL = process.env.APP_STORE_URL || 'https://apps.apple.com/app/id6821605732'
export const PLAY_STORE_URL = process.env.PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=com.zymer.daylie'

/**
 * Which product this worker serves (simple/Daylie-v3-Simple-Core.md). The
 * simple-core worker sets EDITION=simple: an evening photo count on top of
 * the per-photo notices (handlers/dailyNotice.ts). Anything else is full. Read on
 * each call so tests can switch it.
 */
export function edition(): 'full' | 'simple' {
  return process.env.EDITION === 'simple' ? 'simple' : 'full'
}
