// Checks every map the family can see, on real data, the way the app draws it:
//
//   cd app && npx vite-node scripts/map-check.ts -- --env ~/daylie-secrets/simple/worker.env [--days 14]
//
// For each parent and each day with located photos (last N days) it builds
// the same stops (lib/trail trailStops) and picks the same provider
// (lib/map pickProvider) as the home card (Home.tsx DayMap) and the
// 다녀온 곳 page (Trail.tsx). A Google Static Maps picture is fetched as the
// apps fetch it (Referer: the website, the iPhone app, the Android app) and
// must come back as a real map image. Kakao is checked once per origin: its
// JavaScript key only works on the domains registered for it. Reads
// Firestore; writes nothing. Exit 1 when a map would not show.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { trailStops, homeFor } from '../src/lib/trail'
import { pickProvider, type MapKeys } from '../src/lib/map/index'
import { staticMapUrl } from '../src/lib/map/googleStatic'
import type { Memo } from '../src/types'

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const envFile = (arg('env', '~/daylie-secrets/simple/worker.env') as string).replace(/^~/, homedir())
const DAYS = Number(arg('days', '14'))

// The service account, as the worker uses it.
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
// The public map keys, as the simple build ships them.
const appEnv = readFileSync(resolve(__dirname, '../../simple/app/.env.simple'), 'utf8')
const envVal = (k: string) => appEnv.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() || undefined
const keys: MapKeys = { kakao: envVal('VITE_KAKAO_JS_KEY'), google: envVal('VITE_GOOGLE_MAPS_KEY') }

const require = createRequire(resolve(__dirname, '../../worker/package.json'))
const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
initializeApp({ credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS) })
const db = getFirestore()

/** Where the apps run: the website, the iPhone app's web view, the Android app's. */
const ORIGINS = ['https://dayliesimple.web.app', 'capacitor://localhost', 'https://localhost']
const problems: string[] = []

/** A Google static map as an app gets it: 200, an image, and more than the error tile. */
async function checkStatic(url: string, origin: string): Promise<string | null> {
  if (url.length > 8192) return `URL too long (${url.length} chars)`
  const res = await fetch(url, { headers: { Referer: `${origin}/` } })
  const type = res.headers.get('content-type') || ''
  const warning = res.headers.get('x-staticmap-api-warning')
  const bytes = (await res.arrayBuffer()).byteLength
  if (res.status !== 200) return `HTTP ${res.status}`
  if (!type.startsWith('image/')) return `not an image (${type})`
  if (bytes < 8000) return `error tile (${bytes} bytes)`
  if (warning) return `warning: ${warning}`
  return null
}

/** Kakao's SDK for this key, loaded from this origin. */
async function checkKakao(origin: string): Promise<string | null> {
  if (!keys.kakao) return 'no key'
  const res = await fetch(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(keys.kakao)}&autoload=false`, { headers: { Referer: `${origin}/`, Origin: origin } })
  const body = await res.text()
  if (res.status !== 200) return `HTTP ${res.status}`
  if (!/kakao\.maps|daum\.maps/.test(body)) return `no SDK in the answer (${body.slice(0, 80)})`
  return null
}

async function main() {
  console.log(`keys: kakao ${keys.kakao ? 'yes' : 'NO'}, google ${keys.google ? 'yes' : 'NO'}`)
  // Only the website loads Kakao; the apps are expected to be refused (and use Google).
  for (const o of ORIGINS) {
    const k = await checkKakao(o)
    console.log(`kakao sdk from ${o}: ${k ?? 'ok'}${o === ORIGINS[0] ? '' : ' (app: not used)'}`)
    if (k && o === ORIGINS[0]) problems.push(`kakao from ${o}: ${k}`)
  }

  const since = Timestamp.fromDate(new Date(Date.now() - DAYS * 24 * 3600 * 1000))
  const snap = await db.collection('memos').where('takenAt', '>=', since).get()
  const byParent = new Map<string, Memo[]>()
  for (const d of snap.docs) {
    const m = { id: d.id, ...d.data() } as Memo
    if (!byParent.has(m.patientUid)) byParent.set(m.patientUid, [])
    byParent.get(m.patientUid)!.push(m)
  }

  let maps = 0
  for (const [uid, memos] of byParent) {
    const user = (await db.doc(`users/${uid}`).get()).data() ?? {}
    const home = homeFor(user.home ?? null, memos)
    // A day on the parent's own clock (the phone's offset on each photo).
    const dayOf = (m: Memo) => {
      const off = (m as unknown as { tzOffsetMin?: number }).tzOffsetMin ?? -420
      return new Date(m.takenAt.toMillis() + off * 60_000).toISOString().slice(0, 10)
    }
    const days = new Map<string, Memo[]>()
    for (const m of memos) { const k = dayOf(m); if (!days.has(k)) days.set(k, []); days.get(k)!.push(m) }
    for (const [day, dayMemos] of [...days].sort()) {
      const stops = trailStops(dayMemos, home)
      if (stops.length === 0) continue
      // The website may use Kakao; the store apps can't (its key refuses their origin).
      const provider = pickProvider(stops, keys, true)
      const appProvider = pickProvider(stops, keys, false)
      const where = `${user.patientName ?? uid.slice(0, 6)} ${day} (${stops.length} stops, web ${provider}, app ${appProvider})`
      if (appProvider === 'sketch') {
        problems.push(`${where}: no map key for this area, sketch only`)
        console.log(`✗ ${where}: sketch only`)
        continue
      }
      // Kakao is checked per origin above; the website uses it only from its own domain.
      const staticOrigins = provider === 'kakao' ? ORIGINS.slice(1) : ORIGINS
      for (const [label, size] of [['home card', { width: 640, height: 300 }], ['다녀온 곳', { width: 640, height: 400 }]] as const) {
        const url = staticMapUrl(stops, keys.google!, size)
        for (const o of staticOrigins) {
          maps++
          const bad = await checkStatic(url, o)
          if (bad) { problems.push(`${where} ${label} from ${o}: ${bad}`); console.log(`✗ ${where} ${label} from ${o}: ${bad}`) }
        }
      }
      console.log(`✓ ${where}`)
    }
  }
  console.log(`\n${maps} static maps fetched, ${problems.length} problem(s)`)
  for (const p of problems) console.log(`  - ${p}`)
  process.exit(problems.length ? 1 : 0)
}

void main()
