export type TabKey = 'home' | 'today' | 'settings'

// The nav layout is identical on every page so positions never shift under
// the user's thumb. Back lives between Today and Settings; it's disabled
// when there's no back action (i.e. on the top-level tabs themselves).
// Note: 설정 is planned to become "내 정보" once per-user login lands.
const TABS_BEFORE: { key: TabKey; ic: string; label: string }[] = [
  { key: 'home',  ic: '🏠', label: '홈' },
  { key: 'today', ic: '📅', label: '오늘' },
]
const TABS_AFTER: { key: TabKey; ic: string; label: string }[] = [
  { key: 'settings', ic: '⚙️', label: '설정' },
]

export function Tabs({
  active,
  onChange,
  onBack,
}: {
  active: TabKey
  onChange: (k: TabKey) => void
  // Provided only when there is somewhere to go back to (e.g. memo detail).
  // The button is always rendered for layout stability, just disabled when
  // this is undefined.
  onBack?: () => void
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

  return (
    <nav className="tabs">
      {TABS_BEFORE.map(renderTab)}
      <button
        key="back"
        className="back-tab"
        onClick={() => onBack?.()}
        aria-label="뒤로가기"
        disabled={!onBack}
      >
        <div className="ic">←</div>
        뒤로
      </button>
      {TABS_AFTER.map(renderTab)}
    </nav>
  )
}
