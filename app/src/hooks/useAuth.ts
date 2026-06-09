import { useEffect, useState } from 'react'
import {
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth'
import { auth } from '../firebase'

// Use the redirect flow on every mobile UA (iOS Safari any mode + Android).
// signInWithPopup on iOS Safari is unreliable: the popup opens against the
// gesture chain, the parent loses focus, and the popup closes without
// returning a credential — symptom is "tap login → come back to login
// screen, no error." Redirect avoids the popup entirely.
function shouldUseRedirect(): boolean {
  if (typeof window === 'undefined') return false
  return /iPad|iPhone|iPod|Android/i.test(navigator.userAgent)
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Surface any redirect-flow failure to the console so we can debug
    // post-Google handoff issues (storage partition, ITP, etc). v9 already
    // routes the result into onAuthStateChanged, but calling this directly
    // makes errors visible and is a no-op on a non-redirect load.
    getRedirectResult(auth).catch((err) =>
      console.error('[auth] getRedirectResult failed', err),
    )

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setReady(true)
    })
    return () => unsub()
  }, [])

  const signInWithGoogle = async () => {
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

  const signOut = () => fbSignOut(auth)

  return { user, ready, signInWithGoogle, signOut }
}
