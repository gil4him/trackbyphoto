// 운영실 할 일: each rule on plain rows, the admin's 내일 다시 보기 / 해결됨,
// and the handler against the emulators.

import { describe, it, expect, beforeEach } from 'vitest'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp } from 'firebase-admin/firestore'
import {
  applyStates, costOf, costOverBudget, disabledAccount, familyLimit, inboxItems, memoSlow, monthKey, noGuardian,
  quietParent, shortHash, statesOf, unpaired, workerDown, type InboxInput, type InboxParent,
} from '../src/adminInbox'
import { adminInbox, resetInboxCache } from '../src/handlers/adminInbox'
import { db, clearFirestore } from './setup'

const H = 3_600_000
const D = 24 * H
const NOW = Date.parse('2026-10-23T03:00:00Z') // 12:00 in Seoul

const parent = (over: Partial<InboxParent> = {}): InboxParent => ({
  uid: 'mom', name: '엄마', createdAtMs: NOW - 30 * D, tier: 'free', family: 1, guardians: 1, devicesActive: 1, ...over,
})
const input = (over: Partial<InboxInput> = {}): InboxInput => ({
  now: NOW, parents: [parent()], accounts: [], memos: [],
  worker: { lastSeenMs: NOW - 30_000, modelUp: true }, memoP50Ms: null,
  familyLimits: { free: 3, plus: 6 }, cost: { month: '2026-10', firebaseUSD: null, budgetUSD: 5 }, ...over,
})
/** One photo a day at noon Seoul time, `days` days back from `from` days ago. */
const daily = (uid: string, from: number, days: number) =>
  Array.from({ length: days }, (_, i) => ({ patientUid: uid, atMs: NOW - (from + i) * D }))

describe('quietParent (지금)', () => {
  it('finds a parent who sent on ≥5 of the 7 days before, and nothing in the last 72 hours', () => {
    const it1 = quietParent(input({ memos: daily('mom', 4, 6) }))!
    expect(it1).toMatchObject({ rule: 'quietParent', when: 'now', title: '부모님 1분이 3일째 사진이 없어요' })
    expect(it1.rows[0]).toEqual({ name: '엄마', fact: '평소 7일 중 6일', value: '4일' })
    expect(it1.targets).toEqual([{ uid: 'mom', kind: 'parent' }])
  })
  it('stays quiet for a parent who sent recently, or only now and then', () => {
    expect(quietParent(input({ memos: [...daily('mom', 4, 6), { patientUid: 'mom', atMs: NOW - 2 * H }] }))).toBeNull()
    expect(quietParent(input({ memos: daily('mom', 4, 4) }))).toBeNull()
    expect(quietParent(input())).toBeNull()
  })
})

describe('workerDown (지금)', () => {
  it('speaks when the beat is older than 4 minutes, missing, or the model is down', () => {
    expect(workerDown(input())).toBeNull()
    expect(workerDown(input({ worker: { lastSeenMs: NOW - 5 * 60_000, modelUp: true } }))!.title).toBe('메모 서버(Mac mini)의 신호가 끊겼어요')
    expect(workerDown(input({ worker: { lastSeenMs: null, modelUp: null } }))!.rows[0]).toEqual({ name: '마지막 신호', fact: '', value: '신호 없음' })
    expect(workerDown(input({ worker: { lastSeenMs: NOW - 10_000, modelUp: false } }))!.title).toBe('AI 모델이 응답하지 않아요')
  })
})

describe('memoSlow (지금)', () => {
  it('waits for a measurement, then speaks above 30 seconds', () => {
    expect(memoSlow(input())).toBeNull()
    expect(memoSlow(input({ memoP50Ms: 30_000 }))).toBeNull()
    expect(memoSlow(input({ memoP50Ms: 41_200 }))!.title).toBe('메모 쓰는 시간이 느려졌어요 (중간값 41초)')
  })
})

describe('unpaired (오늘)', () => {
  it('a family registered over 24 hours ago whose parent has no phone yet', () => {
    expect(unpaired(input({ parents: [parent({ devicesActive: 0, createdAtMs: NOW - 2 * D })] }))!.title).toBe('휴대폰 연결을 안 한 가족 1곳')
    expect(unpaired(input({ parents: [parent({ devicesActive: 0, createdAtMs: NOW - 5 * H })] }))).toBeNull()
    expect(unpaired(input({ parents: [parent({ devicesActive: 0, family: 0 })] }))).toBeNull()
  })
})

describe('noGuardian (오늘), familyLimit, costOverBudget, disabledAccount (이번 주)', () => {
  it('a parent with no 대표 가족', () => {
    expect(noGuardian(input({ parents: [parent({ guardians: 0 })] }))!.when).toBe('day')
    expect(noGuardian(input())).toBeNull()
  })
  it('a family at its plan\'s limit, by the plans table', () => {
    const it1 = familyLimit(input({ parents: [parent({ family: 3 })] }))!
    expect(it1).toMatchObject({ when: 'wk', title: '가족 수 한도에 걸린 가족 1곳' })
    expect(it1.rows[0].value).toBe('가족 3/3명')
    expect(familyLimit(input({ parents: [parent({ family: 2 })] }))).toBeNull()
    expect(familyLimit(input({ parents: [parent({ family: 9, tier: 'family' })] }))).toBeNull() // no number for that plan
  })
  it('a month over the budget, only once a cost was entered', () => {
    expect(costOverBudget(input())).toBeNull()
    expect(costOverBudget(input({ cost: { month: '2026-10', firebaseUSD: 4.9, budgetUSD: 5 } }))).toBeNull()
    expect(costOverBudget(input({ cost: { month: '2026-10', firebaseUSD: 11.4, budgetUSD: 5 } }))!.sub).toBe('이번 달 $11.40')
  })
  it('blocked accounts', () => {
    expect(disabledAccount(input({ accounts: [{ uid: 'k', kind: 'child', name: '지은', email: 'j@example.com', disabled: true }] }))!.rows[0]).toEqual({ name: '지은', fact: '가족', value: 'j@example.com' })
  })
})

