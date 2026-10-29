// A parent's phone is signed in with the custom token the worker minted when
// the family's pairing code was redeemed ({ elder: true, deviceId }). No
// family account looks like that: Google, Apple and e-mail sign-ins carry a
// provider entry, an anonymous session says it is one. So a phone can tell,
// without the network, that it is a connected parent's phone — and pairing
// must never run over such a session. On 2026-10-29 a linked Galaxy whose
// token could not be refreshed at launch was shown the pairing screen, lost
// its session to an anonymous sign-in and spent the day retrying its old code.

import { signInAnonymously, signInWithCustomToken, type User } from 'firebase/auth'
import { auth } from '../firebase'

/** An elder phone linked by a pairing code: a worker-minted custom token
 *  carrying { elder: true, deviceId }. */
export interface ElderSession {
  deviceId: string
}

type SessionUser = Pick<User, 'isAnonymous'> & { providerData: readonly unknown[] }

/** A signed-in session with no sign-in provider: a parent's custom-token sign-in. */
export function looksLikeElder(u: SessionUser | null | undefined): boolean {
  return !!u && !u.isAnonymous && u.providerData.length === 0
}

/**
 * The claims in the last token the sign-in library kept for this user, expired
 * or not — what the phone knows about itself when the network is away. Null
 * when there is no such token or it can't be read (the field is the library's
 * own; a rename just means "unknown").
 */
export function cachedClaims(u: { toJSON(): object }): Record<string, unknown> | null {
  try {
    const token = (u.toJSON() as { stsTokenManager?: { accessToken?: unknown } }).stsTokenManager?.accessToken
    if (typeof token !== 'string') return null
    const part = token.split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function sessionFromClaims(claims: Record<string, unknown> | null | undefined): ElderSession | null {
  return claims?.elder === true ? { deviceId: String(claims.deviceId ?? '') } : null
}

/**
 * Whether this user is a connected parent's phone: the fresh token when it can
 * be had (its answer wins, "not a parent" included), else the kept one.
 */
export async function resolveElderSession(u: User): Promise<ElderSession | null> {
  try {
    const { claims } = await u.getIdTokenResult()
    return sessionFromClaims(claims as Record<string, unknown>)
  } catch (err) {
    console.warn('[auth] could not read token claims; using the kept token', err)
    return sessionFromClaims(cachedClaims(u))
  }
}

/** Pairing asked for on a phone that is already signed in. */
export class PairingBlockedError extends Error {
  /** 'linked': a parent's phone; 'family': a family member's account. */
  readonly kind: 'linked' | 'family'
  constructor(kind: 'linked' | 'family') {
    super(kind === 'linked' ? 'this phone is already connected' : 'a family account is signed in')
    this.name = 'PairingBlockedError'
    this.kind = kind
  }
}

/** Anonymous sign-in, used only to redeem a pairing code with the worker.
 *  Never over a signed-in session: a connected parent keeps theirs. */
export async function signInForPairing(): Promise<void> {
  const u = auth.currentUser
  if (u?.isAnonymous) return
  if (u) throw new PairingBlockedError(looksLikeElder(u) ? 'linked' : 'family')
  await signInAnonymously(auth)
}

/** Switch to the elder session the worker minted. Persists like any sign-in. */
export async function signInAsElder(customToken: string): Promise<void> {
  await signInWithCustomToken(auth, customToken)
}
