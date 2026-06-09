import { useEffect, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import { useAuth } from './hooks/useAuth'
import { useMemos } from './hooks/useMemos'
import { Tabs, type TabKey } from './components/Tabs'
import { ToastProvider } from './components/Toast'
import { Home } from './pages/Home'
import { Today } from './pages/Today'
import { Settings } from './pages/Settings'
import { MemoDetail } from './pages/MemoDetail'
import { SignIn } from './pages/SignIn'
import { SuperAdmin, ADMIN_EMAIL } from './pages/SuperAdmin'
import { fmtDate } from './util'
import type { UserSettings } from './types'

const DEFAULT_SETTINGS: UserSettings = {
  patientName: '엄마',
  recipients: [],
  cadence: 'daily',
  autoMode: true,
  bigText: true,
  retention: '90',
}

function App() {
  const { user, ready, signInWithGoogle, signOut } = useAuth()
  const [tab, setTab] = useState<TabKey>('home')
  // When non-null, the detail page takes over from the tab. Cleared by the
  // back button or when the underlying memo gets deleted.
  const [selectedMemoId, setSelectedMemoId] = useState<string | null>(null)
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS)
  const { memos } = useMemos(user?.uid)
  const selectedMemo = selectedMemoId ? memos.find((m) => m.id === selectedMemoId) ?? null : null

  // If the selected memo disappears from the live snapshot (e.g. delete from
  // the detail page), drop back to the previous tab automatically.
  useEffect(() => {
    if (selectedMemoId && !selectedMemo) setSelectedMemoId(null)
  }, [selectedMemoId, selectedMemo])

  // Subscribe to settings doc + write defaults on first sign-in
  useEffect(() => {
    if (!user) return
    const sref = doc(db, 'users', user.uid)
    const unsub = onSnapshot(sref, (snap) => {
      if (snap.exists()) {
        setSettings({ ...DEFAULT_SETTINGS, ...(snap.data() as Partial<UserSettings>) })
      } else {
        // First time: create with defaults
        setDoc(sref, DEFAULT_SETTINGS).catch((e) => console.error('[settings] init', e))
      }
    }, (err) => console.error('[settings] subscription', err))
    return () => unsub()
  }, [user])

  // Persist settings whenever they change (after auth ready)
  const onSettingsChange = (next: UserSettings) => {
    setSettings(next)
    if (user) {
      setDoc(doc(db, 'users', user.uid), next, { merge: true })
        .catch((e) => console.error('[settings] save', e))
    }
  }

  // Apply big text preference
  useEffect(() => {
    document.documentElement.style.fontSize = settings.bigText ? '18px' : '16px'
  }, [settings.bigText])

  // Hidden /superadmin route. SPA rewrite resolves it to index.html so we
  // can branch here without adding react-router. Auth still required —
  // sign in with Google as the admin email and the dashboard appears.
  const isAdminRoute =
    typeof window !== 'undefined' && window.location.pathname === '/superadmin'

  if (!ready) {
    return (
      <div className="app">
        <main style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
          <div style={{ color: 'var(--ink-2)' }}>준비 중이에요…</div>
        </main>
      </div>
    )
  }

  if (!user) {
    return (
      <ToastProvider>
        <div className="app">
          <main>
            <SignIn onGoogle={signInWithGoogle} />
          </main>
        </div>
      </ToastProvider>
    )
  }

  if (isAdminRoute) {
    return (
      <ToastProvider>
        <div className="app">
          <main>
            {user.email === ADMIN_EMAIL ? (
              <SuperAdmin onSignOut={signOut} />
            ) : (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-2)' }}>
                <h2 style={{ marginBottom: 8 }}>접근 권한이 없습니다</h2>
                <p>이 페이지는 관리자만 사용할 수 있어요.</p>
                <p style={{ marginTop: 16, fontSize: 13 }}>
                  로그인 계정: {user.email}
                </p>
                <button
                  onClick={() => { window.location.href = '/' }}
                  style={{ marginTop: 24, padding: '10px 20px', border: '1px solid var(--line)', borderRadius: 12, background: '#fff' }}
                >홈으로 이동</button>
              </div>
            )}
          </main>
        </div>
      </ToastProvider>
    )
  }

  return (
    <ToastProvider>
      <div className="app">
        <header className="bar">
          <div className="brand">
            <div className="dot" />
            <span>오늘하루</span>
          </div>
          <div className="who">{settings.patientName} · {fmtDate(new Date())}</div>
        </header>

        <main>
          {selectedMemo ? (
            <MemoDetail memo={selectedMemo} onBack={() => setSelectedMemoId(null)} />
          ) : (
            <>
              {tab === 'home'     && <Home uid={user.uid} patientName={settings.patientName} memos={memos} onOpen={setSelectedMemoId} />}
              {tab === 'today'    && <Today memos={memos} onOpen={setSelectedMemoId} />}
              {tab === 'settings' && <Settings settings={settings} onChange={onSettingsChange} user={user} onSignOut={signOut} />}
            </>
          )}
        </main>

        <Tabs
          active={tab}
          onChange={(k) => {
            // Tapping a tab from the detail view returns to that tab.
            setSelectedMemoId(null)
            setTab(k)
          }}
          onBack={selectedMemo ? () => setSelectedMemoId(null) : undefined}
          user={user}
        />
      </div>
    </ToastProvider>
  )
}

export default App
