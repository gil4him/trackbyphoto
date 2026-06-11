import { useEffect, useState } from 'react'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { useAuth } from './hooks/useAuth'
import { useMemos } from './hooks/useMemos'
import { useMemberships } from './hooks/useMemberships'
import { useNotifications } from './hooks/useNotifications'
import { useAppUpdate } from './hooks/useAppUpdate'
import { syncCaregiverName } from './lib/caregiver'
import { setFaviconBadge } from './lib/favicon'
import { Tabs, type TabKey } from './components/Tabs'
import { ToastProvider } from './components/Toast'
import { PatientSwitcher } from './components/PatientSwitcher'
import { Home } from './pages/Home'
import { Today } from './pages/Today'
import { Settings } from './pages/Settings'
import { MemoDetail } from './pages/MemoDetail'
import { SignIn } from './pages/SignIn'
import { AcceptInvite } from './pages/AcceptInvite'
import { SuperAdmin, ADMIN_EMAIL } from './pages/SuperAdmin'
import { Ask } from './components/Ask'
import type { UserSettings } from './types'

const DEFAULT_SETTINGS: UserSettings = {
  patientName: '엄마',
  recipients: [],
  cadence: 'daily',
  autoMode: true,
  bigText: true,
  retention: '90',
}

// LocalStorage key for the patient-context selection, scoped per signed-in
// user so two accounts on one device don't bleed into each other.
const activePatientStorageKey = (uid: string) => `tbp.activePatient.${uid}`

