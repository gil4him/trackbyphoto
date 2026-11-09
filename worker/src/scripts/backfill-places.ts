// One-off: give existing photos without a location the place of a nearby
// photo (handlers/borrowPlace.ts), the way new photos get it:
//
//   npm run backfill-places -- --env ~/daylie-secrets/simple/worker.env            dry run, last 30 days
//   npm run backfill-places -- --env … --days 60 --patient <uid>                   one parent, 60 days
//   npm run backfill-places -- --env … --apply                                     write
//
// Writes only memos.place and memos.placeFrom. Prints one line per photo.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const expand = (p: string) => p.replace(/^~(?=\/|$)/, homedir())

const envFile = expand(arg('env', join(homedir(), '.trackbyphoto', 'worker.env'))!)
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!m || process.env[m[1]] !== undefined) continue
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2').replace(/\$HOME|\$\{HOME\}/g, homedir())
  }
}

const { cert, initializeApp } = await import('firebase-admin/app')
const { backfillBorrowedPlaces } = await import('../handlers/borrowPlace.js')

const keyFile = expand(process.env.GOOGLE_APPLICATION_CREDENTIALS || join(homedir(), '.trackbyphoto', 'sa-key.json'))
initializeApp({ credential: cert(keyFile) })
const apply = process.argv.includes('--apply')
const rows = await backfillBorrowedPlaces({ sinceDays: Number(arg('days', '30')), patientUid: arg('patient'), apply })
for (const r of rows) console.log(`${r.id}  ${new Date(r.at).toISOString().slice(0, 16)}  ← ${r.from} (${r.gapMin} min)  ${r.place}`)
console.log(`${rows.length} photo(s) ${apply ? 'filled' : 'would be filled (dry run; add --apply to write)'}`)
process.exit(0)
