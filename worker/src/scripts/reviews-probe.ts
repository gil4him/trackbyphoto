// Can the worker read the stores' reviews (운영실 D13)? Prints what is configured
// (never a key) and asks each store for its newest reviews.
//   npm run reviews-probe -- [--env ~/daylie-secrets/simple/worker.env]
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined }
const envFile = (arg('--env') ?? join(homedir(), 'daylie-secrets', 'simple', 'worker.env')).replace(/^~(?=\/)/, homedir())
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2').replace(/\$HOME|\$\{HOME\}/g, homedir())
  }
}
const { ASC_REVIEWS_ENV, ascReviewsMissing, fetchAscReviews } = await import('../reviews/asc.js')
const { PLAY_REVIEWS_ENV, playReviewsMissing, fetchPlayReviews } = await import('../reviews/play.js')
const { reviewsSummary } = await import('../reviews/index.js')

const show = (k: string) => {
  const v = process.env[k]
  const file = (k.endsWith('PATH') || k === 'GOOGLE_APPLICATION_CREDENTIALS') && v ? ` ${existsSync(v.replace(/^~(?=\/)/, homedir())) ? '(file found)' : '(FILE NOT FOUND)'}` : ''
  console.log(`${k.padEnd(30)} ${v ? (k === 'ASC_ISSUER_ID' ? `${v.slice(0, 8)}…` : v) : '(missing)'}${file}`)
}
console.log(`env file: ${envFile} ${existsSync(envFile) ? '' : '(NOT FOUND)'}`)
for (const k of [...ASC_REVIEWS_ENV, ...PLAY_REVIEWS_ENV]) show(k)

for (const [name, missing, fetchIt] of [
  ['App Store', ascReviewsMissing(), fetchAscReviews],
  ['Google Play', playReviewsMissing(), fetchPlayReviews],
] as const) {
  console.log(`\n${name}`)
  if (missing.length) { console.log(`❌ not configured: ${missing.join(', ')}`); continue }
  const got = await fetchIt()
  if (!got.ok) { console.log(`❌ ${got.error}`); continue }
  const s = reviewsSummary(got.reviews, Date.now())
  console.log(`✅ ${got.reviews.length} reviews · 30d ${s.count30d} · avg ${s.avg30d ?? '-'} · unanswered ${s.unanswered}`)
  for (const r of got.reviews.slice(0, 3)) console.log(`   ${'★'.repeat(r.rating)} ${r.title || r.body.slice(0, 40)} — ${r.author} · ${new Date(r.atMs).toISOString().slice(0, 10)}${r.replied ? ' · replied' : ''}`)
}
