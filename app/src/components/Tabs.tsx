export type TabKey = 'home' | 'today' | 'settings'

const TABS: { key: TabKey; ic: string; label: string }[] = [
  { key: 'home',     ic: '🏠', label: '홈' },
  { key: 'today',    ic: '📅', label: '오늘' },
  { key: 'settings', ic: '⚙️', label: '설정' },
]

export function Tabs({
  active,
  onChange,
  onBack,
}: {
  active: TabKey
  onChange: (k: TabKey) => void
  // When present, render a back button as the leading nav item. The detail
  // page passes this so users can leave the detail view without reaching the
  // top of the screen.
  onBack?: () => void
}) {
  return (
    <nav className="tabs">
      {onBack && (
        <button
          key="back"
          className="back-tab"
          onClick={onBack}
          aria-label="뒤로가기"
        >
          <div className="ic">←</div>
          뒤로
        </button>
      )}
      {TABS.map((t) => (
        <button
          key={t.key}
          className={active === t.key ? 'on' : ''}
          onClick={() => onChange(t.key)}
          aria-label={t.label}
          aria-current={active === t.key ? 'page' : undefined}
        >
          <div className="ic">{t.ic}</div>
          {t.label}
        </button>
      ))}
    </nav>
  )
}
