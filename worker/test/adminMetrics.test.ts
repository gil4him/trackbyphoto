// 운영실 오늘 numbers (worker/src/adminMetrics.ts and handlers/adminMetrics.ts).
// The arithmetic runs on plain rows; the handler against the emulators.

import { describe, it, expect, beforeEach } from 'vitest'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp } from 'firebase-admin/firestore'
import { computeMetrics, familiesAt, goalOf, seoulDate, seoulDayStart, seoulHour, type MetricsInput } from '../src/adminMetrics'
import { adminMetrics, resetMetricsCache } from '../src/handlers/adminMetrics'
import { db, clearFirestore } from './setup'

const H = 3_600_000
const D = 24 * H
// Friday 23 Oct 2026, 10:30 in Seoul (01:30 UTC).
const NOW = Date.parse('2026-10-23T01:30:00Z')
const TODAY = Date.parse('2026-10-22T15:00:00Z') // 00:00 Seoul

const base = (over: Partial<MetricsInput> = {}): MetricsInput => ({
  now: NOW,
  parents: [{ uid: 'mom' }, { uid: 'dad' }, { uid: 'gran' }],
  children: [],
  memberships: [
    { patientUid: 'mom', startMs: NOW - 20 * D, endMs: null },
    { patientUid: 'dad', startMs: NOW - 3 * D, endMs: null },
    // gran's family left two days ago
    { patientUid: 'gran', startMs: NOW - 25 * D, endMs: NOW - 2 * D },
  ],
  memos: [],
  reactions: [],
  northStarGoal: 0.8,
  ...over,
})

describe('Seoul days and hours', () => {
  it('cuts days at midnight in Seoul, not on the Mac mini clock', () => {
    expect(seoulDayStart(NOW)).toBe(TODAY)
    expect(seoulDate(NOW)).toBe('2026-10-23')
    expect(seoulDate(TODAY - 1)).toBe('2026-10-22')
    expect(seoulHour(NOW)).toBe(10)
    expect(seoulHour(TODAY)).toBe(0)
  })
})

describe('families', () => {
  it('counts a parent while a membership is active, and only real parents', () => {
    const parents = new Set(['mom', 'dad', 'gran'])
    const spans = [...base().memberships, { patientUid: 'ghost', startMs: 0, endMs: null }]
    expect([...familiesAt(spans, parents, NOW)].sort()).toEqual(['dad', 'mom'])
    expect([...familiesAt(spans, parents, NOW - 10 * D)].sort()).toEqual(['gran', 'mom'])
    // Two family members on one parent are one family.
    expect(familiesAt([...spans, { patientUid: 'mom', startMs: 0, endMs: null }], parents, NOW).size).toBe(2)
  })
})

