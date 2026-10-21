// Store screenshots of 오늘하루 (the simple edition), taken from the website
// on the emulators with the reviewers' demo family (demo-seed.mjs, the same
// data seed-review-demo.mjs puts in the demo account) plus today's photos.
// Nothing touches a real project. Run by shots.sh; pictures land in
// e2e/.tmp/store-shots/<device>-<n>-<name>.png.
//
// Five screens, in listing order:
//   1-camera    the parent's phone: the camera (a fake camera shows UI_CAMERA_FILE)
//   2-sent      the same, just after the shutter: "지민에게 보냈어요 ♥"
//   3-timeline  the family phone: today's photos
//   4-hearts    one photo opened, with the heart and the comment
//   5-qr        설정 → 휴대폰 연결: the QR the parent's phone scans
//
// The parent's screens need the worker (pairing), run here with the fake model.
//   SHOTS_DEVICES=<iphone69,android916>   which viewports (default both)
//   SHOTS_ONLY=<name,...>                  only those screens

import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { serveFakeModel, serveSite } from './servers.mjs'
import { seedDemoFamily, seedTodayMemos } from './demo-seed.mjs'
import { click, elderSession, FAKE_CAMERA_ARGS, familyAccount, launchBrowser, openPage, settle, sleep, tab, waitText } from './shot-kit.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TMP = join(HERE, '.tmp')
const OUT = join(TMP, 'store-shots')
const SITE_PORT = 5221
const MODEL_PORT = 5232
const SITE = `http://localhost:${SITE_PORT}`
const PROJECT = 'demo-trackbyphoto'
const KID = { name: '지민', email: 'jimin@example.com' }
const TODAY_PHOTOS = 6

