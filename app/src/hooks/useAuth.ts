import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { FirebaseAuthentication } from '@capacitor-firebase/authentication'
import {
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signInWithCustomToken,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth'
import { auth } from '../firebase'

// In the iOS/Android apps Google refuses OAuth inside the embedded WebView
// (disallowed_useragent), so the native Google account sheet runs instead
// and its ID token signs in the Firebase JS SDK — same Firebase user (uid)
// as on the web, so Firestore rules and data are unchanged.
const isNative = Capacitor.isNativePlatform()

// Use the redirect flow on every mobile UA (iOS Safari any mode + Android).
// signInWithPopup on iOS Safari is unreliable: the popup opens against the
// gesture chain, the parent loses focus, and the popup closes without
// returning a credential — symptom is "tap login → come back to login
// screen, no error." Redirect avoids the popup entirely.
function shouldUseRedirect(): boolean {
  if (typeof window === 'undefined') return false
  return /iPad|iPhone|iPod|Android/i.test(navigator.userAgent)
}

// Android phones without Credential Manager support (older OS or Play
// services) reject the default flow with "Your device doesn't support
// credential manager"; retry with the legacy Google Sign-In screen, which
// still returns an ID token.
async function nativeGoogleSignIn() {
  try {
    return await FirebaseAuthentication.signInWithGoogle()
  } catch (err) {
    const message = (err as { message?: string })?.message ?? ''
    if (Capacitor.getPlatform() === 'android' && /credential manager/i.test(message)) {
      return FirebaseAuthentication.signInWithGoogle({ useCredentialManager: false })
    }
    throw err
  }
}

/** An elder phone linked by a pairing code: a worker-minted custom token
 *  carrying { elder: true, deviceId }. */
export interface ElderSession {
  deviceId: string
}

async function readElderSession(u: User): Promise<ElderSession | null> {
  try {
    const { claims } = await u.getIdTokenResult()
    return claims.elder === true ? { deviceId: String(claims.deviceId ?? '') } : null
  } catch (err) {
    console.warn('[auth] could not read token claims', err)
    return null
  }
}

/** Anonymous sign-in, used only to redeem a pairing code with the worker. */
export async function signInForPairing(): Promise<void> {
  if (auth.currentUser?.isAnonymous) return
  await signInAnonymously(auth)
}

/** Switch to the elder session the worker minted. Persists like any sign-in. */
export async function signInAsElder(customToken: string): Promise<void> {
  await signInWithCustomToken(auth, customToken)
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [elder, setElder] = useState<ElderSession | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Surface any redirect-flow failure to the console so we can debug
    // post-Google handoff issues (storage partition, ITP, etc). v9 already
    // routes the result into onAuthStateChanged, but calling this directly
    // makes errors visible and is a no-op on a non-redirect load.
    if (!isNative) {
      getRedirectResult(auth).catch((err) =>
        console.error('[auth] getRedirectResult failed', err),
      )
    }

    const unsub = onAuthStateChanged(auth, async (u) => {
      const session = u && !u.isAnonymous ? await readElderSession(u) : null
      setElder(session)
      setUser(u)
      setReady(true)
    })
    return () => unsub()
  }, [])

  const signInWithGoogle = async () => {
    if (isNative) {
      try {
        const result = await nativeGoogleSignIn()
        const idToken = result.credential?.idToken
        if (!idToken) throw new Error('native Google sign-in returned no ID token')
        await signInWithCredential(auth, GoogleAuthProvider.credential(idToken))
      } catch (err) {
        console.error('[auth] native Google sign-in failed', err)
        throw err
      }
      return
    }
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    try {
      if (shouldUseRedirect()) {
        await signInWithRedirect(auth, provider)
      } else {
        await signInWithPopup(auth, provider)
      }
    } catch (err) {
      console.error('[auth] Google sign-in failed', err)
      throw err
    }
  }

  const signOut = async () => {
    // Also clear the native Google session so the account picker shows again.
    if (isNative) await FirebaseAuthentication.signOut().catch(() => {})
    await fbSignOut(auth)
  }

  return { user, elder, ready, signInWithGoogle, signOut }
}
