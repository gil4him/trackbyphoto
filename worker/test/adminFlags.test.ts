// 운영실 기능 스위치: one flag on or off, with an admin_log row — and nothing
// for anyone but the admin, an unknown flag, or no change.

import { describe, it, expect, beforeEach } from 'vitest'
import { adminSetFlag } from '../src/handlers/adminFlags'
import { getPlans, resetPlansCache } from '../src/plans'
import { db, clearFirestore } from './setup'

const ADMIN = { uid: 'admin1', email: 'zymer4him@gmail.com', name: 'Shawn', emailVerified: true }

beforeEach(async () => {
  await clearFirestore()
  resetPlansCache()
})

describe('adminSetFlag', () => {
  it('refuses everyone but the admin, and unknown flags or values', async () => {
    await expect(adminSetFlag({ uid: 'x', email: 'x@example.com', name: 'x' }, { flag: 'digest', on: true })).rejects.toThrow(/admin only/)
    await expect(adminSetFlag(ADMIN, { flag: 'nope', on: true })).rejects.toThrow(/unknown flag/)
    await expect(adminSetFlag(ADMIN, { flag: 'digest', on: 'yes' })).rejects.toThrow(/true or false/)
  })

  it('switches the flag, keeps the others, logs it, and the worker sees it at once', async () => {
    await db.doc('admin_config/plans').set({ flags: { digest: false, reactions: true }, free: { familyMembers: 3 } })
    await getPlans() // cached as off
    expect(await adminSetFlag(ADMIN, { flag: 'digest', on: true })).toEqual({ ok: true, flag: 'digest', on: true, changed: true })
    const plans = (await db.doc('admin_config/plans').get()).data()!
    expect(plans.flags).toEqual({ digest: true, reactions: true })
    expect(plans.free).toEqual({ familyMembers: 3 })
    expect((await getPlans())?.flags.digest).toBe(true)
    const log = await db.collection('admin_log').get()
    expect(log.docs.map((d) => d.data())).toEqual([expect.objectContaining({ action: 'flag.set', actorUid: 'admin1', targetName: 'digest', details: { flag: 'digest', from: false, to: true } })])
  })

  it('does nothing, and logs nothing, when the flag already has that value', async () => {
    await db.doc('admin_config/plans').set({ flags: { reactions: true } })
    expect((await adminSetFlag(ADMIN, { flag: 'reactions', on: true })).changed).toBe(false)
    expect((await db.collection('admin_log').get()).size).toBe(0)
  })

  it('works before the plans doc exists', async () => {
    await adminSetFlag(ADMIN, { flag: 'trailMap', on: true })
    expect((await db.doc('admin_config/plans').get()).get('flags.trailMap')).toBe(true)
  })
})
