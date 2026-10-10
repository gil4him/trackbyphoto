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

// ── a parent's phone accepting the family's link (pages/PairDevice) ─────────
//
// The parent should end up with an icon to come back to. A website can't
// install itself, so the link flow goes as far as each phone allows:
//   Android  → connect, then the browser's own install dialog (one tap)
//   iPhone   → add to the home screen first; the icon finishes the connection
//   in-app   → KakaoTalk's built-in browser can't install anything: hand the
//              link to the phone's real browser first, without using the code

export type InAppBrowser = 'kakaotalk' | 'line' | 'other' | null

export function inAppBrowser(userAgent: string): InAppBrowser {
  if (/KAKAOTALK/i.test(userAgent)) return 'kakaotalk'
  if (/Line\//i.test(userAgent)) return 'line'
  return IN_APP.test(userAgent) ? 'other' : null
}

/**
 * A link that opens `url` in the phone's own browser from inside an in-app
 * browser, or null when there is no dependable way (then the person is shown
 * how to do it by hand). The page is handed over as it is; nothing is added.
 */
export function externalBrowserUrl(url: string, userAgent: string): string | null {
  switch (inAppBrowser(userAgent)) {
    case 'kakaotalk':
      return `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`
    case 'line': {
      const u = new URL(url)
      u.searchParams.set('openExternalBrowser', '1')
      return u.toString()
    }
    case 'other': {
      if (!/Android/i.test(userAgent)) return null
      const u = new URL(url)
      return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`
    }
    default:
      return null
  }
}

export type PairStart =
  | 'family-warning'  // a family account is signed in on this phone
  | 'open-browser'    // in-app browser: move to the real browser first
  | 'add-ios'         // iPhone Safari: add to the home screen first
  | 'confirm'         // the big 연결하기 button
  | 'enter'           // no code in the link: type it

/** Where the link flow starts on this phone. */
export function pairStart(a: { familySignedIn: boolean; hasCode: boolean; path: InstallPath; simple?: boolean }): PairStart {
  if (a.familySignedIn) return 'family-warning'
  if (!a.hasCode) return 'enter'
  if (a.path === 'in-app') return 'open-browser'
  // The simple edition's real app comes from the store; its browser path
  // connects on the spot, without the home-screen icon first.
  if (a.path === 'ios') return a.simple ? 'confirm' : 'add-ios'
  return 'confirm'
}

export type AfterConnect =
  | 'prompt'   // offer the browser's install dialog
  | 'manual'   // Android browser without the dialog: show the menu steps
  | 'done'     // already an app, or nothing to install on this kind of device

/** What follows 확인 once the phone is connected. */
export function afterConnect(path: InstallPath): AfterConnect {
  if (path === 'prompt') return 'prompt'
  if (path === 'android') return 'manual'
  return 'done'
}

/**
 * iPhone only: make "홈 화면에 추가" keep this page's address (the pairing
 * link) for the icon. With the web manifest in place the icon would open the
 * start page instead, where this phone isn't connected yet; without it Safari
 * saves the page it is on. The code in the link is single-use, so the icon
 * holds nothing of value once the phone is connected.
 */
export function keepThisPageForHomeScreen() {
  document.querySelectorAll('link[rel="manifest"]').forEach((el) => el.remove())
}
