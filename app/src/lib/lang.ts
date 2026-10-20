// The language the app's screens are in: Korean or English.
//
// Decided once, when the app starts, so every string table (strings.ts) can
// simply pick its language at import time. Changing it saves the choice on
// this phone and reloads the page.
//
// Where it comes from, first match wins:
//   1. what this phone last knew (localStorage), set by setLang below;
//   2. the phone's own language (navigator.language): Korean → ko, else en.
// After sign-in, App.tsx reads the account's saved language (users/{uid}.geoLang,
// which every existing account has as 'ko') and calls applyAccountLang, so an
// existing account keeps Korean screens even on an English phone.
import type { GeoLang } from '../types'

export type Lang = GeoLang

const KEY = 'daylie.lang'

function stored(): Lang | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'ko' || v === 'en' ? v : null
  } catch { return null }
}

/** The phone's own language: Korean phones get Korean, every other phone English. */
export function deviceLang(languages: readonly string[] | undefined = globalThis.navigator?.languages): Lang {
  const first = languages?.[0] ?? globalThis.navigator?.language ?? 'ko'
  return first.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

// Unit tests run in Korean whatever the machine is set to (jsdom says en-US).
export const lang: Lang = import.meta.env.MODE === 'test' ? 'ko' : (stored() ?? deviceLang())

/** Switch the screens to `next`: remember it on this phone and reload. */
export function setLang(next: Lang): void {
  if (next === lang) return
  try {
    localStorage.setItem(KEY, next)
    // Reload only once the choice is really saved, or the reload would come
    // back in the old language and try again forever.
    if (localStorage.getItem(KEY) !== next) return
  } catch { return }
  location.reload()
}

/** The account's saved language arrived from the server: follow it. */
export function applyAccountLang(account: Lang | undefined): void {
  if (account === 'ko' || account === 'en') setLang(account)
}

/** Pick the string for the screens' language: tr('사진 찍기', 'Take a photo'). */
export function tr(ko: string, en: string): string {
  return lang === 'en' ? en : ko
}

/** A legal page in the screens' language: /privacy, or /en/privacy in English. */
export function legalPath(name: 'privacy' | 'terms' | 'delete-account'): string {
  return lang === 'en' ? `/en/${name}` : `/${name}`
}
