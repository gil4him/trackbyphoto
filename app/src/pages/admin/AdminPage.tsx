// dayliesimple.web.app/admin — the admin dashboard shell.
//
// Tabs and the open person live in the query string (?tab=parents&uid=…) so
// a page is linkable and the back button works. The people list comes from
// the Mac mini worker (adminListPeople) and is reloaded after every change.

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import {
  ADMIN_TABS, adminListPeople, routeFromSearch, searchFromRoute,
  type AdminPerson, type AdminRoute,
} from '../../lib/admin'
import { WorkerError } from '../../lib/worker'
import { useWorkerStatus } from '../../hooks/useWorkerStatus'
import { OverviewTab } from './OverviewTab'
import { PeopleTab } from './PeopleTab'
import { PersonDetail } from './PersonDetail'
import { SuperAdmin } from '../SuperAdmin'

export function AdminPage({ user, onSignOut }: { user: User; onSignOut: () => Promise<void> }) {
  const [route, setRoute] = useState<AdminRoute>(() => routeFromSearch(typeof window === 'undefined' ? '' : window.location.search))
  // `gen` counts list requests; `list` is the last answer. Loading is the gap.
  const [gen, setGen] = useState(1)
  const [list, setList] = useState<{ gen: number; people: AdminPerson[]; at: Date | null; error: string | null }>({ gen: 0, people: [], at: null, error: null })
  const { people, at: loadedAt, error } = list
  const loading = list.gen !== gen
  const worker = useWorkerStatus(true)

  const go = useCallback((next: Partial<AdminRoute>, push = true) => {
    setRoute((cur) => {
      const r = { ...cur, ...next }
      const url = `/admin${searchFromRoute(r)}`
      if (push) window.history.pushState(null, '', url)
      else window.history.replaceState(null, '', url)
      return r
    })
  }, [])

  useEffect(() => {
    const onPop = () => setRoute(routeFromSearch(window.location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const reload = useCallback(() => setGen((g) => g + 1), [])

  useEffect(() => {
    let cancelled = false
    adminListPeople().then(
      (people) => { if (!cancelled) setList({ gen, people, at: new Date(), error: null }) },
      (err) => {
        if (cancelled) return
        console.error('[admin] list', err)
        const message = err instanceof WorkerError && err.code === 'unavailable'
          ? '서버(Mac mini)가 응답하지 않아요. 목록은 서버가 돌아오면 불러와져요.'
          : `목록을 불러오지 못했어요: ${(err as Error).message}`
        setList((cur) => ({ ...cur, gen, error: message }))
      },
    )
    return () => { cancelled = true }
  }, [gen])

  const openPerson = (uid: string) => {
    const p = people.find((x) => x.uid === uid)
    go({ tab: p ? (p.kind === 'parent' ? 'parents' : 'children') : route.tab === 'overview' || route.tab === 'ai' ? 'parents' : route.tab, uid })
  }

  return (
    <div className="admin-shell">
      <header className="admin-shell-head">
        <div className="admin-shell-title">
          <h1>오늘하루 관리자</h1>
          <span className="muted">dayliesimple.web.app/admin</span>
        </div>
        <div className="admin-shell-meta">
          <span className={`admin-worker ${worker}`} title="Mac mini worker">
            ● {worker === 'ok' ? '서버 정상' : worker === 'down' ? '서버 꺼짐' : '서버 확인 중'}
          </span>
          <button type="button" className="admin-btn small" onClick={reload} disabled={loading}>
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
          {loadedAt && <span className="muted admin-loaded">{loadedAt.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })} 기준</span>}
          <span className="muted admin-me">{user.email}</span>
          <button type="button" className="admin-signout" onClick={() => void onSignOut()}>로그아웃</button>
        </div>
      </header>

      <nav className="admin-tabs" aria-label="관리자 메뉴">
        {ADMIN_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`admin-tab ${route.tab === t.key ? 'active' : ''}`}
            onClick={() => go({ tab: t.key, uid: null })}
          >
            {t.label}
            {t.key === 'parents' && people.length > 0 && <span className="admin-tab-n">{people.filter((p) => p.kind === 'parent').length}</span>}
            {t.key === 'children' && people.length > 0 && <span className="admin-tab-n">{people.filter((p) => p.kind === 'child' && !p.isAdmin).length}</span>}
          </button>
        ))}
      </nav>

      <main className="admin-shell-main">
        {error && <div className="admin-error">{error}</div>}

        {route.uid ? (
          <PersonDetail
            key={route.uid}
            uid={route.uid}
            onBack={() => window.history.length > 1 ? window.history.back() : go({ uid: null })}
            onOpen={openPerson}
            onChanged={reload}
          />
        ) : route.tab === 'overview' ? (
          <OverviewTab people={people} loading={loading} onOpen={openPerson} onTab={(tab) => go({ tab })} />
        ) : route.tab === 'parents' ? (
          <PeopleTab kind="parent" people={people} loading={loading} onOpen={openPerson} />
        ) : route.tab === 'children' ? (
          <PeopleTab kind="child" people={people} loading={loading} onOpen={openPerson} />
        ) : (
          <SuperAdmin />
        )}
      </main>
    </div>
  )
}
