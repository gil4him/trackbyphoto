// Is WeatherKit working? Prints what is configured (never the key) and the
// answer for now and for two days ago at Buena Park, CA.
//   npm run weather-check -- [--env ~/daylie-secrets/simple/worker.env]
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const i = process.argv.indexOf('--env')
const envFile = (i >= 0 ? process.argv[i + 1] : join(homedir(), 'daylie-secrets', 'simple', 'worker.env')).replace(/^~(?=\/)/, homedir())
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2').replace(/\$HOME|\$\{HOME\}/g, homedir())
  }
}
const { weatherKitConfigured, weatherProbe } = await import('../weather.js')
const show = (k: string) => console.log(`${k.padEnd(22)} ${process.env[k] ? (k.endsWith('PATH') ? `${process.env[k]} ${existsSync(process.env[k]!) ? '(file found)' : '(FILE NOT FOUND)'}` : process.env[k]) : '(missing)'}`)
console.log(`env file: ${envFile} ${existsSync(envFile) ? '' : '(NOT FOUND)'}`)
for (const k of ['WEATHERKIT_TEAM_ID', 'WEATHERKIT_KEY_ID', 'WEATHERKIT_SERVICE_ID', 'WEATHERKIT_KEY_PATH']) show(k)
if (!weatherKitConfigured()) { console.log('\n❌ not configured'); process.exit(1) }
for (const [label, at] of [['now', new Date()], ['2 days ago', new Date(Date.now() - 2 * 86_400_000)]] as const) {
  try {
    const r = await weatherProbe(33.8616, -117.9987, at)
    console.log(`\n${label}: HTTP ${r.status}${r.status === 200 ? ' ✅' : ' ❌'}\n${r.body}`)
  } catch (err) {
    console.log(`\n${label}: ❌ ${String(err).slice(0, 200)}`)
  }
}
process.exit(0)
