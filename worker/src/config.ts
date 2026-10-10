/**
 * The hosted web app this worker makes links for (pair, push, digest).
 * Full: https://trackbyphoto.web.app (default). The simple-core worker sets
 * APP_URL=https://dayliesimple.web.app. No trailing slash.
 */
export const APP_URL = (process.env.APP_URL || 'https://trackbyphoto.web.app').replace(/\/+$/, '')

/**
 * Which product this worker serves (docs/Daylie-v3-Simple-Core.md). The
 * simple-core worker sets EDITION=simple: an evening photo count on top of
 * the per-photo notices (handlers/dailyNotice.ts). Anything else is full. Read on
 * each call so tests can switch it.
 */
export function edition(): 'full' | 'simple' {
  return process.env.EDITION === 'simple' ? 'simple' : 'full'
}
