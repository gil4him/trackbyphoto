// 운영실 할 일 on the page: grouping, the 오늘 card's top items, where 열기 goes,
// and what 내일 다시 보기 / 해결됨 write.
import { describe, it, expect, vi } from 'vitest'

const setDoc = vi.fn(async () => {})
vi.mock('../firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  setDoc: (...a: unknown[]) => (setDoc as (...x: unknown[]) => Promise<void>)(...a),
  serverTimestamp: () => 'SERVER_TIME',
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}))
vi.mock('./worker', () => ({ callWorker: vi.fn() }))

import { RULE_GUIDE, checkInLine, groupByWhen, openTarget, setItemState, topItems, type InboxItem } from './adminInbox'

const item = (id: string, when: InboxItem['when'], over: Partial<InboxItem> = {}): InboxItem => ({
  id, rule: 'noGuardian', when, category: '가족', title: id, sub: '', why: '', rows: [], targets: [], ...over,
})

describe('할 일 on the page', () => {
  it('groups 지금 → 오늘 → 이번 주, leaving out empty groups', () => {
    const g = groupByWhen([item('a', 'wk'), item('b', 'now'), item('c', 'wk')])
    expect(g.map((x) => [x.when, x.items.map((i) => i.id)])).toEqual([['now', ['b']], ['wk', ['a', 'c']]])
  })

  it('the 오늘 card takes the first four, most urgent first', () => {
    const list = [item('w1', 'wk'), item('d1', 'day'), item('n1', 'now'), item('w2', 'wk'), item('d2', 'day')]
    expect(topItems(list, 4).map((i) => i.id)).toEqual(['n1', 'd1', 'd2', 'w1'])
  })

  it('열기 opens one person, the 가족 list for several, or the view a system item is about', () => {
    expect(openTarget(item('a', 'day', { targets: [{ uid: 'mom', kind: 'parent' }] }))).toEqual({ uid: 'mom' })
    expect(openTarget(item('a', 'day', { targets: [{ uid: 'a', kind: 'parent' }, { uid: 'b', kind: 'parent' }] }))).toEqual({ tab: 'families', kind: 'parent', filter: 'all' })
    expect(openTarget(item('a', 'wk', { targets: [{ uid: 'a', kind: 'child' }, { uid: 'b', kind: 'child' }] }))).toEqual({ tab: 'families', kind: 'child', filter: 'all' })
    expect(openTarget(item('a', 'now', { rule: 'workerDown' }))).toEqual({ tab: 'system' })
    expect(openTarget(item('a', 'wk', { rule: 'costOverBudget' }))).toEqual({ tab: 'costs' })
  })

  it('내일 다시 보기 saves 24 hours; 해결됨 saves no end', async () => {
    await setItemState('noGuardian-x', 'snoozed', 1_000)
    expect(setDoc).toHaveBeenLastCalledWith('admin_config/dashboard',
      { inbox: { 'noGuardian-x': { state: 'snoozed', until: { ms: 1_000 + 86_400_000 }, at: 'SERVER_TIME' } } }, { merge: true })
    await setItemState('noGuardian-x', 'resolved')
    expect(setDoc).toHaveBeenLastCalledWith('admin_config/dashboard',
      { inbox: { 'noGuardian-x': { state: 'resolved', until: null, at: 'SERVER_TIME' } } }, { merge: true })
  })

  it('names what is not connected yet as 연결 필요, and never makes items for it', () => {
    const off = RULE_GUIDE.filter((r) => r.when === 'off')
    expect(off.map((r) => r.title)).toEqual(['스토어 리뷰', '이메일 삭제 요청', '앱 심사 상태'])
    expect(off.every((r) => r.text.includes('연결 필요'))).toBe(true)
  })

  it('shows the check-in exactly as the family will read it (owner-approved, kin words without 님)', () => {
    expect(checkInLine('엄마')).toBe('요즘 엄마 사진이 뜸해요. 3일째 소식이 없는데, 전화 한 통 드려 보시는 건 어때요?')
    expect(checkInLine('영희')).toBe('요즘 영희님 사진이 뜸해요. 3일째 소식이 없는데, 전화 한 통 드려 보시는 건 어때요?')
  })
})
