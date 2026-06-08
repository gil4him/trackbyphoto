import type { User } from 'firebase/auth'

export type TabKey = 'home' | 'today' | 'settings'

// The nav layout is identical on every page so positions never shift under
// the user's thumb. Back lives between Today and the Me tab; it's disabled
// when there's no back action (i.e. on the top-level tabs themselves).
const TABS_BEFORE: { key: TabKey; ic: string; label: string }[] = [
  { key: 'home',  ic: '🏠', label: '홈' },
  { key: 'today', ic: '📅', label: '오늘' },
]

export function Tabs({
  active,
  onChange,
  onBack,
  user,
}: {
  active: TabKey
  onChange: (k: TabKey) => void
  // Provided only when there is somewhere to go back to (e.g. memo detail).
  // The button is always rendered for layout stability, just disabled when
  // this is undefined.
  onBack?: () => void
  // The signed-in user — the "Me" tab shows their Google avatar.
  user: User
}) {
  const renderTab = (t: { key: TabKey; ic: string; label: string }) => (
    <button
      key={t.key}
      className={active === t.key && !onBack ? 'on' : ''}
      onClick={() => onChange(t.key)}
      aria-label={t.label}
      aria-current={active === t.key && !onBack ? 'page' : undefined}
    >
      <div className="ic">{t.ic}</div>
      {t.label}
    </button>
  )

  const meActive = active === 'settings' && !onBack
  const initial = (user.displayName || user.email || '나').trim().charAt(0).toUpperCase()

  return (
    <nav className="tabs">
      {TABS_BEFORE.map(renderTab)}

      <button
        key="back"
        className={`back-tab ${onBack ? 'back-tab-active' : ''}`}
        onClick={() => onBack?.()}
        aria-label="뒤로가기"
        disabled={!onBack}
      >
        <div className="ic back-ic">←</div>
        뒤로
      </button>

      <button
        key="settings"
        className={`me-tab ${meActive ? 'on' : ''}`}
        onClick={() => onChange('settings')}
        aria-label="내 정보"
        aria-current={meActive ? 'page' : undefined}
      >
        <div className={`avatar-ic ${meActive ? 'on' : ''}`}>
          {user.photoURL ? (
            <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="avatar-initial">{initial}</span>
          )}
        </div>
        나
      </button>
    </nav>
  )
}