const devices = (process.env.SHOTS_DEVICES || 'iphone69,android916').split(',')
const only = process.env.SHOTS_ONLY ? new Set(process.env.SHOTS_ONLY.split(',')) : null
const wanted = (name) => !only || only.has(name)

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })
initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` })
const db = getFirestore()
await db.doc('admin_config/plans').set({
  flags: { reactions: true, familyPhotos: true, trailMap: true, pushFamily: true, digest: false, planSheet: false, voiceReplies: false, retentionJob: false, usageCaps: false, cloudMemo: false },
})

const acct = await familyAccount(KID)
const self = acct.localId
const { momUid } = await seedDemoFamily({ kidUid: self, kidName: KID.name })
await seedTodayMemos({ momUid, kidUid: self, kidName: KID.name, count: TODAY_PHOTOS })
const site = await serveSite(join(TMP, 'shots-site'), SITE_PORT)

// ── The worker, for pairing the parent's phone (as ui-shots.mjs does for A6). ──
const model = await serveFakeModel(MODEL_PORT)
const env = {
  ...process.env, GCLOUD_PROJECT: PROJECT, GOOGLE_CLOUD_PROJECT: PROJECT,
  FIREBASE_STORAGE_BUCKET: `${PROJECT}.appspot.com`, WORKER_STATE_DIR: join(TMP, 'shots-state'),
  APP_URL: `${SITE}/`, OLLAMA_BASE_URL: `http://127.0.0.1:${MODEL_PORT}`, EDITION: 'simple',
}
for (const k of ['GOOGLE_APPLICATION_CREDENTIALS', 'KAKAO_REST_KEY', 'GEMINI_API_KEY', 'SMTP_URL']) delete env[k]
const worker = spawn(process.execPath, [join(HERE, '..', 'worker', 'dist', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
await new Promise((resolve, reject) => {
  const onData = (c) => { log += c; if (log.includes('[worker] listening')) resolve() }
  worker.stdout.on('data', onData); worker.stderr.on('data', onData)
  worker.on('exit', (code) => reject(new Error(`worker exited (${code})\n${log.slice(-600)}`)))
  setTimeout(() => reject(new Error(`worker did not start\n${log.slice(-600)}`)), 90_000)
})

/** Runs a worker handler in a child process (the worker's own firebase-admin). */
function workerCall(script) {
  return new Promise((resolve, reject) => {
    const run = spawn(process.execPath, ['--input-type=module', '-e', script], { env, cwd: join(HERE, '..', 'worker'), stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    run.stdout.on('data', (c) => { out += c })
    run.stderr.on('data', (c) => { out += c })
    run.on('exit', (code) => {
      const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop()
      if (code === 0 && line) resolve(JSON.parse(line)); else reject(new Error(`worker call failed (${code})\n${out.slice(-600)}`))
    })
  })
}
/** A parent's phone linked in-process (QR, no approval): the SDK session for it. */
async function linkedPhone() {
  const { code } = await workerCall(`
    import { initializeApp } from 'firebase-admin/app'
    initializeApp({ projectId: '${PROJECT}', storageBucket: '${PROJECT}.appspot.com' })
    const { createPairingLink } = await import('./dist/handlers/pairing.js')
    console.log(JSON.stringify(await createPairingLink({ uid: '${self}', email: '${KID.email}', name: '${KID.name}', emailVerified: true }, { patientUid: '${momUid}', mode: 'qr' })))
    process.exit(0)`)
  const paired = await workerCall(`
    import { initializeApp } from 'firebase-admin/app'
    initializeApp({ projectId: '${PROJECT}', storageBucket: '${PROJECT}.appspot.com' })
    const { pairDevice } = await import('./dist/handlers/pairing.js')
    console.log(JSON.stringify(await pairDevice({ uid: 'anon-${Date.now()}', email: null, name: null }, { code: '${code}', device: { name: 'iPhone', platform: 'web' } })))
    process.exit(0)`)
  return elderSession(paired.customToken, momUid)
}

const plain = await launchBrowser(process.env.SHOTS_HEADFUL === '1')
const camera = await launchBrowser(process.env.SHOTS_HEADFUL === '1', FAKE_CAMERA_ARGS)

const light = async (p) => { await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]); return p }
const familyPage = (device) => openPage(plain, { device, acct, kid: KID, activePatient: momUid }).then(light)
const shot = async (p, device, name, { quick = false } = {}) => {
  if (!quick) await settle(p)
  const file = `${device}-${name}.png`
  await p.screenshot({ path: join(OUT, file) })
  console.log('  ', file)
}

try {
  // The family phone on every device first: linking the parent's phone
  // (below) puts a '휴대폰이 연결되었어요' notice on the home screen.
  for (const device of devices) {
    console.log(`[${device}] family`)
    // 3–5. The family phone.
    const screens = {
      '3-timeline': async (p) => {
        await p.goto(SITE, { waitUntil: 'load' })
        await waitText(p, `사진 ${TODAY_PHOTOS}장`)
      },
      '4-hearts': async (p) => {
        await p.goto(SITE, { waitUntil: 'load' })
        await waitText(p, '엄마')
        await tab(p, '사진')
        await waitText(p, '♥')
        await p.click('.memo-row') // the newest of today's, with the heart and the comment
        await waitText(p, '산책 잘하셨어요')
      },
      '5-qr': async (p) => {
        await p.goto(SITE, { waitUntil: 'load' })
        await waitText(p, '엄마')
        await tab(p, '설정')
        await click(p, '휴대폰 연결', 'button.linkbtn')
        await waitText(p, 'QR을 비춰주세요')
        await p.waitForSelector('img[src^="data:image"]', { timeout: 30_000 })
      },
    }
    for (const [name, go] of Object.entries(screens)) {
      if (!wanted(name)) continue
      const p = await familyPage(device)
      try {
        await go(p)
        await shot(p, device, name)
      } catch (err) {
        console.log(`   ${device}-${name} FAILED: ${String(err.message).split('\n')[0]}`)
        await p.screenshot({ path: join(OUT, `FAIL-${device}-${name}.png`) }).catch(() => {})
      }
      await p.browserContext().close()
    }
  }
  for (const device of devices) {
    console.log(`[${device}] parent`)
    // 1–2. The parent's phone: the camera, then the shutter.
    if (wanted('1-camera') || wanted('2-sent')) {
      const p = await light(await openPage(camera, { device, session: await linkedPhone() }))
      try {
        await p.goto(SITE, { waitUntil: 'load' })
        // Headless Chrome reports the camera as not asked yet even with the
        // fake one: the plain sentence comes first — tap 다음 to let it start.
        await p.waitForSelector('.elder-cam, .signin', { timeout: 60_000 })
        const next = await p.waitForSelector('.elder-ask-next', { timeout: 8_000 }).catch(() => null)
        if (next) await next.click()
        await p.waitForSelector('.elder-cam-shutter:not([disabled])', { timeout: 60_000 })
        await sleep(1500) // the viewfinder's first frames
        if (wanted('1-camera')) await shot(p, device, '1-camera')
        if (wanted('2-sent')) {
          await p.click('.elder-cam-shutter')
          await p.waitForSelector('.elder-cam-overlay.ok', { timeout: 30_000 })
          await shot(p, device, '2-sent', { quick: true })
        }
      } catch (err) {
        console.log(`   ${device} camera FAILED: ${String(err.message).split('\n')[0]}`)
        await p.screenshot({ path: join(OUT, `FAIL-${device}-camera.png`) }).catch(() => {})
      }
      await p.browserContext().close()
    }
  }
  console.log(`pictures in ${OUT}`)
} finally {
  worker.kill('SIGTERM')
  model.close()
  await plain.close().catch(() => {})
  await camera.close().catch(() => {})
  site.close()
}
