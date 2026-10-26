// Can the worker read the stores' install reports (운영실 D11)? Prints what is
// configured (never a key) and asks each store for one day / one month.
//   npm run traffic-probe -- [--env ~/daylie-secrets/simple/worker.env] [--date 2026-10-20]
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
const { cert, initializeApp } = await import('firebase-admin/app')
const { ASC_ENV, ascMissing, fetchAscDay } = await import('../traffic/asc.js')
const { PLAY_ENV, playMissing, fetchPlayMonth } = await import('../traffic/play.js')

const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS
initializeApp(keyFile ? { credential: cert(keyFile) } : {})

const show = (k: string) => {
  const v = process.env[k]
  const file = k.endsWith('PATH') && v ? ` ${existsSync(v.replace(/^~(?=\/)/, homedir())) ? '(file found)' : '(FILE NOT FOUND)'}` : ''
  console.log(`${k.padEnd(22)} ${v ? (k === 'ASC_ISSUER_ID' ? `${v.slice(0, 8)}…` : v) : '(missing)'}${file}`)
}
console.log(`env file: ${envFile} ${existsSync(envFile) ? '' : '(NOT FOUND)'}`)
for (const k of [...ASC_ENV, 'ASC_APP_ID', ...PLAY_ENV, 'GOOGLE_APPLICATION_CREDENTIALS']) show(k)

const date = arg('--date') ?? new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10)
let bad = 0

console.log(`\nApp Store · ${date}`)
if (ascMissing().length) { console.log(`❌ not configured: ${ascMissing().join(', ')}`); bad++ }
else {
  const r = await fetchAscDay(date)
  if (r.ok) console.log(`✅ ${r.units} first downloads ${JSON.stringify(r.byCountry)}`)
  else if (r.notYet) console.log('⚠️  no report for that day yet (404) — try --date two or three days back')
  else { console.log(`❌ ${r.error}`); bad++ }
}

const month = date.slice(0, 7).replace('-', '')
console.log(`\nGoogle Play · ${month}`)
if (playMissing().length) { console.log(`❌ not configured: ${playMissing().join(', ')}`); bad++ }
else {
  const r = await fetchPlayMonth(month)
  if (r.ok) {
    const days = Object.keys(r.days).sort()
    console.log(`✅ ${days.length} days, ${Object.values(r.days).reduce((s, n) => s + n, 0)} user installs${days.length ? ` (${days[0]} … ${days.at(-1)})` : ''}`)
  } else if (r.notYet) console.log('⚠️  no report for that month yet (404)')
  else { console.log(`❌ ${r.error}`); bad++ }
}
process.exit(bad ? 1 : 0)
