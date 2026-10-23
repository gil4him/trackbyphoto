// §Q screenshots of the 운영실 (/admin, docs/admin/DAYLIE_ADMIN_DASHBOARD.md):
// every view at the six §Q.2 viewports, signed in as the emulator admin, with
// the demo family seeded and the worker answering (fake model). Nothing
// touches a real project. Run by admin-shots.sh; pictures land in
// docs/admin/shots/<phase>/<view>-<viewport>.png, findings in report.json.
//
//   ADMIN_PHASE=D0 (default)   which folder
//   ADMIN_ONLY=<view,...>      only those views

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { serveFakeModel, serveSite } from './servers.mjs'
import { seedDemoFamily, seedTodayMemos } from './demo-seed.mjs'
import { ADMIN_QA_MATRIX, audit, familyAccount, launchBrowser, openPage, settle, sleep, textScale, waitText } from './shot-kit.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PHASE = process.env.ADMIN_PHASE || 'D0'
const OUT = join(HERE, '..', 'docs', 'admin', 'shots', PHASE)
const PROJECT = 'demo-trackbyphoto'
const SITE_PORT = 5223
const SITE = `http://localhost:${SITE_PORT}`
const MODEL_PORT = 5232
const ADMIN = { name: '운영자', email: 'zymer4him@gmail.com' }
const KID = { name: '지민', email: 'jimin@example.com' }
const only = process.env.ADMIN_ONLY ? new Set(process.env.ADMIN_ONLY.split(',')) : null

/** Each view: its address and a sentence that is on it once it has loaded. */
const VIEWS = [
  { id: 'today', search: '', ready: '관리자 작업 기록' },
  { id: 'inbox', search: '?tab=inbox', ready: '곧 만들어요' },
  { id: 'growth', search: '?tab=growth', ready: '곧 만들어요' },
  { id: 'families-parent', search: '?tab=families&kind=parent', ready: '엄마' },
  { id: 'families-child', search: '?tab=families&kind=child', ready: KID.email },
  { id: 'revenue', search: '?tab=revenue', ready: '곧 만들어요' },
  { id: 'costs', search: '?tab=costs', ready: '곧 만들어요' },
  { id: 'system', search: '?tab=system', ready: '곧 만들어요' },
  { id: 'flags', search: '?tab=flags', ready: '곧 만들어요' },
  { id: 'ai', search: '?tab=ai', ready: 'AI' },
  // An old link lands on its new view.
  { id: 'old-parents-link', search: '?tab=parents', ready: '엄마', expectUrl: '/admin?tab=families&kind=parent' },
]

await mkdir(OUT, { recursive: true })
initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` })
await getFirestore().doc('admin_config/plans').set({ flags: { reactions: true, familyPhotos: true } })

const kid = await familyAccount(KID)
const { momUid } = await seedDemoFamily({ kidUid: kid.localId, kidName: KID.name })
await seedTodayMemos({ momUid, kidUid: kid.localId, kidName: KID.name, count: 5 })
const admin = await familyAccount(ADMIN)

// The worker answers adminListPeople and beats system/worker.
const model = await serveFakeModel(MODEL_PORT)
const env = {
  ...process.env, GCLOUD_PROJECT: PROJECT, GOOGLE_CLOUD_PROJECT: PROJECT,
  FIREBASE_STORAGE_BUCKET: `${PROJECT}.appspot.com`, WORKER_STATE_DIR: join(HERE, '.tmp', 'admin-state'),
  APP_URL: `${SITE}/`, OLLAMA_BASE_URL: `http://127.0.0.1:${MODEL_PORT}`, EDITION: 'simple',
}
for (const k of ['GOOGLE_APPLICATION_CREDENTIALS', 'KAKAO_REST_KEY', 'GEMINI_API_KEY', 'SMTP_URL']) delete env[k]
const worker = spawn(process.execPath, [join(HERE, '..', 'worker', 'dist', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
await new Promise((resolve, reject) => {
  const onData = (c) => { log += c; if (log.includes('[worker] listening')) resolve() }
  worker.stdout.on('data', onData); worker.stderr.on('data', onData)
  worker.on('exit', (code) => reject(new Error(`worker exited (${code})\n${log.slice(-600)}`)))
  setTimeout(() => reject(new Error(`worker did not start\n${log.slice(-600)}`)), 30_000)
})

const site = await serveSite(join(HERE, '.tmp', 'admin-site'), SITE_PORT)
const browser = await launchBrowser(process.env.UI_HEADFUL === '1')
const report = []
let failed = 0
try {
  for (const v of VIEWS) {
    if (only && !only.has(v.id)) continue
    for (const q of ADMIN_QA_MATRIX) {
      const p = await openPage(browser, { device: q.device, acct: admin, kid: ADMIN })
      await p.goto(`${SITE}/admin${v.search}`, { waitUntil: 'load' })
      await waitText(p, v.ready, 45_000)
      // The list from the worker, and a live beat for the footer.
      await p.waitForFunction(() => !document.body.innerText.includes('불러오는 중'), { timeout: 45_000 }).catch(() => {})
      await p.waitForFunction(() => document.body.innerText.includes('메모 서버 정상'), { timeout: 90_000 }).catch(() => {})
      await settle(p)
      if (q.textScale) { await textScale(p, q.textScale); await sleep(300) }
      const name = `${v.id}-${q.id}`
      await p.screenshot({ path: join(OUT, `${name}.png`), fullPage: true })
      // §Q.1: labels ≥13px, touch targets ≥44px. The menu row scrolls by design.
      const findings = await audit(p, { minFont: 13, minTap: 44, smallOk: '.hq-never' })
      const where = await p.evaluate(() => location.pathname + location.search)
      if (v.expectUrl && where !== v.expectUrl) findings.push(`address ${where}, expected ${v.expectUrl}`)
      const shell = findings.filter((f) => /hq|address|horizontal scroll/.test(f))
      if (shell.length) failed++
      report.push({ view: v.id, viewport: q.id, shell, inside: findings.filter((f) => !shell.includes(f)) })
      console.log(`  ${name}.png  shell:${shell.length ? ' ' + shell.join(' | ') : ' OK'}  inside: ${findings.length - shell.length}`)
      await p.browserContext().close()
    }
  }
} finally {
  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 1))
  await browser.close()
  site.close(); model.close(); worker.kill('SIGTERM')
}
console.log(`pictures in ${OUT}`)
process.exit(failed ? 1 : 0)
