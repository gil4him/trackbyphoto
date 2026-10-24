// 운영실 성장: the journey, the biggest drop, weekly cohorts and sources on
// plain rows, and the handler against the emulators.

import { describe, it, expect, beforeEach } from 'vitest'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp } from 'firebase-admin/firestore'
import { arrivalOf, biggestDrop, cohorts, firstWeekDays, funnel, seoulWeekStart, sources, type GrowthFamily, type GrowthParent } from '../src/adminGrowth'
import { seoulDate } from '../src/adminMetrics'
import { adminGrowth, resetGrowthCache } from '../src/handlers/adminGrowth'
import { db, clearFirestore } from './setup'

const H = 3_600_000
const D = 24 * H
const NOW = Date.parse('2026-10-23T03:00:00Z') // Friday 12:00 in Seoul

const fam = (uid: string, parents: string[], arrived: GrowthFamily['arrived'] = 'direct'): GrowthFamily => ({ uid, createdAtMs: NOW - 3 * D, parents, arrived })
const par = (uid: string, over: Partial<GrowthParent> = {}): GrowthParent => ({ uid, phoneActive: true, firstPhotoMs: NOW - 5 * D, firstWeekDays: 5, familyReacted: true, ...over })

describe('funnel', () => {
  it('counts a stage only when every stage before it was reached', () => {
    const parents = new Map([
      ['p1', par('p1')],
      ['p2', par('p2', { phoneActive: false })],
      ['p3', par('p3', { familyReacted: false })],
      ['p4', par('p4', { firstWeekDays: 2 })],
      // A photo with no phone (shouldn't happen) never skips the phone step.
      ['p5', par('p5', { phoneActive: false, firstPhotoMs: NOW })],
    ])
    const f = funnel([fam('a', ['p1']), fam('b', ['p2']), fam('c', ['p3']), fam('d', ['p4']), fam('e', ['p5']), fam('f', [])], parents)
    expect(f.map((s) => [s.label, s.count])).toEqual([['가입', 6], ['부모님 휴대폰 연결', 3], ['첫 사진', 3], ['가족 첫 반응', 2], ['7일 계속 사용', 1]])
    expect(f[0].rate).toBeNull()
    expect(f[1].rate).toBe(0.5)
  })

  it('a family with two parents counts once, by the one who got furthest', () => {
    const parents = new Map([['p1', par('p1', { phoneActive: false })], ['p2', par('p2')]])
    expect(funnel([fam('a', ['p1', 'p2'])], parents).map((s) => s.count)).toEqual([1, 1, 1, 1, 1])
  })

  it('no sign-ups: zeros and no rates, no division by zero', () => {
    const f = funnel([], new Map())
    expect(f.map((s) => s.count)).toEqual([0, 0, 0, 0, 0])
    expect(f.every((s) => s.rate === null)).toBe(true)
    expect(biggestDrop(f)).toBeNull()
  })
})

describe('biggestDrop', () => {
  it('names the step that loses the largest share, in a sentence', () => {
    const stages = funnel(
      [fam('a', ['p1']), fam('b', ['p2']), fam('c', ['p2']), fam('d', ['x']), fam('e', ['x'])],
      new Map([['p1', par('p1')], ['p2', par('p2', { familyReacted: false })], ['x', par('x', { phoneActive: false })]]),
    )
    const d = biggestDrop(stages)!
    expect(d).toMatchObject({ from: '첫 사진', to: '가족 첫 반응', lost: 2, of: 3, dropPct: 67 })
    expect(d.text).toBe('첫 사진 → 가족 첫 반응에서 가장 많이 빠져요. 3곳 중 2곳이 가족 첫 반응까지 가지 못했어요.')
  })
})

