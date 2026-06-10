export type TabKey = 'home' | 'today' | 'ask' | 'settings'

// Bottom nav — frosted bar at the bottom of every main page. Hidden when a
// memo detail / modal takes over (App.tsx controls that via the `hide` prop).
//
// Icons are inline SVGs rather than emoji so the active-tab tint actually
// applies (emoji ignore color). The four tabs mirror the prototype:
//   사진 (Home) · 오늘 (Today) · 물어보기 (Ask) · 설정 (Settings)
const ICONS = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9l8-5 8 5v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    </svg>
  ),
  today: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="M21 16l-5-5-9 8" />
    </svg>
  ),
  ask: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20.5 20.5l-3.6-3.6" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
    </svg>
  ),
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'home',     label: '홈' },
  { key: 'today',    label: '사진' },
  { key: 'ask',      label: '물어보기' },
  { key: 'settings', label: '설정' },
]

export function Tabs({
  active,
  onChange,
  hide,
  avatarUrl,
}: {
  active: TabKey
  onChange: (k: TabKey) => void
  /** Hide the bar entirely (e.g. while MemoDetail is open). */
  hide?: boolean
  /** Signed-in user's Google avatar — shown on the settings tab in place of
   *  the gear when present. Falls back to the gear icon when absent. */
  avatarUrl?: string
}) {
  if (hide) return null
  return (
    <nav className="tabbar" aria-label="주 메뉴">
      {TABS.map((t) => (
        <button
          key={t.key}
          className={`tab ${active === t.key ? 'on' : ''}`}
          onClick={() => onChange(t.key)}
          aria-label={t.label}
          aria-current={active === t.key ? 'page' : undefined}
        >
          {t.key === 'settings' && avatarUrl
            ? <img className="tab-avatar" src={avatarUrl} alt="" referrerPolicy="no-referrer" />
            : ICONS[t.key]}
          {t.label}
        </button>
      ))}
    </nav>
  )
}
