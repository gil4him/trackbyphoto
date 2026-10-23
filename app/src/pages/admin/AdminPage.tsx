// dayliesimple.web.app/admin — Daylie 운영실, the admin dashboard shell.
//
// A left menu (one scrolling tab row on phones) and one view at a time. The
// view, the 가족 list's kind and the open person live in the query string
// (?tab=families&kind=parent&uid=…) so a page is linkable and the back button
// works; the tab names from before 운영실 still land (routeFromSearch). The
// people list comes from the Mac mini worker (adminListPeople) and is
// reloaded after every change. Design: docs/admin/admin-hq-mockup.html.

import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import {
  ADMIN_TABS, adminListPeople, beatAgo, familyCount, routeFromSearch, searchFromRoute,
  type AdminPerson, type AdminRoute, type AdminTab,
} from '../../lib/admin'
import { WorkerError } from '../../lib/worker'
import { isSimple } from '../../lib/edition'
import { useWorkerBeat } from '../../hooks/useWorkerStatus'
import { TodayView } from './TodayView'
import { PeopleTab } from './PeopleTab'
import { PersonDetail } from './PersonDetail'
import { SuperAdmin } from '../SuperAdmin'

const WORKER_KO = { ok: '메모 서버 정상', down: '메모 서버 멈춤', unknown: '메모 서버 확인 중' } as const

/** The views of later phases (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D2–D8). */
const COMING: Partial<Record<AdminTab, string>> = {
  inbox: '처리할 일을 한곳에 모아 보여드릴 거예요.',
  growth: '가입부터 매일 쓰기까지, 가족이 어디서 멈추는지 보여드릴 거예요.',
  revenue: '플랜별 가족과 한 달에 남는 돈을 보여드릴 거예요.',
  costs: 'AI 메모와 Firebase 비용을 보여드릴 거예요.',
  system: '메모 서버의 신호와 메모 시간을 자세히 보여드릴 거예요.',
  flags: '앱 기능을 켜고 끄고, 누가 언제 바꿨는지 보여드릴 거예요.',
}

export function AdminPage({ user, onSignOut }: { user: User; onSignOut: () => Promise<void> }) {
  const [route, setRoute] = useState<AdminRoute>(() => routeFromSearch(typeof window === 'undefined' ? '' : window.location.search))
  // `gen` counts list requests; `list` is the last answer. Loading is the gap.
  const [gen, setGen] = useState(1)
  const [list, setList] = useState<{ gen: number; people: AdminPerson[]; at: Date | null; error: string | null }>({ gen: 0, people: [], at: null, error: null })
  const { people, at: loadedAt, error } = list
  const loading = list.gen !== gen
  const worker = useWorkerBeat(true, 5_000)

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
    // An old ?tab= name is shown under its new address.
    const want = `/admin${searchFromRoute(routeFromSearch(window.location.search))}`
    if (window.location.pathname + window.location.search !== want) window.history.replaceState(null, '', want)
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
    go({ tab: 'families', kind: p?.kind ?? route.kind, uid })
  }
  const families = loading ? null : familyCount(people)
  const label = ADMIN_TABS.find((t) => t.key === route.tab)?.label ?? ''

  return (
    <div className="hq">
      <aside className="hq-side">
        <div className="hq-side-in">
        <div className="hq-brand">
          <i aria-hidden="true">D</i>
          <span><b>Daylie 운영실</b><small>{isSimple() ? 'Simple · 베타' : 'Full'}</small></span>
        </div>
        <nav className="hq-nav" aria-label="운영실 메뉴">
          {ADMIN_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-current={route.tab === t.key ? 'page' : undefined}
              onClick={() => go({ tab: t.key, uid: null })}
            >
              {t.label}
              {t.key === 'families' && families !== null && <span className="hq-badge soft num">{families}</span>}
            </button>
          ))}
        </nav>
        <div className="hq-foot">
          <div className="hq-live"><span className={`hq-dot ${worker.status}`} aria-hidden="true" />{WORKER_KO[worker.status]}</div>
          <span className="num">{beatAgo(worker.lastSeenMs, worker.now)}</span>
        </div>
        </div>
      </aside>

      <main className="hq-main">
        <div className="hq-bar">
          <span className="hq-bar-status">
            <span className="hq-bar-live"><span className={`hq-dot ${worker.status}`} aria-hidden="true" />{WORKER_KO[worker.status]}</span>
            {loadedAt && <span className="muted num">{loadedAt.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })} 기준</span>}
          </span>
          <span className="hq-me muted">{user.email}</span>
          <button type="button" className="admin-btn small" onClick={reload} disabled={loading}>
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
          <button type="button" className="admin-signout" onClick={() => void onSignOut()}>로그아웃</button>
        </div>

        <div className="hq-view">
          {error && <div className="admin-error">{error}</div>}

          {route.uid ? (
            <PersonDetail
              key={route.uid}
              uid={route.uid}
              onBack={() => window.history.length > 1 ? window.history.back() : go({ uid: null })}
              onOpen={openPerson}
              onChanged={reload}
            />
          ) : route.tab === 'today' ? (
            <TodayView people={people} peopleLoading={loading} worker={worker} refreshKey={gen - 1} onOpen={openPerson} onGo={(tab) => go({ tab, uid: null })} />
          ) : route.tab === 'families' ? (
            <>
              <div className="hq-seg" role="group" aria-label="보기">
                <button type="button" aria-pressed={route.kind === 'parent'} onClick={() => go({ kind: 'parent' }, false)}>부모님</button>
                <button type="button" aria-pressed={route.kind === 'child'} onClick={() => go({ kind: 'child' }, false)}>가족</button>
              </div>
              <PeopleTab key={route.kind} kind={route.kind} people={people} loading={loading} onOpen={openPerson} />
            </>
          ) : route.tab === 'ai' ? (
            <SuperAdmin />
          ) : (
            <section className="hq-card hq-soon">
              <h2>{label}</h2>
              <p>곧 만들어요. {COMING[route.tab]}</p>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