describe('computeMetrics', () => {
  it('has nothing to say about an empty service, without dividing by zero', () => {
    const m = computeMetrics(base({ parents: [], memberships: [] }))
    expect(m.families).toBe(0)
    expect(m.northStar).toEqual({ families: 0, total: 0, series7d: [null, null, null, null, null, null, null], goal: 0.8 })
    expect(m.days).toHaveLength(30)
    expect(m.days.at(-1)!.date).toBe('2026-10-23')
    expect(m.days[0].date).toBe('2026-09-24')
    expect(m.photosByHourToday).toEqual(Array(24).fill(0))
  })

  it('counts photos, active parents and hours in Seoul time', () => {
    const m = computeMetrics(base({
      memos: [
        { patientUid: 'mom', atMs: TODAY + 9 * H },
        { patientUid: 'mom', atMs: TODAY + 9 * H + 60_000 },
        { patientUid: 'dad', atMs: TODAY + 7 * H },
        { patientUid: 'dad', atMs: TODAY - 2 * H }, // yesterday 22:00
        { patientUid: 'gran', atMs: TODAY - 8 * D }, // outside the 7 days
      ],
    }))
    expect(m.photosToday).toBe(3)
    expect(m.photosByHourToday[9]).toBe(2)
    expect(m.photosByHourToday[7]).toBe(1)
    expect(m.activeParents7d).toBe(2)
    expect(m.days.at(-2)!.photos).toBe(1)
    expect(m.yesterday).toEqual({ parents: 1, photos: 1, familyReactions: 0 })
  })

  it('north star: a family with a photo and a reaction in the 7 days, over all families', () => {
    const m = computeMetrics(base({
      memos: [{ patientUid: 'mom', atMs: TODAY - 3 * D }, { patientUid: 'dad', atMs: TODAY + H }],
      reactions: [
        { patientUid: 'mom', actorUid: 'kid', atMs: TODAY - 2 * D },
        // dad's only reaction is older than the 7 days
        { patientUid: 'dad', actorUid: 'kid', atMs: TODAY - 9 * D },
      ],
    }))
    expect(m.northStar.families).toBe(1)
    expect(m.northStar.total).toBe(2)
    expect(m.northStar.series7d.at(-1)).toBe(0.5)
    // A week ago dad had no family yet and gran did: mom has no photo then either.
    expect(m.days.at(-8)!.families).toBe(2)
  })

  it('tells family reactions from the parent\'s own, and counts every kind for the day', () => {
    const m = computeMetrics(base({
      reactions: [
        { patientUid: 'mom', actorUid: 'kid', atMs: TODAY - 5 * H },
        { patientUid: 'mom', actorUid: 'mom', atMs: TODAY - 4 * H },
        { patientUid: 'mom', actorUid: 'kid', atMs: TODAY + H },
      ],
    }))
    expect(m.yesterday.familyReactions).toBe(1)
    expect(m.days.at(-2)!.reactions).toBe(2)
    expect(m.reactionsToday).toBe(1)
  })

  it('counts sign-ups per day for the last 7', () => {
    const m = computeMetrics(base({
      children: [
        { uid: 'a', createdAtMs: TODAY + H },
        { uid: 'b', createdAtMs: TODAY - 3 * D + H },
        { uid: 'c', createdAtMs: TODAY - 40 * D },
        { uid: 'd', createdAtMs: null },
      ],
    }))
    expect(m.signups7d).toEqual([0, 0, 0, 1, 0, 0, 1])
    expect(m.children).toBe(4)
  })

  it('takes the goal from admin_config/dashboard only when it is a share', () => {
    expect(goalOf(0.7)).toBe(0.7)
    expect(goalOf(80)).toBe(0.8)
    expect(goalOf(undefined)).toBe(0.8)
    expect(goalOf(0)).toBe(0.8)
  })
})

describe('adminMetrics handler', () => {
  const ADMIN = { uid: 'admin1', email: 'zymer4him@gmail.com', name: 'Shawn', emailVerified: true }

  beforeEach(async () => {
    await clearFirestore()
    resetMetricsCache()
    const all = await getAuth().listUsers(1000)
    await Promise.all(all.users.map((u) => getAuth().deleteUser(u.uid).catch(() => {})))
  })

  it('refuses everyone but the admin', async () => {
    await expect(adminMetrics({ uid: 'x', email: 'x@example.com', name: 'x' })).rejects.toThrow(/admin only/)
    await expect(adminMetrics({ ...ADMIN, emailVerified: false })).rejects.toThrow(/admin only/)
  })

  it('reads the service: parents, families, photos and reactions, and keeps the answer 5 minutes', async () => {
    await getAuth().createUser({ uid: 'kid', email: 'kid@example.com' })
    await getAuth().createUser({ uid: 'admin1', email: ADMIN.email })
    await getAuth().createUser({ uid: 'mom' })
    await db.doc('users/mom').set({ accountType: 'managed', patientName: '엄마' })
    await db.doc('memberships/mom_kid').set({ patientUid: 'mom', caregiverUid: 'kid', role: 'guardian', status: 'active', createdAt: Timestamp.fromMillis(Date.now() - 2 * D) })
    await db.doc('memos/m1').set({ patientUid: 'mom', takenAt: Timestamp.now(), createdAt: Timestamp.now() })
    await db.doc('reactions/r1').set({ patientUid: 'mom', actorUid: 'kid', kind: 'heart', createdAt: Timestamp.now() })
    await db.doc('admin_config/dashboard').set({ northStarGoal: 0.6 })

    const m = await adminMetrics(ADMIN)
    expect(m.parents).toBe(1)
    expect(m.children).toBe(1) // the admin is not a sign-up
    expect(m.families).toBe(1)
    expect(m.photosToday).toBe(1)
    expect(m.reactionsToday).toBe(1)
    expect(m.northStar).toMatchObject({ families: 1, total: 1, goal: 0.6 })

    await db.doc('memos/m2').set({ patientUid: 'mom', takenAt: Timestamp.now(), createdAt: Timestamp.now() })
    expect((await adminMetrics(ADMIN)).photosToday).toBe(1)
    expect((await adminMetrics(ADMIN, { refresh: true })).photosToday).toBe(2)
  })
})
