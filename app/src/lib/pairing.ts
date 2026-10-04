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
import type { UserSettings } from '../types'

// The Mac mini can take a moment; an elder shouldn't see "offline" too early.
const PAIR_TIMEOUT_MS = 60_000

export const PAIR_CODE_LEN = 8
export const MANAGED_CONSENT_VERSION = 'managed-v1'

/** Uppercase, strip spaces/dashes, cap at the code length. */
export function normalizePairCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, PAIR_CODE_LEN)
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
  settings: Pick<UserSettings, 'cadence' | 'autoMode' | 'bigText'>
}): Promise<{ patientUid: string }> {
  return callWorker('createManagedElder', { ...args, consentTextVersion: MANAGED_CONSENT_VERSION }, { timeoutMs: PAIR_TIMEOUT_MS })
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
