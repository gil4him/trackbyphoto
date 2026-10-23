// The admin dashboard renders its tabs and people from the worker's list.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), doc: () => ({}), query: () => ({}), orderBy: () => ({}), limit: () => ({}),
  getDocs: async () => ({ docs: [] }), onSnapshot: () => () => {}, setDoc: async () => {},
}))
vi.mock('../../lib/worker', () => ({
  callWorker: vi.fn(), isWorkerOffline: () => false, WorkerError: class extends Error { code = '' }, WORKER_OFFLINE_MESSAGE: '',
}))
vi.mock('../../hooks/useWorkerStatus', () => ({
  useWorkerStatus: () => 'ok',
  useWorkerBeat: () => ({ status: 'ok', lastSeenMs: 1_000_000 - 22_000, now: 1_000_000 }),
}))

import { PeopleTab } from './PeopleTab'
import { OverviewTab } from './OverviewTab'
import { AdminPage } from './AdminPage'
import { ADMIN_TABS, beatAgo, familyCount, fmtAgo, matchesQuery, personFlags, routeFromSearch, searchFromRoute, sortPeople, type AdminPerson } from '../../lib/admin'
import type { User } from 'firebase/auth'

const base = {
  providers: [], disabled: false, isAdmin: false, hasSettings: true,
  createdAt: '2026-10-01T00:00:00.000Z', lastRefreshAt: null,
  plan: { tier: 'free' as const, status: null, since: null, explicit: false },
}
const MOM: AdminPerson = {
  ...base, uid: 'mom1', kind: 'parent', name: '엄마', email: null, lastSignInAt: null,
  memos: { count: 12, lastAt: '2026-10-10T09:00:00.000Z' }, links: { active: 2, guardians: 1 }, devices: { active: 1, total: 1 },
}
const DAD: AdminPerson = {
  ...base, uid: 'dad1', kind: 'parent', name: '아빠', email: null, lastSignInAt: null,
  memos: { count: 0, lastAt: null }, links: { active: 0, guardians: 0 }, devices: { active: 0, total: 0 },
}
const KID: AdminPerson = {
  ...base, uid: 'kid1', kind: 'child', name: '지은', email: 'jieun@example.com', providers: ['google.com'],
  lastSignInAt: '2026-10-11T01:00:00.000Z', memos: { count: 3, lastAt: null }, links: { active: 1, guardians: 1 }, devices: { active: 0, total: 0 },
  plan: { tier: 'plus', status: 'active', since: '2026-10-02T00:00:00.000Z', explicit: true },
}
const people = [MOM, DAD, KID]

