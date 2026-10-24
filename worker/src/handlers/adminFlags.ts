/**
 * adminSetFlag — 운영실 기능 스위치 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D8).
 * Turns one rollout flag in admin_config/plans on or off and writes an
 * admin_log row (flag.set) with what it was and what it became. Clients may
 * not write admin_log, so the switch goes through here. Nothing is written
 * when the flag already has that value.
 */

import { getFirestore } from 'firebase-admin/firestore'
import { WorkerError, type Caller } from '../context.js'
import { PLAN_FLAGS, resetPlansCache, type PlanFlag } from '../plans.js'
import { requireAdmin } from './admin.js'
import { adminLog } from './adminPeople.js'

export async function adminSetFlag(caller: Caller, data: { flag?: unknown; on?: unknown }): Promise<{ ok: true; flag: PlanFlag; on: boolean; changed: boolean }> {
  requireAdmin(caller)
  const flag = data?.flag
  if (typeof flag !== 'string' || !(PLAN_FLAGS as readonly string[]).includes(flag)) throw new WorkerError('invalid-argument', 'unknown flag')
  if (typeof data.on !== 'boolean') throw new WorkerError('invalid-argument', 'on must be true or false')
  const on = data.on
  const ref = getFirestore().doc('admin_config/plans')
  const from = await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const was = snap.get(`flags.${flag}`) === true
    if (was === on) return null
    if (snap.exists) tx.update(ref, { [`flags.${flag}`]: on })
    else tx.set(ref, { flags: { [flag]: on } }, { merge: true })
    return was
  })
  if (from === null) return { ok: true, flag: flag as PlanFlag, on, changed: false }
  // The worker itself reads the new value at once; the apps on their next start.
  resetPlansCache()
  await adminLog(caller.uid, 'flag.set', '', flag, { flag, from, to: on })
  return { ok: true, flag: flag as PlanFlag, on, changed: true }
}
