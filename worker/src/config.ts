/**
 * The hosted web app this worker makes links for (pair, push, digest).
 * Full: https://trackbyphoto.web.app (default). The simple-core worker sets
 * APP_URL=https://dayliesimple.web.app. No trailing slash.
 */
export const APP_URL = (process.env.APP_URL || 'https://trackbyphoto.web.app').replace(/\/+$/, '')