describe('AdminPage', () => {
  const page = () => renderToString(<AdminPage user={{ uid: 'a', email: 'zymer4him@gmail.com' } as unknown as User} onSignOut={async () => {}} />)

  it('shows the 운영실 menu in order, AI 도구 last, with the signed-in admin', () => {
    const html = page()
    expect(html).toContain('Daylie 운영실')
    expect(html).toContain('aria-label="운영실 메뉴"')
    const labels = ['오늘', '할 일', '성장', '가족', '매출', '비용', '시스템', '기능 스위치', 'AI 도구']
    expect(ADMIN_TABS.map((t) => t.label)).toEqual(labels)
    const at = labels.map((l) => html.indexOf(`>${l}<`))
    expect(at.every((i) => i > 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    for (const s of ['zymer4him@gmail.com', '로그아웃', '불러오는 중…']) expect(html).toContain(s)
  })

  it('has the live worker dot and the age of its last beat in the footer', () => {
    const html = page()
    expect(html).toContain('메모 서버 정상')
    expect(html).toContain('마지막 신호 22초 전')
    expect(html).toContain('hq-dot ok')
  })
})

describe('운영실 routes', () => {
  it('keeps the view, the 가족 kind and the open person in the query string', () => {
    expect(routeFromSearch('')).toEqual({ tab: 'today', kind: 'parent', uid: null })
    expect(routeFromSearch('?tab=inbox')).toEqual({ tab: 'inbox', kind: 'parent', uid: null })
    expect(routeFromSearch('?tab=families&kind=child&uid=kid1')).toEqual({ tab: 'families', kind: 'child', uid: 'kid1' })
    expect(routeFromSearch('?tab=nope')).toEqual({ tab: 'today', kind: 'parent', uid: null })
    expect(searchFromRoute({ tab: 'today', kind: 'parent', uid: null })).toBe('')
    expect(searchFromRoute({ tab: 'flags', kind: 'parent', uid: null })).toBe('?tab=flags')
    expect(searchFromRoute({ tab: 'families', kind: 'child', uid: 'kid1' })).toBe('?tab=families&kind=child&uid=kid1')
  })

  it('lands the old tab names on their new views', () => {
    expect(routeFromSearch('?tab=overview')).toEqual({ tab: 'today', kind: 'parent', uid: null })
    expect(routeFromSearch('?tab=parents')).toEqual({ tab: 'families', kind: 'parent', uid: null })
    expect(routeFromSearch('?tab=children&uid=kid1')).toEqual({ tab: 'families', kind: 'child', uid: 'kid1' })
    expect(routeFromSearch('?tab=ai')).toEqual({ tab: 'ai', kind: 'parent', uid: null })
    expect(searchFromRoute(routeFromSearch('?tab=parents'))).toBe('?tab=families&kind=parent')
    expect(searchFromRoute(routeFromSearch('?tab=overview'))).toBe('')
  })

  it('says how long ago the worker last beat', () => {
    expect(beatAgo(null, 0)).toBe('신호 없음')
    expect(beatAgo(78_000, 100_000)).toBe('마지막 신호 22초 전')
    expect(beatAgo(0, 5 * 60_000 + 30_000)).toBe('마지막 신호 5분 전')
    expect(beatAgo(0, 2 * 3600_000)).toBe('마지막 신호 2시간 전')
    expect(beatAgo(200_000, 100_000)).toBe('마지막 신호 0초 전')
  })

  it('counts a family as a parent someone actively looks after', () => {
    expect(familyCount(people)).toBe(1)
    expect(familyCount([])).toBe(0)
  })
})

describe('PeopleTab', () => {
  it('lists parents with their phone, family and photo state', () => {
    const html = renderToString(<PeopleTab kind="parent" people={people} loading={false} onOpen={() => {}} />)
    expect(html).toContain('엄마')
    expect(html).toContain('연결 1대')
    expect(html).toContain('아빠')
    expect(html).toContain('대표 가족 없음')
    expect(html).toContain('휴대폰 미연결')
    expect(html).not.toContain('jieun@example.com')
    expect(html).toContain('2 / 2명')
  })

  it('lists family members with their email, sign-in and plan', () => {
    const html = renderToString(<PeopleTab kind="child" people={people} loading={false} onOpen={() => {}} />)
    expect(html).toContain('지은')
    expect(html).toContain('jieun@example.com')
    expect(html).toContain('Google')
    expect(html).toContain('Plus')
    expect(html).not.toContain('엄마')
  })

  it('says so when there is nobody yet', () => {
    const html = renderToString(<PeopleTab kind="child" people={[MOM]} loading={false} onOpen={() => {}} />)
    expect(html).toContain('아직 가족 계정이 없어요')
  })
})

describe('OverviewTab', () => {
  it('counts people and points at the ones that need a look', () => {
    const html = renderToString(<OverviewTab people={people} loading={false} onOpen={() => {}} onKind={() => {}} />)
    expect(html).toContain('연결된 휴대폰')
    expect(html).toContain('1명 미연결')
    expect(html).toContain('확인 필요')
    expect(html).toContain('아빠')
    expect(html).toContain('최근 가입')
  })
})

describe('people helpers', () => {
  it('flags a parent without a guardian or a phone, and a blocked sign-in', () => {
    expect(personFlags(DAD).map((f) => f.key)).toEqual(['no-guardian', 'no-phone'])
    expect(personFlags(MOM)).toEqual([])
    expect(personFlags({ ...KID, disabled: true }).map((f) => f.key)).toEqual(['disabled'])
  })

  it('searches name, email and uid prefix', () => {
    expect(matchesQuery(KID, 'jieun')).toBe(true)
    expect(matchesQuery(KID, '지')).toBe(true)
    expect(matchesQuery(KID, 'kid')).toBe(true)
    expect(matchesQuery(KID, 'mom')).toBe(false)
    expect(matchesQuery(KID, '  ')).toBe(true)
  })

  it('sorts by recent activity, creation or name', () => {
    expect(sortPeople(people, 'recent').map((p) => p.uid)).toEqual(['kid1', 'mom1', 'dad1'])
    expect(sortPeople(people, 'name').map((p) => p.name)).toEqual(['아빠', '엄마', '지은'])
  })

  it('says how long ago in Korean', () => {
    const now = Date.parse('2026-10-11T12:00:00Z')
    expect(fmtAgo('2026-10-11T11:59:30Z', now)).toBe('방금')
    expect(fmtAgo('2026-10-11T09:00:00Z', now)).toBe('3시간 전')
    expect(fmtAgo('2026-10-01T12:00:00Z', now)).toBe('10일 전')
    expect(fmtAgo(null, now)).toBe('—')
  })
})