describe('the inbox as a whole', () => {
  it('orders 지금 → 오늘 → 이번 주, sums up long lists, and keeps ids stable per set of people', () => {
    const many = Array.from({ length: 12 }, (_, k) => parent({ uid: `p${k}`, name: `부모${k}`, guardians: 0, family: 3 }))
    const items = inboxItems(input({ parents: many, worker: { lastSeenMs: null, modelUp: null } }))
    expect(items.map((x) => x.when)).toEqual(['now', 'day', 'wk'])
    const ng = items.find((x) => x.rule === 'noGuardian')!
    expect(ng.rows).toHaveLength(8)
    expect(ng.rows.at(-1)!.name).toBe('외 5분')
    expect(ng.targets).toHaveLength(12)
    const again = inboxItems(input({ parents: [...many].reverse(), worker: { lastSeenMs: null, modelUp: null } }))
    expect(again.find((x) => x.rule === 'noGuardian')!.id).toBe(ng.id)
    const fewer = inboxItems(input({ parents: many.slice(1) }))
    expect(fewer.find((x) => x.rule === 'noGuardian')!.id).not.toBe(ng.id)
    expect(shortHash('a')).not.toBe(shortHash('b'))
  })

  it('해결됨 hides an item while it lasts; 내일 다시 보기 until tomorrow; spent states are cleared', () => {
    const items = inboxItems(input({ parents: [parent({ guardians: 0 })] }))
    const id = items[0].id
    expect(applyStates(items, { [id]: { state: 'resolved', until: null } }, NOW)).toEqual({ open: [], hidden: 1, spent: [] })
    expect(applyStates(items, { [id]: { state: 'snoozed', until: NOW + D } }, NOW).open).toHaveLength(0)
    // The snooze ran out: back, and its entry is spent.
    expect(applyStates(items, { [id]: { state: 'snoozed', until: NOW - 1 } }, NOW)).toMatchObject({ hidden: 0, spent: [id] })
    // The condition cleared: the resolved entry is spent, so it shows again if it comes back.
    expect(applyStates([], { [id]: { state: 'resolved', until: null } }, NOW).spent).toEqual([id])
  })

  it('reads the dashboard doc defensively', () => {
    expect(monthKey(NOW)).toBe('2026-10')
    expect(costOf(undefined, NOW)).toEqual({ month: '2026-10', firebaseUSD: null, budgetUSD: 5 })
    expect(costOf({ costs: { '2026-10': { firebaseUSD: 7, budgetUSD: 10 } } }, NOW)).toEqual({ month: '2026-10', firebaseUSD: 7, budgetUSD: 10 })
    expect(costOf({ budgetUSD: 8, costs: { '2026-10': { firebaseUSD: 'x' } } }, NOW)).toEqual({ month: '2026-10', firebaseUSD: null, budgetUSD: 8 })
    expect(statesOf({ inbox: { a: { state: 'resolved' }, b: { state: 'weird' }, c: { state: 'snoozed', until: Timestamp.fromMillis(5) } } }))
      .toEqual({ a: { state: 'resolved', until: null }, c: { state: 'snoozed', until: 5 } })
  })
})

describe('adminInbox handler', () => {
  const ADMIN = { uid: 'admin1', email: 'zymer4him@gmail.com', name: 'Shawn', emailVerified: true }

  beforeEach(async () => {
    await clearFirestore()
    resetInboxCache()
    const all = await getAuth().listUsers(1000)
    await Promise.all(all.users.map((u) => getAuth().deleteUser(u.uid).catch(() => {})))
  })

  it('refuses everyone but the admin', async () => {
    await expect(adminInbox({ uid: 'x', email: 'x@example.com', name: 'x' })).rejects.toThrow(/admin only/)
  })

  it('finds items from the service, hides what the admin resolved, and clears it once it is gone', async () => {
    await getAuth().createUser({ uid: 'kid', email: 'kid@example.com' })
    await getAuth().createUser({ uid: 'mom' })
    await db.doc('users/mom').set({ accountType: 'managed', patientName: '엄마' })
    // A viewer only: no 대표 가족, and no phone.
    await db.doc('memberships/mom_kid').set({ patientUid: 'mom', caregiverUid: 'kid', role: 'viewer', status: 'active', createdAt: Timestamp.now() })
    await db.doc('system/worker').set({ lastSeen: Timestamp.now(), modelUp: true, waiting: 0 })

    const first = await adminInbox(ADMIN)
    // The worker stores the answer in the request doc: it must be storable.
    await db.doc('requests/store-check').set({ result: JSON.parse(JSON.stringify(first)) })
    const ng = first.items.find((x) => x.rule === 'noGuardian')!
    expect(ng.targets).toEqual([{ uid: 'mom', kind: 'parent' }])
    expect(first.items.some((x) => x.rule === 'workerDown')).toBe(false)

    await db.doc('admin_config/dashboard').set({ inbox: { [ng.id]: { state: 'resolved', until: null } } })
    const second = await adminInbox(ADMIN)
    expect(second.items.some((x) => x.id === ng.id)).toBe(false)
    expect(second.hidden).toBe(1)

    // A 대표 가족 is set: the condition clears, and the resolved entry with it.
    await db.doc('memberships/mom_kid').update({ role: 'guardian' })
    await adminInbox(ADMIN, { refresh: true })
    expect((await db.doc('admin_config/dashboard').get()).get(`inbox.${ng.id}`)).toBeUndefined()
  })
})
