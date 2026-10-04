// Putting the website on the home screen.
//
// A family member who joins through an invite link is in a browser tab (often
// KakaoTalk's built-in one) with no icon to come back to, and on an iPhone a
// website can only send notifications once it is on the home screen. This
// works out which instructions to show; the wording lives in InstallHint.

import { Capacitor } from '@capacitor/core'

export type InstallPath =
  | 'none'        // already an app (installed app or home-screen icon): nothing to do
  | 'in-app'      // KakaoTalk / other in-app browser: must open in Safari or Chrome first
  | 'ios'         // iPhone/iPad Safari: Share → 홈 화면에 추가
  | 'prompt'      // the browser offered its own install dialog (Android Chrome, desktop Chrome/Edge)
  | 'android'     // Android browser without the dialog: menu → 홈 화면에 추가
  | 'desktop'     // a computer: nothing to guide

export interface InstallEnv {
  native: boolean
  standalone: boolean
  userAgent: string
  /** The browser fired beforeinstallprompt. */
  canPrompt: boolean
}

const IN_APP = /KAKAOTALK|NAVER\(inapp|FBAN|FBAV|Instagram|Line\//i

export function installPath(env: InstallEnv): InstallPath {
  if (env.native || env.standalone) return 'none'
  const ua = env.userAgent
  const ios = /iPhone|iPad|iPod/i.test(ua)
  const android = /Android/i.test(ua)
  if ((ios || android) && IN_APP.test(ua)) return 'in-app'
  if (ios) return 'ios'
  if (env.canPrompt) return 'prompt'
  if (android) return 'android'
  return 'desktop'
}

// ── browser side ────────────────────────────────────────────────────────────

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    listeners.forEach((l) => l())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((l) => l())
  })
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function currentInstallPath(): InstallPath {
  return installPath({
    native: Capacitor.isNativePlatform(),
    standalone: isStandalone(),
    userAgent: navigator.userAgent,
    canPrompt: deferred !== null,
  })
}

/** Re-render when the browser offers (or completes) an install. */
export function onInstallChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Show the browser's own install dialog. True when the person accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  const event = deferred
  deferred = null
  await event.prompt()
  const accepted = (await event.userChoice).outcome === 'accepted'
  listeners.forEach((l) => l())
  return accepted
}
