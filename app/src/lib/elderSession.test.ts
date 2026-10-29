// A connected parent's phone knows itself without the network, and pairing
// never runs over its session (Yera's Galaxy, 2026-10-29).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { User } from 'firebase/auth'

const { signInAnonymously, signInWithCustomToken, authState } = vi.hoisted(() => ({
  signInAnonymously: vi.fn(async () => {}),
  signInWithCustomToken: vi.fn(async () => {}),
  authState: { currentUser: null as unknown },
}))
vi.mock('firebase/auth', () => ({ signInAnonymously, signInWithCustomToken }))
vi.mock('../firebase', () => ({ auth: authState }))

import {
  cachedClaims, looksLikeElder, PairingBlockedError, resolveElderSession, sessionFromClaims, signInAsElder, signInForPairing,
} from './elderSession'

const jwt = (payload: object) =>
  `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`

const anonymous = { uid: 'anon', isAnonymous: true, providerData: [] }
const family = { uid: 'kid', isAnonymous: false, providerData: [{ providerId: 'google.com' }] }
const parent = { uid: 'mom', isAnonymous: false, providerData: [] }

/** A user whose fresh token read answers `fresh` (or rejects) and whose kept token carries `kept`. */
const user = (fresh: object | Error, kept: unknown): User => ({
  ...parent,
  getIdTokenResult: () => (fresh instanceof Error ? Promise.reject(fresh) : Promise.resolve({ claims: fresh })),
  toJSON: () => (kept === undefined ? {} : { stsTokenManager: { accessToken: kept } }),
}) as unknown as User

const offline = Object.assign(new Error('network'), { code: 'auth/network-request-failed' })

describe('looksLikeElder', () => {
  it('a custom-token session yes; anonymous, Google/Apple/e-mail and nobody no', () => {
    expect(looksLikeElder(parent)).toBe(true)
    expect(looksLikeElder(anonymous)).toBe(false)
    expect(looksLikeElder(family)).toBe(false)
    expect(looksLikeElder({ ...family, providerData: [{ providerId: 'password' }] })).toBe(false)
    expect(looksLikeElder(null)).toBe(false)
  })
})

describe('cachedClaims', () => {
  it('reads the claims out of the kept token', () => {
    expect(cachedClaims({ toJSON: () => ({ stsTokenManager: { accessToken: jwt({ elder: true, deviceId: 'd1', name: '영희' }) } }) }))
      .toMatchObject({ elder: true, deviceId: 'd1', name: '영희' })
  })

  it('garbage is ignored', () => {
    expect(cachedClaims({ toJSON: () => ({}) })).toBeNull()
    expect(cachedClaims({ toJSON: () => ({ stsTokenManager: { accessToken: 'not-a-jwt' } }) })).toBeNull()
    expect(cachedClaims({ toJSON: () => ({ stsTokenManager: { accessToken: 'a.!!!.c' } }) })).toBeNull()
    expect(cachedClaims({ toJSON: () => { throw new Error('no') } })).toBeNull()
  })
})

describe('sessionFromClaims', () => {
  it('needs elder: true; the device id comes along', () => {
    expect(sessionFromClaims({ elder: true, deviceId: 'd1' })).toEqual({ deviceId: 'd1' })
    expect(sessionFromClaims({ elder: true })).toEqual({ deviceId: '' })
    expect(sessionFromClaims({ deviceId: 'd1' })).toBeNull()
    expect(sessionFromClaims(null)).toBeNull()
  })
})

describe('resolveElderSession', () => {
  it('uses the kept token when the fresh read fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await resolveElderSession(user(offline, jwt({ elder: true, deviceId: 'd1' })))).toEqual({ deviceId: 'd1' })
  })

  it('a fresh answer wins over the kept token, "not a parent" included', async () => {
    expect(await resolveElderSession(user({ elder: true, deviceId: 'fresh' }, jwt({ elder: true, deviceId: 'old' })))).toEqual({ deviceId: 'fresh' })
    expect(await resolveElderSession(user({}, jwt({ elder: true, deviceId: 'old' })))).toBeNull()
  })

  it('nothing readable: not a parent', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await resolveElderSession(user(offline, undefined))).toBeNull()
  })
})

describe('signInForPairing', () => {
  beforeEach(() => signInAnonymously.mockClear())

  it('signed out: one anonymous session to redeem the code with', async () => {
    authState.currentUser = null
    await signInForPairing()
    expect(signInAnonymously).toHaveBeenCalledTimes(1)
  })

  it('already anonymous: keeps that session', async () => {
    authState.currentUser = anonymous
    await signInForPairing()
    expect(signInAnonymously).not.toHaveBeenCalled()
  })

  it("a connected parent's session is never replaced", async () => {
    authState.currentUser = parent
    await expect(signInForPairing()).rejects.toMatchObject({ name: 'PairingBlockedError', kind: 'linked' })
    expect(signInAnonymously).not.toHaveBeenCalled()
  })

  it("nor is a family member's", async () => {
    authState.currentUser = family
    const err = await signInForPairing().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PairingBlockedError)
    expect((err as PairingBlockedError).kind).toBe('family')
    expect(signInAnonymously).not.toHaveBeenCalled()
  })

  it('signInAsElder hands the worker-minted token to the sign-in library', async () => {
    await signInAsElder('tok')
    expect(signInWithCustomToken).toHaveBeenCalledWith(authState, 'tok')
  })
})
