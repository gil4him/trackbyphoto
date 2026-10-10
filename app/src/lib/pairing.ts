// Client side of 부모님 등록하기 + phone pairing (worker/src/handlers/pairing.ts).
//
// Family:  createManagedElder → createPairingLink → share the link (KakaoTalk,
//          text message, or a QR code shown in person).
// Elder:   opens trackbyphoto.web.app/pair?c=CODE (or types the code in the
//          app) → pairDevice → signs in with the returned custom token.
//          A re-link of an account that already has a phone waits for family
//          approval (approvePairing) and then collects its token
//          (completePairing).

import { Capacitor } from '@capacitor/core'
import { callWorker } from './worker'
import { PUBLIC_ORIGIN } from './publicUrl'
import { isSimple } from './edition'
import { SIMPLE_CONSENT_VERSION } from './consent'
import type { UserSettings } from '../types'

// The Mac mini can take a moment; an elder shouldn't see "offline" too early.
const PAIR_TIMEOUT_MS = 60_000

export const PAIR_CODE_LEN = 8
export const MANAGED_CONSENT_VERSION = 'managed-v2'

/** Uppercase, strip spaces/dashes, cap at the code length. */
export function normalizePairCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, PAIR_CODE_LEN)
}

/**
 * The pair code in one of our pairing links — `{PUBLIC_ORIGIN}/pair?c=CODE`
 * (or `#c=CODE`) — scanned from the family's QR, found on the clipboard, or
 * opened as a Universal/App Link. Anything else (another site, another path,
 * a bare code, a short code) is null, so a random QR or clipboard text is
 * never sent to the worker.
 */
export function pairCodeFromText(text: string): string | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (url.origin !== PUBLIC_ORIGIN || url.pathname.replace(/\/+$/, '') !== '/pair') return null
  const raw = url.searchParams.get('c') || new URLSearchParams(url.hash.slice(1)).get('c') || ''
  // Not normalizePairCode: it would cut a longer value down to a valid length.
  const code = raw.toUpperCase().replace(/[^0-9A-Z]/g, '')
  return code.length === PAIR_CODE_LEN ? code : null
}

/**
 * The pair code in a Play install referrer: "c=CODE" as the /pair page puts
 * it (a whole /pair link is accepted too). Same strictness as
 * pairCodeFromText: exactly 8 letters/digits, or null.
 */
export function pairCodeFromReferrer(referrer: string): string | null {
  const fromLink = pairCodeFromText(referrer)
  if (fromLink) return fromLink
  const raw = new URLSearchParams(referrer.trim()).get('c') ?? ''
  const code = raw.toUpperCase()
  return /^[0-9A-Z]{8}$/.test(code) ? code : null
}

/**
 * True exactly once per phone for this key (then remembered): the first-launch
 * checks for a pair code — clipboard, Play install referrer — run only once,
 * so iOS's 붙여넣기 허용 question never comes back. Storage that can't be
 * read counts as the first time.
 */
export function firstTimeOnly(key: string, storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage): boolean {
  try {
    if (!storage || storage.getItem(key) === '1') return !storage
    storage.setItem(key, '1')
  } catch {
    // Private mode or blocked storage: check, at worst once per opening.
  }
  return true
}

/** "ABCD EFGH" — easier to read out over the phone. */
export function formatPairCode(code: string): string {
  return code.length === PAIR_CODE_LEN ? `${code.slice(0, 4)} ${code.slice(4)}` : code
}

/** Short label the family sees in 기기 관리 ("iPhone", "Android 휴대폰"…). */
export function describeThisDevice(): { name: string; platform: string } {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const platform = Capacitor.getPlatform()
  const name = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /SM-|Galaxy/i.test(ua) ? '갤럭시'
    : /Android/.test(ua) ? 'Android 휴대폰'
    : '컴퓨터'
  return { name, platform }
}

export async function createManagedElder(args: {
  patientName: string
  settings: Pick<UserSettings, 'cadence' | 'autoMode' | 'bigText' | 'geoLang'>
  /** Also make the first phone link in the same call (one round trip). */
  link?: 'qr' | 'remote'
}): Promise<{ patientUid: string; link?: PairingLink }> {
  return callWorker('createManagedElder', { ...args, ...managedConsent() }, { timeoutMs: PAIR_TIMEOUT_MS })
}

/** What RegisterElder's consent screen covered: voice replies since
 *  managed-v2; the simple edition has none (lib/consent.ts). */
export function managedConsent(): { consentTextVersion: string; voiceConsent: boolean } {
  return isSimple()
    ? { consentTextVersion: SIMPLE_CONSENT_VERSION, voiceConsent: false }
    : { consentTextVersion: MANAGED_CONSENT_VERSION, voiceConsent: true }
}

export interface PairingLink {
  code: string
  url: string
  purpose: 'onboard' | 'repair'
  expiresAt: string
}

export async function createPairingLink(patientUid: string, mode: 'remote' | 'qr'): Promise<PairingLink> {
  return callWorker('createPairingLink', { patientUid, mode }, { timeoutMs: PAIR_TIMEOUT_MS })
}

/**
 * Whether a link may also go out by KakaoTalk / text message. A remote link
 * may; so may a QR link that onboards a parent's first phone, which links
 * straight away whichever way it arrives. A QR link that re-links skips the
 * family's approval, so it is for in person only.
 */
export function canShareRemotely(link: Pick<PairingLink, 'purpose'> & { mode: 'remote' | 'qr' }): boolean {
  return link.mode === 'remote' || link.purpose === 'onboard'
}

export type PairResult =
  | { status: 'paired'; customToken: string; patientUid: string; deviceId: string }
  | { status: 'awaiting-approval'; pairingId: string }

export async function pairDevice(code: string): Promise<PairResult> {
  return callWorker('pairDevice', { code, device: describeThisDevice() }, { timeoutMs: PAIR_TIMEOUT_MS })
}

export async function completePairing(pairingId: string): Promise<PairResult> {
  return callWorker('completePairing', { pairingId }, { timeoutMs: PAIR_TIMEOUT_MS })
}

export async function approvePairing(pairingId: string, approve: boolean): Promise<void> {
  await callWorker('approvePairing', { pairingId, approve })
}

export async function unlinkDevice(patientUid: string, deviceId: string): Promise<void> {
  await callWorker('unlinkDevice', { patientUid, deviceId })
}

/** 부모님 삭제 — guardian only; erases the parent's account and all records. */
export async function deleteManagedElder(patientUid: string): Promise<void> {
  await callWorker('deleteManagedElder', { patientUid }, { timeoutMs: 60_000 })
}
