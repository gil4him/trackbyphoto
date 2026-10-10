import { useEffect, useMemo, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { doc, onSnapshot, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { useAuth } from './hooks/useAuth'
import { useLaunchUrl } from './hooks/useLaunchUrl'
import { useMemos } from './hooks/useMemos'
import { useMemberships } from './hooks/useMemberships'
import { useOutboxSync } from './hooks/useOutbox'
import { useNotifications } from './hooks/useNotifications'
import { useAppUpdate, useReloadOnReturn } from './hooks/useAppUpdate'
import { reloadToLatest } from './lib/sw'
import { recallSettings, rememberSettings } from './lib/settingsCache'
import { usePatientDocs } from './hooks/usePatientNames'
import { canSendFamilyPhoto } from './lib/familyPhotosModel'
import { listedPeople, pickActivePatient } from './lib/people'
import { useFamilyPhotos } from './hooks/useFamilyPhotos'
import { SendFamilyPhoto, SentFamilyPhotos } from './components/SendFamilyPhoto'
import { normalizeInviteCode, syncCaregiverName } from './lib/caregiver'
import { setFaviconBadge } from './lib/favicon'
import { Tabs, type TabKey } from './components/Tabs'
import { ToastProvider } from './components/Toast'
import { PatientSwitcher } from './components/PatientSwitcher'
import { Home } from './pages/Home'
import { Today } from './pages/Today'
import { Settings } from './pages/Settings'
import { MemoDetail } from './pages/MemoDetail'
import { SignIn } from './pages/SignIn'
import { AcceptInvite, PENDING_INVITE_KEY } from './pages/AcceptInvite'
import { PairDevice } from './pages/PairDevice'
import { ElderPairStart } from './pages/ElderPairStart'
import { PairLanding } from './pages/PairLanding'
import { RegisterElder } from './pages/RegisterElder'
import { SimpleStart } from './components/SimpleStart'
import { appTitle, isSimple } from './lib/edition'
import { ElderApp } from './pages/ElderApp'
import { SuperAdmin, ADMIN_EMAIL } from './pages/SuperAdmin'
import { Ask } from './components/Ask'
import { usePlans } from './hooks/usePlans'
import { useReactions } from './hooks/useReactions'
import { useElderNews, type OpenNews } from './hooks/useElderNews'
import { FamilyNews } from './pages/FamilyNews'
import { FamilyNewsCard } from './components/FamilyNewsCard'
import { InstallHint } from './components/InstallHint'
import { Notifications } from './pages/Notifications'
import { DigestPage } from './pages/DigestPage'
import { digestIdFromPath } from './lib/digest'
import { Trail } from './pages/Trail'
import { VoiceAlbum } from './pages/VoiceAlbum'
import { PlanSheet } from './components/PlanSheet'
import { TIER_NAME, fromTier, type PlanReason } from './lib/plan'
import { homeFor } from './lib/trail'
import { deviceGeoLang, relativeDateLabel } from './util'
import { disablePush, onPushOpened, refreshPush, type PushOpened } from './lib/push'
import { PushNudge } from './components/PushNudge'
import type { AppNotification } from './types'
import { entitlements, flagOn } from './lib/plans'
import { byMemo } from './lib/reactionsModel'
import type { ReactionsContext } from './components/Reactions'
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

// trackbyphoto.web.app/pair?c=CODE — the link family sends to link a parent's
// phone (#c=CODE is accepted too).
function pairCodeFromUrl(): string | null {
  if (typeof window === 'undefined' || window.location.pathname !== '/pair') return null
  const fromQuery = new URLSearchParams(window.location.search).get('c')
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('c')
  return fromQuery || fromHash || ''
}

function App() {
  const { user: authUser, elder, ready, signInWithGoogle, signOut } = useAuth()
  // An anonymous session exists only while a phone redeems a pairing code;
  // everywhere else it counts as signed out.
  const user = authUser && !authUser.isAnonymous ? authUser : null
  // Pairing screen: opened by a /pair link, or by "가족에게 받은 코드가 있어요".
  const [pairCode, setPairCode] = useState<string | null>(pairCodeFromUrl)
  // …or by a /pair link that opened the native app.
  useLaunchUrl(setPairCode)
  // Simple edition, web: 앱 없이 이 화면에서 연결하기 on the /pair page links
  // the phone in the browser (?web=1 keeps it across a reload).
  const [webPair, setWebPair] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('web') === '1')
  // Simple edition: a signed-out phone opens on the pairing camera
  // (ElderPairStart) until 가족이에요 says it's the family's own phone.
  const [familyMode, setFamilyMode] = useState(false)
  // Simple edition: 엄마 연결하기 opened from Home (SimpleStart).
  const [connectingParent, setConnectingParent] = useState(false)
  // The digest page: opened by a /digest/{id} link (push, e-mail, message) or
  // from the 알림 list.
  // The simple edition has no digests.
  const [digestId, setDigestId] = useState<string | null>(() => (typeof window === 'undefined' || isSimple() ? null : digestIdFromPath(window.location.pathname)))
  const [tab, setTab] = useState<TabKey>('home')
  const [selectedMemoId, setSelectedMemoId] = useState<string | null>(null)
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS)
  // Whose settings those are: they lag a moment behind a switch of patient.
  const [settingsUid, setSettingsUid] = useState<string | null>(null)
  // Caregiver-share: the user can be looking at their own data (self) or at
  // a patient they're an active caregiver on. `activePatientUid` is the
  // patientUid we're currently rendering — defaults to the signed-in user.
  const [activePatientUid, setActivePatientUid] = useState<string | null>(null)
  // /accept is its own URL: the 가족초대 link sent by KakaoTalk or text message
  // is trackbyphoto.web.app/accept?code=123456.
  const [showAcceptInvite, setShowAcceptInvite] = useState(false)
  const { memberships: { patients }, loading: membershipsLoading } = useMembershipsWrapped(user?.uid)
  // The people this user looks after, as every list shows them (the switcher,
  // 설정 → 함께 보는 가족, the name check in 부모님 등록하기).
  const { names: patientNames, familyPhotos: parentPhotoSettings } = usePatientDocs(useMemo(() => patients.map((p) => p.patientUid), [patients]))
  const people = useMemo(() => listedPeople(patients, patientNames), [patients, patientNames])
  // Elder safeguard notices live on the signed-in user's own account (§8).
  const { unread: notifications, dismiss: dismissNotification } = useNotifications(user?.uid)
  // True once a newer build has been deployed than the one we're running.
  const updateReady = useAppUpdate()
  // A parent's linked phone updates itself; family gets the prompt below.
  useReloadOnReturn(updateReady && !!elder)
  const { memos } = useMemos(activePatientUid || undefined)

  // v2 reactions: off until the rollout flag in admin_config/plans is on.
  const plans = usePlans(!!user)
  const reactionsOn = flagOn(plans, 'reactions')
  const reactions = useReactions(reactionsOn && user ? activePatientUid || undefined : undefined)
  const reactionsByMemo = useMemo(() => byMemo(reactions), [reactions])
  // Looking at one's own records in the regular app: the same 가족 소식 card
  // and reply screen a parent's linked phone has.
  const ownNews = useElderNews(reactionsOn && user && activePatientUid === user.uid ? reactions : null, user?.uid)
  const [openNews, setOpenNews] = useState<OpenNews | null>(null)

  // v2 family push + notification centre, behind its own rollout flag. A
  // parent's linked phone never registers for pushes.
  const pushOn = flagOn(plans, 'pushFamily')
  const digestOn = flagOn(plans, 'digest')
  // 다녀온 곳: one day's (or one digest's) photos as a route.
  const trailOn = flagOn(plans, 'trailMap')
  const [trail, setTrail] = useState<{ start: number; end: number; title: string } | null>(null)
  // v2 plans: 부모님께 드리는 선물 (opened from four places only) and 목소리 앨범.
  const planOn = flagOn(plans, 'planSheet')
  const [planSheet, setPlanSheet] = useState<PlanReason | null>(null)
  const [voiceAlbum, setVoiceAlbum] = useState(false)
  const familyUid = user && !elder ? user.uid : undefined
  // Photos family send to a parent: the switch, and the 대표 가족's setting
  // for this parent (received at all; who may send).
  const familyPhotosFlag = flagOn(plans, 'familyPhotos')
  const familyPhotosOn = familyPhotosFlag && settings.familyPhotos?.enabled !== false
  const viewingParent = !!user && !elder && !!activePatientUid && activePatientUid !== user.uid
  const familyPhotos = useFamilyPhotos(familyPhotosOn && viewingParent ? activePatientUid! : undefined)
  // Whom the 사진 보내기 sheet is open for (from the parent's home, or from one's own).
  const [sendTarget, setSendTarget] = useState<{ uid: string; name: string } | null>(null)
  const sendTargetPhotos = useFamilyPhotos(sendTarget?.uid)
  // Parents this family member may send photos to, offered on their own home.
  const sendTargets = useMemo(() => (familyPhotosFlag && !elder
    ? people
        .filter((p) => canSendFamilyPhoto(parentPhotoSettings[p.patientUid], p.membership.role))
        .map((p) => ({ uid: p.patientUid, name: p.name }))
    : []), [familyPhotosFlag, elder, people, parentPhotoSettings])
  useEffect(() => {
    if (pushOn && familyUid) void refreshPush()
  }, [pushOn, familyUid])
  // A push that was tapped in the installed app; opened once the family's
  // data has loaded (see PushOpener below).
  const [pushed, setPushed] = useState<PushOpened | null>(null)
  useEffect(() => (pushOn && familyUid ? onPushOpened(setPushed) : undefined), [pushOn, familyUid])
  // Keep sending photos that are still on this phone (weak connection).
  useOutboxSync(user?.uid)
  const selectedMemo = selectedMemoId ? memos.find((m) => m.id === selectedMemoId) ?? null : null

  // Initialize activePatientUid when the user signs in. Read the persisted
  // choice from localStorage, falling back to self. Validates the persisted
  // choice still points at a patient we have access to (might have been
  // revoked since last visit).
  useEffect(() => {
    if (!user) { setActivePatientUid(null); return }
    // An account the server says is gone can't be looked at either.
    setActivePatientUid(pickActivePatient({
      stored: localStorage.getItem(activePatientStorageKey(user.uid)),
      selfUid: user.uid,
      patientUids: patients.map((p) => p.patientUid),
      names: patientNames,
      simple: isSimple(),
    }))
    // Re-evaluate when the patients list arrives — a revoked membership
    // should bounce us back to self automatically.
  }, [user, patients, patientNames])

  // Stamp our real name onto any memberships where we're the caregiver, so the
  // patient sees a name (not a UID) in 가족 관리. Backfills older rows too.
  useEffect(() => {
    if (user && !elder) syncCaregiverName().catch((e) => console.warn('[caregiver] name sync failed', e))
  }, [user, elder])

  // /accept and /accept-invite both jump to the accept screen. The code is
  // also stashed so it survives sign-in even if the query string doesn't;
  // AcceptInvite clears it once the invite is accepted or dismissed.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const path = window.location.pathname
    if (path !== '/accept' && path !== '/accept-invite') return
    setShowAcceptInvite(true)
    const code = normalizeInviteCode(new URLSearchParams(window.location.search).get('code') || '')
    if (code.length === 6) {
      try { localStorage.setItem(PENDING_INVITE_KEY, code) } catch { /* storage blocked */ }
    }
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
    // Metadata changes too: that is how "the server confirms there is no
    // such doc" arrives after a first answer from the phone's empty cache.
    const unsub = onSnapshot(sref, { includeMetadataChanges: true }, (snap) => {
      if (snap.exists()) {
        const loaded = { ...DEFAULT_SETTINGS, ...(snap.data() as Partial<UserSettings>) }
        setSettings(loaded)
        setSettingsUid(activePatientUid)
        rememberSettings(activePatientUid, loaded)
        // An account from before 설정 → 언어 takes the phone's language once.
        // Only this one field, and only on the server's answer for one's own
        // account, so nothing else can be overwritten.
        const geoLangUnset = !(snap.data() as Partial<UserSettings>).geoLang
        if (geoLangUnset && !snap.metadata.fromCache && activePatientUid === user.uid && !elder) {
          updateDoc(sref, { geoLang: deviceGeoLang(), lastModifiedBy: user.uid, lastModifiedAt: serverTimestamp() })
            .catch((e) => console.error('[settings] geoLang', e))
        }
      } else if (snap.metadata.fromCache) {
        // No connection, or a slow one: "no such doc" is only the phone's own
        // empty cache talking. Never seed defaults on that (it would replace
        // the real settings once the connection is back); show what this
        // phone last knew until the server answers.
        const known = recallSettings(activePatientUid)
        if (known) setSettings({ ...DEFAULT_SETTINGS, ...known })
      } else if (activePatientUid === user.uid && !elder) {
        // Only seed defaults for the SELF doc — never overwrite a missing
        // doc for someone we're caregiving (could be a transient consistency
        // gap, and we don't want to plant data we don't own).
        setDoc(sref, { ...DEFAULT_SETTINGS, geoLang: deviceGeoLang(), lastModifiedBy: user.uid, lastModifiedAt: serverTimestamp() })
          .catch((e) => console.error('[settings] init', e))
      }
    }, (err) => console.error('[settings] subscription', err))
    return () => unsub()
  }, [user, activePatientUid, elder])

  const onSettingsChange = (next: UserSettings) => {
    setSettings(next)
    if (user && activePatientUid) {
      // Stamp the actor so the audit trigger can attribute the change. Rules
      // require lastModifiedBy == auth.uid, so this can't be forged.
      // plan / dayCounters / channels / digest are the worker's; the rules
      // reject a save that touches them, so never send our copy back.
      const own: Record<string, unknown> = { ...next }
      for (const k of ['plan', 'dayCounters', 'channels', 'digest']) delete own[k]
      setDoc(
        doc(db, 'users', activePatientUid),
        { ...own, lastModifiedBy: user.uid, lastModifiedAt: serverTimestamp() },
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
    setVoiceAlbum(false)
    setSendTarget(null)
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
    document.title = n > 0 ? `(${n}) ${appTitle()}` : appTitle()
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

  // The simple edition is a store app: on the web, a /pair link first helps
  // the parent's phone install it (PairLanding), or links it right here in
  // the browser (webPair). A code typed in (가족에게 받은 연결 코드가 있어요)
  // goes straight to the web pairing screen.
  if (pairCode && isSimple() && !Capacitor.isNativePlatform() && !webPair) {
    const code = pairCode
    return (
      <div className="app">
        <main>
          <PairLanding
            initialCode={code}
            onWebPair={() => {
              window.history.replaceState(null, '', `/pair?c=${encodeURIComponent(code)}&web=1`)
              setWebPair(true)
            }}
          />
        </main>
      </div>
    )
  }

  if (pairCode !== null) {
    const closePair = () => {
      setPairCode(null)
      setWebPair(false)
      window.history.replaceState(null, '', '/')
    }
    return (
      <ToastProvider>
        <div className="app">
          <main>
            <PairDevice
              initialCode={pairCode}
              alreadyLinked={!!elder}
              autoConnect={isSimple() && Capacitor.isNativePlatform()}
              onDone={closePair}
              onCancel={closePair}
            />
          </main>
        </div>
      </ToastProvider>
    )
  }

  if (!user && isSimple() && Capacitor.isNativePlatform() && !familyMode) {
    return (
      <ElderPairStart
        onCode={setPairCode}
        onFamily={() => setFamilyMode(true)}
        onEnterCode={() => setPairCode('')}
      />
    )
  }

  if (!user) {
    // Family members arriving from an invite link still need to sign in first
    // (acceptInvite requires auth). The redirect returns to the same /accept
    // URL, so they land on the confirm screen as soon as they're signed in.
    return (
      <ToastProvider>
        <div className="app">
          <main>
            <SignIn
              onGoogle={signInWithGoogle}
              invited={showAcceptInvite}
              onEnterCode={() => setPairCode('')}
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

  // A family-managed elder's linked phone: capture + own records, nothing else.
  if (elder) {
    return (
      <ToastProvider>
        <ElderApp
          uid={user.uid}
          deviceId={elder.deviceId}
          patientName={settings.patientName}
          memos={memos}
          reactions={reactionsOn ? reactions : null}
          voiceOn={flagOn(plans, 'voiceReplies') && settings.voiceEnabled === true}
          textMode={settings.textReplies}
          familyPhotosOn={familyPhotosOn}
          onRelink={async () => {
            await signOut().catch(() => {})
            setPairCode('')
          }}
        />
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
  // Simple edition before a parent is linked: Home is SimpleStart.
  const simpleUnlinked = isSimple() && isSelf && patients.length === 0

  // Switching to ask/today from elsewhere also drops the detail view so the
  // tab feels like the canonical owner of its screen.
  const onTabChange = (k: TabKey) => {
    setOpenNews(null)
    setSelectedMemoId(null)
    setTrail(null)
    setVoiceAlbum(false)
    if (digestId) closeDigest()
    setTab(k)
  }
  // Tapping the askbtn from Home jumps to the Ask tab — that way it has a
  // place in the nav and back-by-tab works naturally.
  const openAsk = () => onTabChange('ask')

  // The card replaces the plain banner lines for family reactions; opening
  // 가족 소식 clears those notices.
  const isOwnReactionNotice = (n: { type: string; patientUid: string }) => n.type.startsWith('reaction.') && n.patientUid === user.uid
  const bannerNotices = ownNews ? notifications.filter((n) => !isOwnReactionNotice(n)) : notifications
  const openFamilyNews = (news: OpenNews) => {
    notifications.filter(isOwnReactionNotice).forEach((n) => dismissNotification(n.id))
    setOpenNews(news)
  }

  // Opening a notice from 알림: go to whose records it is about, and to the
  // photo when it is already loaded.
  const openDayTrail = (day: Date) => {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate())
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
    setTrail({ start: start.getTime(), end: end.getTime(), title: `${relativeDateLabel(day)} 다녀온 곳` })
  }
  const closeDigest = () => {
    setDigestId(null)
    if (digestIdFromPath(window.location.pathname)) window.history.replaceState(null, '', '/')
  }
  const openNotice = (n: AppNotification) => {
    if (n.digestId && !isSimple()) { setDigestId(n.digestId); return }
    const reachable = n.patientUid === user.uid || patients.some((p) => p.patientUid === n.patientUid)
    if (!reachable) return
    const here = n.patientUid === (activePatientUid || user.uid)
    // "사진이 지워져요" is one of the plan sheet's four doors.
    if (n.type === 'retention.expiring' && planOn) {
      if (!here) onSwitchPatient(n.patientUid)
      setPlanSheet({ kind: 'retention', message: n.message })
      return
    }
    // The parent answered a photo: the sent list on that parent's home.
    if (n.type.startsWith('familyPhoto.')) {
      if (!here) onSwitchPatient(n.patientUid)
      setTab('home')
      return
    }
    // "언니·오빠도 함께 받아보세요" leads to 가족초대.
    if (n.type === 'family.invite_prompt') {
      if (!here) onSwitchPatient(n.patientUid)
      setTab('settings')
      return
    }
    if (n.patientUid !== (activePatientUid || user.uid)) {
      onSwitchPatient(n.patientUid)
      setTab('today')
    } else if (n.memoId && memos.some((m) => m.id === n.memoId)) {
      setSelectedMemoId(n.memoId)
    } else {
      setTab('today')
    }
  }
  const openPush = (p: PushOpened) => {
    setPushed(null)
    if (!p.digestId && !p.patientUid) { setTab('alerts'); return }
    openNotice({
      id: '', recipientUid: user.uid, actorUid: '', message: '', read: true,
      type: p.type ?? '', patientUid: p.patientUid ?? '', memoId: p.memoId, digestId: p.digestId,
    } as AppNotification)
  }
  // This device stops getting pushes for the account that signs out.
  const signOutHere = async () => {
    if (pushOn) await disablePush().catch(() => {})
    await signOut()
  }

  const ent = entitlements(plans, settings.plan?.tier)
  // Whoever manages these records may change the plan; other family only look.
  const myRole = patients.find((p) => p.patientUid === activePatientUid)?.role
  const canSendPhoto = familyPhotosFlag && !isSelf && settingsUid === activePatientUid
    && canSendFamilyPhoto(settings.familyPhotos, myRole)
  const canChangePlan = isSelf ? settings.accountType !== 'managed' : myRole === 'admin' || myRole === 'guardian'
  // 목소리 앨범: family only, on a plan that includes it.
  const voiceAlbumOn = planOn && !isSelf && flagOn(plans, 'voiceReplies') && ent?.voiceAlbum === true

  const rx: ReactionsContext | undefined = reactionsOn ? {
    byMemo: reactionsByMemo,
    me: { uid: user.uid, name: user.displayName || selfLabel },
    patientUid: activePatientUid || user.uid,
    patientName: settings.patientName,
    canReact: !isSelf,
    voiceOn: flagOn(plans, 'voiceReplies'),
    // Someone looking at their own records always hears their own replies;
    // what the plan decides is whether the family does.
    voiceAllowed: isSelf || ent?.voiceReplies === true,
    onVoiceLocked: planOn && !isSelf ? () => setPlanSheet({
      kind: 'voice',
      count: reactions.filter((r) => r.kind === 'voice' && r.actorUid === (activePatientUid || user.uid) && r.status === 'ready').length,
    }) : undefined,
    onReply: isSelf ? (item, unreadIds) => openFamilyNews({ state: 'new', item, unreadIds }) : undefined,
  } : undefined

  return (
    <ToastProvider>
      <PushOpener pushed={pushed} ready={!membershipsLoading} onOpen={openPush} />
      <div className={`app${isSelf ? '' : ' caregiver-mode'}`}>
        {updateReady && (
          <button className="update-prompt" onClick={() => { void reloadToLatest() }}>
            새 버전이 있어요 <span className="update-go">새로고침</span>
          </button>
        )}
        <main>
          {!isSimple() && people.length > 0 && !selectedMemo && !openNews && !digestId && !trail && !voiceAlbum && (
            <PatientSwitcher
              selfUid={user.uid}
              selfLabel={selfLabel}
              people={people}
              activePatientUid={activePatientUid || user.uid}
              onChange={onSwitchPatient}
            />
          )}
          {openNews ? (
            <FamilyNews
              uid={user.uid}
              patientName={settings.patientName}
              item={openNews.item}
              unreadIds={openNews.unreadIds}
              memo={memos.find((m) => m.id === openNews.item.memoId)}
              voiceOn={flagOn(plans, 'voiceReplies') && settings.voiceEnabled === true}
              textMode={settings.textReplies}
              backLabel="‹ 뒤로"
              onDone={() => setOpenNews(null)}
            />
          ) : selectedMemo ? (
            <MemoDetail memo={selectedMemo} onBack={() => setSelectedMemoId(null)} rx={rx} />
          ) : trail ? (
            <Trail
              title={trail.title}
              memos={memos.filter((m) => { const t = m.takenAt.toMillis(); return t >= trail.start && t < trail.end })}
              home={homeFor(settings.home, memos)}
              onBack={() => setTrail(null)}
              onOpenMemo={setSelectedMemoId}
            />
          ) : voiceAlbum && voiceAlbumOn ? (
            <VoiceAlbum
              patientUid={activePatientUid || user.uid}
              patientName={settings.patientName}
              knownMemos={memos}
              onBack={() => setVoiceAlbum(false)}
              onOpenMemo={setSelectedMemoId}
            />
          ) : digestId ? (
            <DigestPage
              digestId={digestId}
              knownMemos={memos}
              onBack={closeDigest}
              onOpenMemo={(d, memoId) => {
                // A photo that is already loaded opens over the digest (뒤로
                // comes back to it); otherwise go to that parent's records.
                if (d.patientUid === (activePatientUid || user.uid) && memos.some((m) => m.id === memoId)) {
                  setSelectedMemoId(memoId)
                } else {
                  onSwitchPatient(d.patientUid)
                  closeDigest()
                  setTab('today')
                }
              }}
              onMore={(d) => {
                if (d.patientUid !== (activePatientUid || user.uid)) onSwitchPatient(d.patientUid)
                closeDigest()
                setTab('today')
              }}
              onOpenTrail={trailOn ? (d) => {
                // Opens over the digest; 뒤로 comes back to it.
                if (d.patientUid !== (activePatientUid || user.uid)) onSwitchPatient(d.patientUid)
                setTrail({ start: d.periodStart?.toMillis() ?? 0, end: d.periodEnd?.toMillis() ?? Date.now(), title: `${d.label} 다녀온 곳` })
              } : undefined}
            />
          ) : (
            <>
              {tab === 'home'     && pushOn && <InstallHint />}
              {tab === 'alerts'   && <Notifications uid={user.uid} onOpen={openNotice} digestOn={digestOn} emailOffered={flagOn(plans, 'emailDigest')} messengerIncluded={flagOn(plans, 'messengerFree') || ent?.messenger === true} messengerFrom={fromTier(plans, 'messenger')} />}
              {/* Simple edition, no parent linked yet: just how to start. */}
              {tab === 'home'     && simpleUnlinked && !membershipsLoading && <SimpleStart name={selfLabel} onConnect={() => setConnectingParent(true)} />}
              {tab === 'home'     && !simpleUnlinked && <Home uid={activePatientUid || user.uid} patientName={settings.patientName} greetingName={isSelf ? selfLabel : settings.patientName} memos={memos} onOpenAsk={openAsk} onOpen={setSelectedMemoId} canCapture={isSelf} notifications={bannerNotices} onDismissNotification={dismissNotification} topCard={pushOn && patients.length > 0 ? <PushNudge /> : undefined} onSendPhoto={canSendPhoto ? () => setSendTarget({ uid: activePatientUid!, name: settings.patientName }) : undefined} sendTargets={isSelf ? sendTargets : undefined} onSendTo={setSendTarget} sentPhotos={familyPhotosOn && !isSelf ? <SentFamilyPhotos photos={familyPhotos} myUid={user.uid} /> : undefined} newsCard={ownNews && <FamilyNewsCard news={ownNews} onOpen={() => { if (ownNews.state !== 'none') openFamilyNews(ownNews) }} />} />}
              {connectingParent && (
                <RegisterElder
                  onClose={() => setConnectingParent(false)}
                  onRegistered={(uid) => { onSwitchPatient(uid); setTab('home') }}
                  takenNames={people.map((p) => p.name)}
                />
              )}
              {tab === 'today'    && <Today memos={memos} onOpen={setSelectedMemoId} uid={activePatientUid || user.uid} rx={rx} onOpenTrail={trailOn ? openDayTrail : undefined} onOpenVoiceAlbum={voiceAlbumOn ? () => setVoiceAlbum(true) : undefined} />}
              {tab === 'ask'      && <Ask memos={memos} onOpen={setSelectedMemoId} />}
              {tab === 'settings' && (
                <Settings
                  settings={settings}
                  onChange={onSettingsChange}
                  user={user}
                  onSignOut={signOutHere}
                  memos={memos}
                  activePatientUid={activePatientUid || user.uid}
                  isSelf={isSelf}
                  onSwitchPatient={(uid) => { onSwitchPatient(uid); setTab('home') }}
                  myRole={myRole}
                  people={people}
                  voiceRollout={flagOn(plans, 'voiceReplies')}
                  reactionsRollout={reactionsOn}
                  digestRollout={digestOn}
                  weeklyIncluded={ent?.weekly === true}
                  familyPhotosRollout={familyPhotosFlag}
                  weeklyFrom={fromTier(plans, 'weekly')}
                  onOpenPlans={planOn && plans ? setPlanSheet : undefined}
                  planName={TIER_NAME[settings.plan?.tier ?? 'free']}
                  familyLimit={ent?.familyMembers ?? null}
                />
              )}
            </>
          )}
        </main>

        {sendTarget && (
          <SendFamilyPhoto
            patientUid={sendTarget.uid}
            patientName={sendTarget.name}
            sender={{ uid: user.uid, name: user.displayName || selfLabel }}
            photos={sendTargetPhotos}
            onClose={() => setSendTarget(null)}
          />
        )}
        {planSheet && planOn && plans && settingsUid === (activePatientUid || user.uid) && (
          <PlanSheet
            plans={plans}
            patientUid={activePatientUid || user.uid}
            patientName={settings.patientName}
            plan={settings.plan}
            reason={planSheet}
            canChange={canChangePlan}
            onClose={() => setPlanSheet(null)}
          />
        )}

        <Tabs active={tab} onChange={onTabChange} avatarUrl={user.photoURL ?? undefined} unreadCount={notifications.length} showAlerts={pushOn || digestOn} />
      </div>
    </ToastProvider>
  )
}

/** Opens what a tapped push points at, once whose records the person follows is known. */
function PushOpener({ pushed, ready, onOpen }: { pushed: PushOpened | null; ready: boolean; onOpen: (p: PushOpened) => void }) {
  useEffect(() => {
    if (pushed && ready) onOpen(pushed)
  }, [pushed, ready, onOpen])
  return null
}

// Wrap useMemberships so the caller can destructure either name shape. The
// hook returns { caregivers, patients, loading } directly; this helper
// nests it under `memberships` for the App body's destructure clarity.
function useMembershipsWrapped(uid: string | undefined) {
  const m = useMemberships(uid)
  return { memberships: { caregivers: m.caregivers, patients: m.patients }, loading: m.loading }
}

export default App
