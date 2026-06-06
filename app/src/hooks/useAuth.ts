import { useEffect, useState } from 'react'
import { onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth'
import { auth } from '../firebase'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u)
        setReady(true)
      } else {
        // Patient device: silently sign in anonymously so they never see a login.
        try {
          await signInAnonymously(auth)
        } catch (err) {
          console.error('[auth] anonymous sign-in failed', err)
          setReady(true)
        }
      }
    })
    return () => unsub()
  }, [])

  return { user, ready }
}
