/**
 * Seed or adjust admin_config/plans.
 *
 *   npm run plans                      create the doc from the private seed file if missing, then print it
 *   npm run plans -- reactions=on      switch a rollout flag (on/off)
 *   npm run plans -- table             rewrite the plans from the private seed file (flags and prices are kept;
 *                                      a plan the file leaves out is no longer offered)
 *   npm run plans -- tier=<uid>:plus   put one patient on a tier (families do this themselves on the plan sheet)
 *   npm run plans -- price=plus:₩0,000/월    the price shown on a plan's card (price=plus: removes it)
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

const seedFile = process.env.PLANS_SEED || join(homedir(), '.trackbyphoto', 'plans.seed.json')
/** The private table. Free must be there (an account without a plan is on it);
 *  any other plan the file leaves out is not offered. */
function readSeed(): PlansDoc {
  const seed = JSON.parse(readFileSync(seedFile, 'utf8')) as PlansDoc
  if (!seed.free) throw new Error(`${seedFile}: missing tier free`)
  const unknown = Object.keys(seed).filter((k) => !['fairUse', 'flags', ...PLAN_TIERS].includes(k))
  if (unknown.length) throw new Error(`${seedFile}: unknown entries ${unknown.join(', ')}`)
  return seed
}

if (!(await ref.get()).exists) {
  const seed = readSeed()
  // Whatever the file says, a new doc starts with every feature switched off.
  seed.flags = Object.fromEntries(PLAN_FLAGS.map((f) => [f, false])) as Record<PlanFlag, boolean>
  await ref.set(seed)
  console.log('created admin_config/plans from', seedFile)
}

for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.split('=')
  if (arg === 'table') {
    const seed = readSeed()
    const current = (await ref.get()).data() as PlansDoc
    const update: Record<string, unknown> = { fairUse: seed.fairUse ?? current.fairUse }
    for (const tier of PLAN_TIERS) {
      const next = seed[tier]
      // A price set with price= stays unless the file names its own.
      const priceLabel = next?.priceLabel ?? current[tier]?.priceLabel
      update[tier] = next ? { ...next, ...(priceLabel ? { priceLabel } : {}) } : FieldValue.delete()
    }
    await ref.update(update)
    console.log('plans rewritten from', seedFile, '→', PLAN_TIERS.filter((t) => seed[t]).join(', '))
  } else if (key === 'tier') {
    const [uid, tier] = (value || '').split(':')
    if (!uid || !PLAN_TIERS.includes(tier as PlanTier)) throw new Error(`tier=<uid>:<${PLAN_TIERS.join('|')}>`)
    if (!((await ref.get()).data() as PlansDoc)[tier as PlanTier]) throw new Error(`${tier} is not in the plans table`)
    await db.doc(`users/${uid}`).update({ plan: { tier, status: 'active', since: FieldValue.serverTimestamp() } })
    console.log(`users/${uid} → ${tier}`)
  } else if (key === 'price') {
    // Prices are not in this repository either; the sheet shows what is set here.
    const [tier, ...label] = (value || '').split(':')
    if (!PLAN_TIERS.includes(tier as PlanTier)) throw new Error(`price=<${PLAN_TIERS.join('|')}>:<label>`)
    const priceLabel = label.join(':').trim()
    await ref.update({ [`${tier}.priceLabel`]: priceLabel || FieldValue.delete() })
    console.log(`price ${tier} → ${priceLabel || '(none)'}`)
  } else if (PLAN_FLAGS.includes(key as PlanFlag) && (value === 'on' || value === 'off')) {
    await ref.update({ [`flags.${key}`]: value === 'on' })
    console.log(`flag ${key} → ${value}`)
  } else {
    throw new Error(`unknown argument: ${arg}`)
  }
}

console.log(JSON.stringify((await ref.get()).data(), null, 2))
process.exit(0)
