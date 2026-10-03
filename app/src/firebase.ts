import { initializeApp } from 'firebase/app'
import { Capacitor } from '@capacitor/core'
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
  setPersistence,
  type Auth,
} from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'

// authDomain must match the page origin so the Firebase Auth helper iframe
// runs same-origin. Otherwise iOS Safari ITP blocks the cookie the iframe
// uses to hand the session back, and the user bounces straight back to the
// sign-in screen after a successful Google redirect.
//
// Firebase Hosting reserves /__/auth/handler on every Hosting site under the
// project, so trackbyphoto.web.app/__/auth/handler resolves correctly.
const RUNTIME_AUTH_DOMAIN =
  typeof window !== 'undefined' && window.location.hostname.endsWith('.web.app')
    ? window.location.hostname
    : (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string)

const cfg = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        RUNTIME_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

export const app = initializeApp(cfg)

// In the iOS/Android apps, getAuth() would wire in the popup/redirect
// resolver, which loads a hidden iframe from authDomain. That iframe never
// loads inside the Capacitor WebView, so auth never resolves and the app sits
// on "준비 중이에요…" forever. Native sign-in goes through the native Google
// sheet + signInWithCredential (see useAuth), so no resolver is needed.
function createAuth(): Auth {
  if (Capacitor.isNativePlatform()) {
    return initializeAuth(app, { persistence: indexedDBLocalPersistence })
  }
  const a = getAuth(app)
  // Persist sessions to localStorage explicitly. iOS Safari sometimes degrades
  // to in-memory persistence when the iframe cookie write fails — pinning it
  // keeps the session across the redirect round-trip.
  setPersistence(a, browserLocalPersistence).catch((e) =>
    console.warn('[auth] setPersistence failed', e),
  )
  return a
}
export const auth = createAuth()
export const db = getFirestore(app)
export const storage = getStorage(app)

// Local emulator wiring: set VITE_USE_EMULATOR=1 in .env.local
if (import.meta.env.VITE_USE_EMULATOR === '1') {
  const host = location.hostname || 'localhost'
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, host, 8080)
  connectStorageEmulator(storage, host, 9199)
  // eslint-disable-next-line no-console
  console.info('[firebase] connected to local emulators at', host)
}
