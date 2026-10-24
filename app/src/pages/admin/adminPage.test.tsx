// The admin dashboard renders its tabs and people from the worker's list.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), doc: () => ({}), query: () => ({}), orderBy: () => ({}), limit: () => ({}),
  getDocs: async () => ({ docs: [] }), getDoc: async () => ({ exists: () => false }), where: () => ({}), serverTimestamp: () => null, Timestamp: { fromMillis: () => null }, onSnapshot: () => () => {}, setDoc: async () => {},
}))
vi.mock('../../lib/worker', () => ({
  callWorker: vi.fn(), isWorkerOffline: () => false, WorkerError: class extends Error { code = '' }, WORKER_OFFLINE_MESSAGE: '',
}))
vi.mock('../../hooks/useWorkerStatus', () => ({
  useWorkerStatus: () => 'ok',
  useWorkerBeat: () => ({ status: 'ok', lastSeenMs: 1_000_000 - 22_000, modelUp: true, waiting: 0, now: 1_000_000 }),
}))

import { PeopleTab } from './PeopleTab'
import { TodayView } from './TodayView'
import { InboxView } from './InboxView'
import { GrowthView } from './GrowthView'
import { FamiliesTable } from './FamiliesTable'
import { RevenueView } from './RevenueView'
import { CostsView } from './CostsView'
import { ToastProvider } from '../../components/Toast'
import type { Inbox } from '../../lib/adminInbox'
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
  memos: { count: 12, lastAt: '2026-10-10T09:00:00.000Z' }, links: { active: 2, guardians: 1 }, devices: { active: 1, total: 1, platforms: ['ios'] }, linkUids: ['kid1'],
}
const DAD: AdminPerson = {
  ...base, uid: 'dad1', kind: 'parent', name: '아빠', email: null, lastSignInAt: null,
  memos: { count: 0, lastAt: null }, links: { active: 0, guardians: 0 }, devices: { active: 0, total: 0, platforms: [] }, linkUids: [],
}
const KID: AdminPerson = {
  ...base, uid: 'kid1', kind: 'child', name: '지은', email: 'jieun@example.com', providers: ['google.com'],
  lastSignInAt: '2026-10-11T01:00:00.000Z', memos: { count: 3, lastAt: null }, links: { active: 1, guardians: 1 }, devices: { active: 0, total: 0, platforms: [] }, linkUids: ['mom1'],
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
    expect(routeFromSearch('')).toEqual({ tab: 'today', kind: 'parent', uid: null, filter: 'all' })
    expect(routeFromSearch('?tab=inbox')).toEqual({ tab: 'inbox', kind: 'parent', uid: null, filter: 'all' })
    expect(routeFromSearch('?tab=families&kind=child&uid=kid1')).toEqual({ tab: 'families', kind: 'child', uid: 'kid1', filter: 'all' })
    expect(routeFromSearch('?tab=nope')).toEqual({ tab: 'today', kind: 'parent', uid: null, filter: 'all' })
    expect(searchFromRoute({ tab: 'today', kind: 'parent', uid: null, filter: 'all' })).toBe('')
    expect(searchFromRoute({ tab: 'flags', kind: 'parent', uid: null, filter: 'all' })).toBe('?tab=flags')
    expect(searchFromRoute({ tab: 'families', kind: 'child', uid: 'kid1', filter: 'all' })).toBe('?tab=families&kind=child&uid=kid1')
  })

  it('lands the old tab names on their new views', () => {
    expect(routeFromSearch('?tab=overview')).toEqual({ tab: 'today', kind: 'parent', uid: null, filter: 'all' })
    expect(routeFromSearch('?tab=parents')).toEqual({ tab: 'families', kind: 'parent', uid: null, filter: 'all' })
    expect(routeFromSearch('?tab=children&uid=kid1')).toEqual({ tab: 'families', kind: 'child', uid: 'kid1', filter: 'all' })
    expect(routeFromSearch('?tab=ai')).toEqual({ tab: 'ai', kind: 'parent', uid: null, filter: 'all' })
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

const INBOX: Inbox = {
  at: '2026-10-24T00:00:00.000Z', hidden: 1,
  items: [
    { id: 'workerDown-1', rule: 'workerDown', when: 'now', category: '시스템', title: '메모 서버(Mac mini)의 신호가 끊겼어요', sub: '마지막 신호 9분 전', why: '사진은 안전하게 쌓여요.', rows: [{ name: '마지막 신호', fact: '', value: '9분 전' }], targets: [] },
    { id: 'noGuardian-2', rule: 'noGuardian', when: 'day', category: '가족', title: '대표 가족이 없는 부모님 1분', sub: '설정을 바꿀 사람이 없어요', why: '대표를 정해 주세요.', rows: [{ name: '아빠', fact: '가족 0명', value: '휴대폰 없음' }], targets: [{ uid: 'dad1', kind: 'parent' }] },
  ],
}

describe('TodayView', () => {
  const worker = { status: 'ok' as const, lastSeenMs: 1_000, modelUp: true, waiting: 3, now: 23_000 }
  const view = (inbox: Inbox | null = INBOX) => renderToString(<TodayView inbox={inbox} inboxError={null} worker={worker} refreshKey={0} onGo={() => {}} />)

  it('opens on the briefing, with a 7일 | 30일 switch and skeletons until the numbers come', () => {
    const html = view()
    expect(html).toMatch(/브리핑/)
    expect(html).toContain('7일')
    expect(html).toContain('30일')
    expect(html).toContain('북극성 지표 · 하루를 나눈 가족 (7일)')
    expect(html).toContain('hq-skel')
    // No number is made up while the worker has not answered.
    expect(html).not.toMatch(/\d+장을 보냈/)
  })

  it('shows 할 일 from the inbox, and the memo server from its heartbeat', () => {
    const html = view()
    expect(html).toContain('지금 처리할 일 1')
    expect(html).toContain('메모 서버(Mac mini)의 신호가 끊겼어요')
    expect(html).toContain('대표 가족이 없는 부모님 1분')
    expect(html).toContain('응답 중')
    expect(html).toContain('3장')
    expect(html).toContain('22초 전')
    expect(html).toContain('입력 전')
    expect(view({ ...INBOX, items: [] })).toContain('지금 처리할 일 없음')
  })
})

describe('InboxView', () => {
  const view = (inbox: Inbox | null, error: string | null = null) => renderToString(
    <ToastProvider><InboxView inbox={inbox} error={error} onDone={() => {}} onOpenPerson={() => {}} onGo={() => {}} /></ToastProvider>,
  )

  it('groups the items and opens the first, with only safe actions', () => {
    const html = view(INBOX)
    expect(html).toContain('처리할 일 2')
    expect(html.indexOf('>지금<')).toBeLessThan(html.indexOf('>오늘<'))
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('사진은 안전하게 쌓여요.')
    for (const a of ['열기', '내일 다시 보기', '해결됨']) expect(html).toContain(`>${a}<`)
    expect(html).not.toMatch(/알림 보내기|보내기</)
    expect(html).toContain('미뤄 두거나 해결한 일 1')
    expect(html).toContain('할 일은 이렇게 골라요')
    expect(html).toContain('스토어 리뷰')
  })

  it('has empty, loading and error states', () => {
    expect(view({ ...INBOX, items: [], hidden: 0 })).toContain('처리할 일이 없어요. 오늘은 여기까지!')
    expect(view(null)).toContain('hq-skel')
    expect(view(null, '서버(Mac mini)가 응답하지 않아요.')).toContain('서버(Mac mini)가 응답하지 않아요.')
  })
})

describe('GrowthView', () => {
  it('waits for the worker without inventing a number, and says what is not recorded', () => {
    const html = renderToString(<GrowthView refreshKey={0} />)
    expect(html).toContain('한 가족이 들어와 매일 쓰기까지')
    expect(html).toContain('hq-skel')
    expect(html).toContain('아직 기록 안 함')
    expect(html).not.toMatch(/\d+곳을 따라가/)
  })
})

describe('FamiliesTable', () => {
  const table = (filter: 'all' | 'unpaired' | 'blocked' = 'all') => renderToString(<FamiliesTable people={people} loading={false} filter={filter} onFilter={() => {}} onOpen={() => {}} />)

  it('one row per parent, named after the 대표, with the chips and their counts', () => {
    const html = table()
    expect(html).toContain('가족 1곳')
    expect(html).toContain('부모님 2분 · 가족 1명')
    expect(html).toContain('지은 가족')
    expect(html).toContain('가족 없음')
    expect(html).toContain('iPhone')
    for (const chip of ['전체 2', '3일 사진 없음 1', '휴대폰 미연결 1', '가족 한도 0', '차단 0']) expect(html).toContain(chip)
    expect(html).toContain('hq-tbl')
  })

  it('shows only the chip\'s rows', () => {
    const html = table('unpaired')
    expect(html).toContain('아빠')
    expect(html).not.toContain('지은 가족')
    expect(table('blocked')).toContain('맞는 가족이 없어요')
  })
})

describe('가족 address', () => {
  it('keeps the chip in the address, on the 가족별 list only', () => {
    expect(routeFromSearch('?tab=families&kind=parent&f=quiet')).toMatchObject({ tab: 'families', kind: 'parent', filter: 'quiet' })
    expect(routeFromSearch('?tab=families&f=nope').filter).toBe('all')
    expect(searchFromRoute({ tab: 'families', kind: 'parent', uid: null, filter: 'unpaired' })).toBe('?tab=families&kind=parent&f=unpaired')
    expect(searchFromRoute({ tab: 'families', kind: 'child', uid: null, filter: 'unpaired' })).toBe('?tab=families&kind=child')
    expect(searchFromRoute({ tab: 'today', kind: 'parent', uid: null, filter: 'quiet' })).toBe('')
  })
})

describe('RevenueView', () => {
  it('says payments are not live yet and waits before showing any number', () => {
    const html = renderToString(<ToastProvider><RevenueView people={people} peopleLoading={false} /></ToastProvider>)
    expect(html).toContain('매출')
    expect(html).toContain('가정으로 계산해 보기')
    expect(html).toContain('hq-skel')
    expect(html).not.toContain('₩')
    expect(html).toContain('아직 기록 안 함')
  })
})

describe('CostsView', () => {
  it('waits for the numbers and names where Firebase costs will come from', () => {
    const html = renderToString(<ToastProvider><CostsView people={people} peopleLoading={false} /></ToastProvider>)
    expect(html).toContain('비용')
    expect(html).toContain('hq-skel')
    expect(html).toContain('BigQuery')
    expect(html).not.toContain('₩')
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
