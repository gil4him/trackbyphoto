// 운영실 가족: rows, status pills, chips, search and sort.
import { describe, it, expect, vi } from 'vitest'

vi.mock('./worker', () => ({ callWorker: vi.fn() }))

import { familyRows, filterForRule, filterRows, sortRows } from './adminFamilies'
import type { AdminPerson } from './admin'
import type { Plans } from '../types'

const NOW = Date.parse('2026-10-24T00:00:00Z')
const person = (over: Partial<AdminPerson>): AdminPerson => ({
  uid: 'u', kind: 'parent', name: '엄마', email: null, providers: [], disabled: false, isAdmin: false,
  createdAt: '2026-10-01T00:00:00Z', lastSignInAt: null, lastRefreshAt: null, hasSettings: true,
  plan: { tier: 'free', status: null, since: null, explicit: false },
  memos: { count: 3, lastAt: '2026-10-23T20:00:00Z' }, links: { active: 1, guardians: 1 }, linkUids: ['kid'],
  devices: { active: 1, total: 1, platforms: ['android'] }, ...over,
})
const kid = person({ uid: 'kid', kind: 'child', name: '지은', email: 'jieun@example.com', linkUids: [] })
const plans = { free: { familyMembers: 2 } } as unknown as Plans

describe('familyRows', () => {
  it('names the family after the 대표 and reads the phone, plan limit and photos', () => {
    const [r] = familyRows([person({ uid: 'mom' }), kid], plans, NOW)
    expect(r).toMatchObject({ family: '지은 가족', parent: '엄마', familyCount: 1, limit: 2, phone: 'Android', photos: 3, status: { label: '정상', tone: 'good' } })
    expect([...r.flags]).toEqual(['all'])
  })

  it('one pill per row, the most serious first', () => {
    const rows = familyRows([
      person({ uid: 'a', disabled: true, devices: { active: 0, total: 0, platforms: [] } }),
      person({ uid: 'b', memos: { count: 9, lastAt: '2026-10-20T00:00:00Z' } }),
      person({ uid: 'c', devices: { active: 0, total: 0, platforms: [] } }),
      person({ uid: 'd', links: { active: 2, guardians: 1 } }),
      person({ uid: 'e', links: { active: 1, guardians: 0 } }),
      person({ uid: 'f', memos: { count: 0, lastAt: null } }),
      kid,
    ], plans, NOW)
    expect(rows.map((r) => r.status.label)).toEqual(['차단', '3일 사진 없음', '휴대폰 미연결', '가족 한도', '대표 가족 없음', '정상'])
    expect([...rows[0].flags].sort()).toEqual(['all', 'blocked', 'unpaired'])
  })

  it('without a plans table there is no limit; without family, no family name', () => {
    const [r] = familyRows([person({ uid: 'm', linkUids: [], links: { active: 0, guardians: 0 } })], null, NOW)
    expect(r).toMatchObject({ family: '가족 없음', limit: null })
  })
})

describe('filterRows and sortRows', () => {
  const people = [person({ uid: 'mom' }), person({ uid: 'dad', name: '아빠', linkUids: [], devices: { active: 0, total: 0, platforms: [] }, memos: { count: 0, lastAt: null } }), kid]
  const rows = familyRows(people, plans, NOW)

  it('searches the parent and the family member\'s name or email', () => {
    expect(filterRows(rows, people, 'all', 'jieun').map((r) => r.uid)).toEqual(['mom'])
    expect(filterRows(rows, people, 'all', '아빠').map((r) => r.uid)).toEqual(['dad'])
    expect(filterRows(rows, people, 'unpaired', '').map((r) => r.uid)).toEqual(['dad'])
    expect(filterRows(rows, people, 'all', '  ')).toHaveLength(2)
  })

  it('sorts by status (worst first), name, newest photo or registration', () => {
    expect(sortRows(rows, 'status').map((r) => r.uid)).toEqual(['dad', 'mom'])
    expect(sortRows(rows, 'name').map((r) => r.parent)).toEqual(['아빠', '엄마'])
    expect(sortRows(rows, 'recent')[0].uid).toBe('mom')
  })

  it('an inbox item opens the list on its chip', () => {
    expect(filterForRule('quietParent')).toBe('quiet')
    expect(filterForRule('unpaired')).toBe('unpaired')
    expect(filterForRule('familyLimit')).toBe('limit')
    expect(filterForRule('disabledAccount')).toBe('blocked')
    expect(filterForRule('noGuardian')).toBe('all')
  })
})
