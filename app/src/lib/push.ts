// Push notifications for family, on the website (Firebase Cloud Messaging).
//
// A browser can receive pushes once the person allows notifications; on an
// iPhone the site must first be on the home screen. The device's token is
// handed to the worker (registerFcmToken), which keeps it where no client can
// read it. The installed iOS/Android apps don't have this yet.
//
// Never called for a parent's linked phone: they get no permission prompt.

import { Capacitor } from '@capacitor/core'
import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging'
import { app } from '../firebase'
import { isStandalone } from './install'
import { callWorker } from './worker'

export type PushState =
  | 'unsupported'    // this browser or app can't receive pushes
  | 'needs-install'  // iPhone: add to the home screen first
  | 'off'            // can be switched on
  | 'on'
  | 'blocked'        // notifications were refused in the browser's settings

const TOKEN_KEY = 'tbp.push.token'
const SW_URL = '/push-sw.js'
const SW_SCOPE = '/push/'
// Optional: the project's own Web Push key. Without it the SDK uses FCM's default.
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined

const remembered = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }
const remember = (token: string | null) => {
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY) } catch { /* private mode */ }
}

export async function pushState(): Promise<PushState> {
  if (Capacitor.isNativePlatform()) return 'unsupported'
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent)
  if (ios && !isStandalone()) return 'needs-install'
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !(await isSupported().catch(() => false))) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  return Notification.permission === 'granted' && remembered() ? 'on' : 'off'
}

async function currentToken(): Promise<string> {
  const registration = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE })
  return getToken(getMessaging(app), { serviceWorkerRegistration: registration, ...(VAPID_KEY ? { vapidKey: VAPID_KEY } : {}) })
}

/** Switch pushes on for this device. Call from a tap: it may ask permission. */
export async function enablePush(): Promise<PushState> {
  const state = await pushState()
  if (state !== 'off' && state !== 'on') return state
  if ((await Notification.requestPermission()) !== 'granted') return Notification.permission === 'denied' ? 'blocked' : 'off'
  const token = await currentToken()
  await callWorker('registerFcmToken', { token })
  remember(token)
  return 'on'
}

/** On app start: if this device has pushes on, make sure the worker has its
 *  current token (browsers rotate them). Never asks permission. */
export async function refreshPush(): Promise<void> {
  if ((await pushState()) !== 'on') return
  try {
    const token = await currentToken()
    if (token !== remembered()) {
      await callWorker('registerFcmToken', { token })
      remember(token)
    }
  } catch (err) {
    console.warn('[push] token refresh failed', err)
  }
}

/** Switch pushes off for this device (settings toggle, or signing out). */
export async function disablePush(): Promise<void> {
  const token = remembered()
  remember(null)
  if (!token) return
  await callWorker('registerFcmToken', { token, remove: true }).catch((err) => console.warn('[push] token not removed on the server', err))
  await deleteToken(getMessaging(app)).catch(() => {})
}
