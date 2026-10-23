// One-time catch-up for photos from before thumbnails (thumbs.ts): every
// ready memo and family photo without a `thumbUrl` gets its list-sized copy,
// and the original is marked to be kept on the phone. New photos get both
// from the worker as they arrive. Safe to run again: done ones are skipped.
//
//   npm run photo-thumbs -- --env ~/daylie-secrets/simple/worker.env --dry-run   count only
//   npm run photo-thumbs -- --env ~/daylie-secrets/simple/worker.env             do it
//   options: --limit 50 (stop after that many)

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const expand = (p: string) => p.replace(/^~(?=\/|$)/, homedir())
const dryRun = process.argv.includes('--dry-run')
const limit = Number(arg('limit', 'Infinity'))

// The worker's env file, as run.sh loads it (credentials and bucket).
const envFile = expand(arg('env', join(homedir(), '.trackbyphoto', 'worker.env'))!)
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!m || process.env[m[1]] !== undefined) continue
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2').replace(/\$HOME|\$\{HOME\}/g, homedir())
  }
}

const { cert, initializeApp } = await import('firebase-admin/app')
const { getFirestore } = await import('firebase-admin/firestore')
const { ensureThumb } = await import('../thumbs.js')

const keyFile = expand(process.env.GOOGLE_APPLICATION_CREDENTIALS || join(homedir(), '.trackbyphoto', 'sa-key.json'))
const projectId = (JSON.parse(readFileSync(keyFile, 'utf8')) as { project_id: string }).project_id
initializeApp({ credential: cert(keyFile), storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app` })
const db = getFirestore()
console.log(`project ${projectId}${dryRun ? ' (dry run: nothing is written)' : ''}`)

let done = 0
const tally = { made: 0, missing: 0, failed: 0 }
for (const name of ['memos', 'familyPhotos'] as const) {
  const snap = await db.collection(name).where('status', '==', 'ready').get()
  const todo = snap.docs.filter((d) => !d.get('thumbUrl') && typeof d.get('photoPath') === 'string' && d.get('photoPath'))
  console.log(`${name}: ${snap.size} ready, ${todo.length} without a thumbnail`)
  if (dryRun) continue
  for (const d of todo) {
    if (done >= limit) break
    done++
    try {
      const thumbUrl = await ensureThumb(d.get('photoPath') as string)
      if (!thumbUrl) { tally.missing++; continue }
      // Only the new field: nothing the family or the model wrote is touched.
      await d.ref.update({ thumbUrl })
      tally.made++
    } catch (err) {
      tally.failed++
      console.warn(`  ${name}/${d.id}: ${String(err)}`)
    }
    if (done % 25 === 0) console.log(`  … ${done}`)
  }
}
if (!dryRun) console.log(`made ${tally.made}, photo file missing ${tally.missing}, failed ${tally.failed}`)
process.exit(tally.failed ? 1 : 0)
