export type TabKey = 'home' | 'today' | 'settings'

const TABS: { key: TabKey; ic: string; label: string }[] = [
  { key: 'home',     ic: '🏠', label: '홈' },
  { key: 'today',    ic: '📅', label: '오늘' },
  { key: 'settings', ic: '⚙️', label: '설정' },
]

export function Tabs({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <nav className="tabs">
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