function App() {
  const { user, ready, signInWithGoogle, signOut } = useAuth()
  const [tab, setTab] = useState<TabKey>('home')
  const [selectedMemoId, setSelectedMemoId] = useState<string | null>(null)
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS)
  // Caregiver-share: the user can be looking at their own data (self) or at
  // a patient they're an active caregiver on. `activePatientUid` is the
  // patientUid we're currently rendering — defaults to the signed-in user.
  const [activePatientUid, setActivePatientUid] = useState<string | null>(null)
  // /accept-invite is its own URL so we can deep-link from a Kakao/SMS share
  // ("초대 코드: 123456 → trackbyphoto.web.app/accept?code=123456").
  const [showAcceptInvite, setShowAcceptInvite] = useState(false)
  const { memberships: { patients }, loading: _membershipsLoading } = useMembershipsWrapped(user?.uid)
  // Elder safeguard notices live on the signed-in user's own account (§8).
  const { unread: notifications, dismiss: dismissNotification } = useNotifications(user?.uid)
  // True once a newer build has been deployed than the one we're running.
  const updateReady = useAppUpdate()
  const { memos } = useMemos(activePatientUid || undefined)
  const selectedMemo = selectedMemoId ? memos.find((m) => m.id === selectedMemoId) ?? null : null

  // Initialize activePatientUid when the user signs in. Read the persisted
  // choice from localStorage, falling back to self. Validates the persisted
  // choice still points at a patient we have access to (might have been
  // revoked since last visit).
  useEffect(() => {
    if (!user) { setActivePatientUid(null); return }
    const stored = localStorage.getItem(activePatientStorageKey(user.uid))
    if (stored && (stored === user.uid || patients.some((p) => p.patientUid === stored))) {
      setActivePatientUid(stored)
    } else {
      setActivePatientUid(user.uid)
    }
    // Re-evaluate when the patients list arrives — a revoked membership
    // should bounce us back to self automatically.
  }, [user, patients])

  // Stamp our real name onto any memberships where we're the caregiver, so the
  // patient sees a name (not a UID) in 보호자 관리. Backfills older rows too.
  useEffect(() => {
    if (user) syncCaregiverName().catch((e) => console.warn('[caregiver] name sync failed', e))
  }, [user])

  // /accept and /accept-invite both jump to the accept screen. Honors a
  // ?code= query param too so the deep link can pre-fill the code field.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const path = window.location.pathname
    if (path === '/accept' || path === '/accept-invite') setShowAcceptInvite(true)
  }, [])

  // If the selected memo disappears from the live snapshot (e.g. delete from
  // the detail page), drop back to the previous tab automatically.
  useEffect(() => {
    if (selectedMemoId && !selectedMemo) setSelectedMemoId(null)
  }, [selectedMemoId, selectedMemo])

  // Settings subscription follows the ACTIVE patient, not the signed-in user.
  // For self this is the same; for caregiver mode it's the patient's doc.
  useEffect(() => {
    if (!user || !activePatientUid) return
    const sref = doc(db, 'users', activePatientUid)
    const unsub = onSnapshot(sref, (snap) => {
      if (snap.exists()) {
        setSettings({ ...DEFAULT_SETTINGS, ...(snap.data() as Partial<UserSettings>) })
      } else if (activePatientUid === user.uid) {
        // Only seed defaults for the SELF doc — never overwrite a missing
        // doc for someone we're caregiving (could be a transient consistency
        // gap, and we don't want to plant data we don't own).
        setDoc(sref, { ...DEFAULT_SETTINGS, lastModifiedBy: user.uid, lastModifiedAt: serverTimestamp() })
          .catch((e) => console.error('[settings] init', e))
      }
    }, (err) => console.error('[settings] subscription', err))
    return () => unsub()
  }, [user, activePatientUid])

  const onSettingsChange = (next: UserSettings) => {
    setSettings(next)
    if (user && activePatientUid) {
      // Stamp the actor so the audit trigger can attribute the change. Rules
      // require lastModifiedBy == auth.uid, so this can't be forged.
      setDoc(
        doc(db, 'users', activePatientUid),
        { ...next, lastModifiedBy: user.uid, lastModifiedAt: serverTimestamp() },
        { merge: true },
      ).catch((e) => console.error('[settings] save', e))
    }
  }

  const onSwitchPatient = (uid: string) => {
    if (!user) return
    setActivePatientUid(uid)
    localStorage.setItem(activePatientStorageKey(user.uid), uid)
    // Drop any open detail view when switching contexts so we don't stare
    // at a memo that just disappeared from the active list.
    setSelectedMemoId(null)
  }

  // Apply big text preference (slightly larger root font when on).
  useEffect(() => {
    document.documentElement.style.fontSize = settings.bigText ? '17px' : '16px'
  }, [settings.bigText])

  // Surface unread notifications on the "web icon": a count badge on an
  // installed PWA's app icon (setAppBadge, no-op in plain tabs) and a count in
  // the browser tab title so it's visible everywhere.
  useEffect(() => {
    const n = notifications.length
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    if (n > 0) nav.setAppBadge?.(n).catch(() => {})
    else nav.clearAppBadge?.().catch(() => {})
    setFaviconBadge(n)
    document.title = n > 0 ? `(${n}) 오늘하루 · TrackByPhoto` : '오늘하루 · TrackByPhoto'
  }, [notifications.length])

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
    // Unauthenticated caregivers landing on /accept-invite still need to sign
    // in first (the acceptInvite callable requires auth). The
    // showAcceptInvite flag persists across the redirect round-trip so they
    // land on the accept screen as soon as they're signed in.
    return (
      <ToastProvider>
        <div className="app">
          <main>
            <SignIn
              onGoogle={signInWithGoogle}
              onAcceptInvite={() => setShowAcceptInvite(true)}
            />
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

  if (showAcceptInvite) {
    return (
      <ToastProvider>
        <div className="app">
          <main>
            <AcceptInvite
              onAccepted={(patientUid) => {
                setShowAcceptInvite(false)
                window.history.replaceState(null, '', '/')
                onSwitchPatient(patientUid)
                setTab('home')
              }}
              onCancel={() => {
                setShowAcceptInvite(false)
                window.history.replaceState(null, '', '/')
              }}
            />
          </main>
        </div>
      </ToastProvider>
    )
  }

  const isSelf = activePatientUid === user.uid
  const selfLabel = user.displayName?.split(' ')[0] || user.email?.split('@')[0] || '나'

  // Switching to ask/today from elsewhere also drops the detail view so the
  // tab feels like the canonical owner of its screen.
  const onTabChange = (k: TabKey) => {
    setSelectedMemoId(null)
    setTab(k)
  }
  // Tapping the askbtn from Home jumps to the Ask tab — that way it has a
  // place in the nav and back-by-tab works naturally.
  const openAsk = () => onTabChange('ask')

  return (
    <ToastProvider>
      <div className={`app${isSelf ? '' : ' caregiver-mode'}`}>
        {updateReady && (
          <button className="update-prompt" onClick={() => window.location.reload()}>
            새 버전이 있어요 <span className="update-go">새로고침</span>
          </button>
        )}
        <main>
          {patients.length > 0 && !selectedMemo && (
            <PatientSwitcher
              selfUid={user.uid}
              selfLabel={selfLabel}
              patients={patients}
              activePatientUid={activePatientUid || user.uid}
              onChange={onSwitchPatient}
            />
          )}
          {selectedMemo ? (
            <MemoDetail memo={selectedMemo} onBack={() => setSelectedMemoId(null)} />
          ) : (
            <>
              {tab === 'home'     && <Home uid={activePatientUid || user.uid} patientName={settings.patientName} greetingName={isSelf ? selfLabel : settings.patientName} memos={memos} onOpenAsk={openAsk} onOpen={setSelectedMemoId} canCapture={isSelf} notifications={notifications} onDismissNotification={dismissNotification} />}
              {tab === 'today'    && <Today memos={memos} onOpen={setSelectedMemoId} />}
              {tab === 'ask'      && <Ask memos={memos} onOpen={setSelectedMemoId} />}
              {tab === 'settings' && (
                <Settings
                  settings={settings}
                  onChange={onSettingsChange}
                  user={user}
                  onSignOut={signOut}
                  memos={memos}
                  activePatientUid={activePatientUid || user.uid}
                  isSelf={isSelf}
                  onOpenAcceptInvite={() => setShowAcceptInvite(true)}
                />
              )}
            </>
          )}
        </main>

        <Tabs active={tab} onChange={onTabChange} avatarUrl={user.photoURL ?? undefined} unreadCount={notifications.length} />
      </div>
    </ToastProvider>
  )
}

// Wrap useMemberships so the caller can destructure either name shape. The
// hook returns { caregivers, patients, loading } directly; this helper
// nests it under `memberships` for the App body's destructure clarity.
function useMembershipsWrapped(uid: string | undefined) {
  const m = useMemberships(uid)
  return { memberships: { caregivers: m.caregivers, patients: m.patients }, loading: m.loading }
}

export default App
