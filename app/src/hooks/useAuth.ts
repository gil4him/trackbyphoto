import { useEffect, useState } from 'react'
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth'
import { auth } from '../firebase'

// Popup is fastest on desktop & most mobile browsers. iOS Safari sometimes
// blocks popups when the gesture chain is broken (PWA standalone), so we
// fall back to redirect there.
function shouldUseRedirect(): boolean {
  if (typeof window === 'undefined') return false
  const standalone =
    // iOS Safari PWA
    (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
    // PWA display-mode
    window.matchMedia?.('(display-mode: standalone)').matches === true
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  return standalone && isIOS
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
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
