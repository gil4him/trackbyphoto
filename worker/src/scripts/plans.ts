/**
 * Seed or adjust admin_config/plans.
 *
 *   npm run plans                      create the doc from the private seed file if missing, then print it
 *   npm run plans -- reactions=on      switch a rollout flag (on/off)
 *   npm run plans -- tier=<uid>:basic  put one patient on a tier (until changePlan exists, Phase 6)
 *
 * The tier table is kept out of this public repository: the seed is read
 * from ~/.trackbyphoto/plans.seed.json (or PLANS_SEED).
 *
 * Runs against production with ~/.trackbyphoto/sa-key.json, or against the
 * emulator when FIRESTORE_EMULATOR_HOST is set.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { PLAN_FLAGS, PLAN_TIERS, type PlanFlag, type PlansDoc, type PlanTier } from '../plans.js'

const emulator = !!process.env.FIRESTORE_EMULATOR_HOST
initializeApp(emulator
  ? { projectId: process.env.GCLOUD_PROJECT || 'demo-trackbyphoto' }
  : { credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS || join(homedir(), '.trackbyphoto', 'sa-key.json')) })

const db = getFirestore()
const ref = db.doc('admin_config/plans')

if (!(await ref.get()).exists) {
  const seedFile = process.env.PLANS_SEED || join(homedir(), '.trackbyphoto', 'plans.seed.json')
  const seed = JSON.parse(readFileSync(seedFile, 'utf8')) as PlansDoc
  for (const tier of PLAN_TIERS) if (!seed[tier]) throw new Error(`${seedFile}: missing tier ${tier}`)
  // Whatever the file says, a new doc starts with every feature switched off.
  seed.flags = Object.fromEntries(PLAN_FLAGS.map((f) => [f, false])) as Record<PlanFlag, boolean>
  await ref.set(seed)
  console.log('created admin_config/plans from', seedFile)
}

for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.split('=')
  if (key === 'tier') {
    const [uid, tier] = (value || '').split(':')
    if (!uid || !PLAN_TIERS.includes(tier as PlanTier)) throw new Error(`tier=<uid>:<${PLAN_TIERS.join('|')}>`)
    await db.doc(`users/${uid}`).update({ plan: { tier, status: 'active', since: FieldValue.serverTimestamp() } })
    console.log(`users/${uid} → ${tier}`)
  } else if (PLAN_FLAGS.includes(key as PlanFlag) && (value === 'on' || value === 'off')) {
    await ref.update({ [`flags.${key}`]: value === 'on' })
    console.log(`flag ${key} → ${value}`)
  } else {
    throw new Error(`unknown argument: ${arg}`)
  }
}

console.log(JSON.stringify((await ref.get()).data(), null, 2))
process.exit(0)
