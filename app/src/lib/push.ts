// Push notifications for family (Firebase Cloud Messaging), on the website
// and in the installed apps.
//
// A browser can receive pushes once the person allows notifications; on an
// iPhone the site must first be on the home screen. The installed apps ask
// through the phone's own permission question. Either way the device's FCM
// token is handed to the worker (registerFcmToken), which keeps it where no
// client can read it, and the worker sends one message to all of a person's
// devices.
//
// Never called for a parent's linked phone: they get no permission prompt
// and no token is ever made for them.

import { Capacitor } from '@capacitor/core'
import { FirebaseMessaging } from '@capacitor-firebase/messaging'
// The web push SDK is only needed once push is looked at, so it loads then
// rather than with the first screen.
const webMessaging = () => import('firebase/messaging')
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

const isNative = Capacitor.isNativePlatform()
// The iPhone app can only receive pushes once it is signed with Apple's push
// entitlement (ios/App/App/App.entitlements) and Firebase holds the APNs key.
// Until both exist this stays false and the iPhone app says "not yet".
const IOS_APP_PUSH_READY = false
const nativeReady = () => Capacitor.getPlatform() !== 'ios' || IOS_APP_PUSH_READY
/** The phone can take a while to get a token on a weak connection; don't hang on it. */
const TOKEN_TIMEOUT_MS = 20_000

const remembered = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }
const remember = (token: string | null) => {
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY) } catch { /* private mode */ }
}

export async function pushState(): Promise<PushState> {
  if (isNative) {
    if (!nativeReady()) return 'unsupported'
    const { receive } = await FirebaseMessaging.checkPermissions()
    if (receive === 'denied') return 'blocked'
    return receive === 'granted' && remembered() ? 'on' : 'off'
  }
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent)
  if (ios && !isStandalone()) return 'needs-install'
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !(await webMessaging().then((m) => m.isSupported()).catch(() => false))) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  return Notification.permission === 'granted' && remembered() ? 'on' : 'off'
}

async function nativeToken(): Promise<string> {
  const { token } = await Promise.race([
    FirebaseMessaging.getToken(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('push token timed out')), TOKEN_TIMEOUT_MS)),
  ])
  if (!token) throw new Error('no push token')
  return token
}

async function currentToken(): Promise<string> {
  if (isNative) return nativeToken()
  const registration = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE })
  const { getMessaging, getToken } = await webMessaging()
  return getToken(getMessaging(app), { serviceWorkerRegistration: registration, ...(VAPID_KEY ? { vapidKey: VAPID_KEY } : {}) })
}

/** Switch pushes on for this device. Call from a tap: it may ask permission. */
export async function enablePush(): Promise<PushState> {
  const state = await pushState()
  if (state !== 'off' && state !== 'on') return state
  if (isNative) {
    const { receive } = await FirebaseMessaging.requestPermissions()
    if (receive !== 'granted') return receive === 'denied' ? 'blocked' : 'off'
  } else if ((await Notification.requestPermission()) !== 'granted') {
    return Notification.permission === 'denied' ? 'blocked' : 'off'
  }
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
  if (isNative) await FirebaseMessaging.deleteToken().catch(() => {})
  else await webMessaging().then(({ deleteToken, getMessaging }) => deleteToken(getMessaging(app))).catch(() => {})
}

/** What a push carries besides its words: enough to open the right place. */
export interface PushOpened {
  type?: string
  patientUid?: string
  memoId?: string
  digestId?: string
}

/**
 * In the installed apps: call `onOpen` when the person taps a push. (On the
 * website the service worker opens the link itself.) A tap that started the
 * app is delivered once the listener is added. Returns how to stop.
 */
export function onPushOpened(onOpen: (data: PushOpened) => void): () => void {
  if (!isNative) return () => {}
  const handle = FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
    const data = (event.notification.data ?? {}) as Record<string, unknown>
    const text = (key: string) => (typeof data[key] === 'string' && data[key] ? (data[key] as string) : undefined)
    onOpen({ type: text('type'), patientUid: text('patientUid'), memoId: text('memoId'), digestId: text('digestId') })
  })
  return () => { void handle.then((h) => h.remove()).catch(() => {}) }
}
