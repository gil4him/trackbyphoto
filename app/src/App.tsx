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
  const { user, ready } = useAuth()
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

  if (!ready || !user) {
    return (
      <div className="app">
        <main style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
          <div style={{ color: 'var(--ink-2)' }}>준비 중이에요…</div>
        </main>
      </div>
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
              {tab === 'settings' && <Settings settings={settings} onChange={onSettingsChange} />}
            </>
          )}
        </main>

        {!selectedMemo && <Tabs active={tab} onChange={setTab} />}
      </div>
    </ToastProvider>
  )
}

export default App