describe('cohorts', () => {
  it('starts weeks on Monday in Seoul', () => {
    expect(seoulDate(seoulWeekStart(NOW))).toBe('2026-10-19')
    // Sunday 23:30 in Seoul still belongs to the week before.
    expect(seoulDate(seoulWeekStart(Date.parse('2026-10-25T14:30:00Z')))).toBe('2026-10-19')
  })

  it('shares of each week\'s new parents who sent a photo in their week 0…4, blank before a week began', () => {
    const weekStart = seoulWeekStart(NOW)
    const parents = [
      { uid: 'old1', createdAtMs: weekStart - 28 * D + H },
      { uid: 'old2', createdAtMs: weekStart - 28 * D + 2 * H },
      { uid: 'new1', createdAtMs: weekStart + H },
    ]
    const memos = [
      { patientUid: 'old1', atMs: weekStart - 28 * D + 5 * H }, // week 0
      { patientUid: 'old2', atMs: weekStart - 28 * D + 9 * H }, // week 0
      { patientUid: 'old1', atMs: weekStart - 20 * D }, // week 1
      { patientUid: 'new1', atMs: NOW - H },
    ]
    const rows = cohorts(parents, memos, NOW)
    expect(rows.map((r) => r.week)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'])
    expect(rows[0]).toEqual({ week: '2026-09-21', size: 2, pct: [100, 50, 0, 0, 0] })
    expect(rows[1]).toEqual({ week: '2026-09-28', size: 0, pct: [null, null, null, null, null] })
    expect(rows[4]).toEqual({ week: '2026-10-19', size: 1, pct: [100, null, null, null, null] })
  })
})

describe('sources and the first week', () => {
  it('an invite link when someone else invited the account; direct when it registered a parent', () => {
    expect(arrivalOf([])).toBe('none')
    expect(arrivalOf([{ caregiverUid: 'k', invitedBy: 'k', startMs: 1 }])).toBe('direct')
    expect(arrivalOf([{ caregiverUid: 'k', invitedBy: 'mom', startMs: 1 }, { caregiverUid: 'k', invitedBy: 'k', startMs: 2 }])).toBe('invite')
    expect(sources([fam('a', [], 'invite'), fam('b', [], 'direct'), fam('c', [], 'none'), fam('d', [], 'invite')])).toEqual({ invite: 2, direct: 1, none: 1, total: 4 })
  })
  it('counts distinct Seoul days in the 7 days from the first photo', () => {
    const first = Date.parse('2026-10-01T00:00:00Z')
    expect(firstWeekDays(null, [])).toBe(0)
    expect(firstWeekDays(first, [first, first + H, first + D, first + 3 * D, first + 6 * D, first + 8 * D])).toBe(4)
  })
})

describe('adminGrowth handler', () => {
  const ADMIN = { uid: 'admin1', email: 'zymer4him@gmail.com', name: 'Shawn', emailVerified: true }

  beforeEach(async () => {
    await clearFirestore()
    resetGrowthCache()
    const all = await getAuth().listUsers(1000)
    await Promise.all(all.users.map((u) => getAuth().deleteUser(u.uid).catch(() => {})))
  })

  it('refuses everyone but the admin', async () => {
    await expect(adminGrowth({ uid: 'x', email: 'x@example.com', name: 'x' })).rejects.toThrow(/admin only/)
  })

  it('follows a new family through its parent, and the answer can be stored', async () => {
    await getAuth().createUser({ uid: 'kid', email: 'kid@example.com' })
    await getAuth().createUser({ uid: 'mom' })
    await db.doc('users/mom').set({ accountType: 'managed', patientName: '엄마' })
    await db.doc('memberships/mom_kid').set({ patientUid: 'mom', caregiverUid: 'kid', role: 'guardian', status: 'active', invitedBy: 'kid', createdAt: Timestamp.now() })
    await db.doc('users/mom/devices/d1').set({ status: 'active', platform: 'ios' })
    await db.doc('memos/m1').set({ patientUid: 'mom', takenAt: Timestamp.now(), createdAt: Timestamp.now() })
    await db.doc('reactions/r1').set({ patientUid: 'mom', actorUid: 'kid', kind: 'heart', createdAt: Timestamp.now() })

    const g = await adminGrowth(ADMIN)
    expect(g.funnel.map((s) => s.count)).toEqual([1, 1, 1, 1, 0])
    expect(g.sources).toEqual({ invite: 0, direct: 1, none: 0, total: 1 })
    expect(g.trend.dates).toHaveLength(90)
    expect(g.trend.families.at(-1)).toBe(1)
    expect(g.cohorts.at(-1)!.size).toBe(1)
    await db.doc('requests/store-check').set({ result: JSON.parse(JSON.stringify(g)) })
  })
})
