// Design-review screenshots for docs/DAYLIE_V3_UI_FIX.md: one phase's screens
// of the simple edition, from the website on the emulators with the demo
// family (demo-seed.mjs), signed in as the family member. Nothing touches a
// real project. Run by ui-shots.sh; pictures land in docs/v3-ui/<phase>-*.png.
//
//   UI_PHASE=A0 (default)   which phase's set of screens
//   UI_ONLY=<name,...>      only those screens

import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { serveSite } from './servers.mjs'
import { seedDemoFamily, seedTodayMemos } from './demo-seed.mjs'
import { spawn } from 'node:child_process'
import { click, elderSession, FAKE_CAMERA_ARGS, familyAccount, launchBrowser, openPage, settle, sleep, tab, waitText } from './shot-kit.mjs'
import { serveFakeModel } from './servers.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'docs', 'v3-ui')
const SITE_PORT = 5222
const SITE = `http://localhost:${SITE_PORT}`
const PROJECT = 'demo-trackbyphoto'
const KID = { name: '지민', email: 'jimin@example.com' }
const PHASE = process.env.UI_PHASE || 'A0'
const only = process.env.UI_ONLY ? new Set(process.env.UI_ONLY.split(',')) : null

await mkdir(OUT, { recursive: true })
initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` })
await getFirestore().doc('admin_config/plans').set({
  flags: { reactions: true, familyPhotos: true, trailMap: true, pushFamily: true, digest: false, planSheet: false, voiceReplies: false, retentionJob: false, usageCaps: false, cloudMemo: false },
})

const acct = await familyAccount(KID)
const { momUid } = await seedDemoFamily({ kidUid: acct.localId, kidName: KID.name })
const site = await serveSite(join(HERE, '.tmp', 'ui-site'), SITE_PORT)
const browser = await launchBrowser(process.env.UI_HEADFUL === '1')
const self = acct.localId

const home = async (p, who) => { await p.goto(SITE, { waitUntil: 'load' }); await waitText(p, who) }

// A second family account that looks after nobody (the 엄마 연결하기 screen).
const KID2 = { name: '수진', email: 'sujin@example.com' }
let acct2 = null
const newcomer = async () => (acct2 ??= await familyAccount(KID2))

// A lived-in 알림 tab: today's photo and words, the evening count, a quiet
// day, and the bookkeeping rows that fold into 연결 기록.
async function seedNotices() {
  const db = getFirestore()
  const H = 3600e3
  const at = (hoursAgo, extra = {}) => ({ recipientUid: self, patientUid: momUid, actorUid: momUid, read: true, createdAt: Timestamp.fromMillis(Date.now() - hoursAgo * H), ...extra })
  const rows = [
    at(0.3, { type: 'photo.new', message: '엄마님이 새 사진을 올렸어요', read: false }),
    at(1.5, { type: 'reaction.comment', message: '엄마님이 글을 남겼어요: “고마워”', read: false }),
    at(20, { type: 'daily.photos', message: '오늘 엄마님 사진 3장' }),
    at(44, { type: 'checkin.no_photo', message: '오늘 아직 엄마님의 사진이 없어요' }),
    at(70, { type: 'device.pair', message: '엄마님 휴대폰(iPhone)이 연결되었어요.' }),
    at(71, { type: 'settings.update', message: '가족이 설정을 변경했어요.' }),
  ]
  for (const r of rows) await db.collection('notifications').add(r)
}

// Each phase: screen name → { as: whose records are open, go: how to get
// there, prepare?: data to write first, account?: who is signed in }.
const PHASES = {
  A0: {
    'home-self':          { as: self,   go: (p) => home(p, '안녕하세요') },
    'photos-self':        { as: self,   go: async (p) => { await home(p, '안녕하세요'); await tab(p, '사진'); await waitText(p, '사진') } },
    'notifications-self': { as: self,   go: async (p) => { await home(p, '안녕하세요'); await tab(p, '알림'); await waitText(p, '알림') } },
    'settings-self':      { as: self,   go: async (p) => { await home(p, '안녕하세요'); await tab(p, '설정'); await waitText(p, '설정') } },
    'home-parent':        { as: momUid, go: (p) => home(p, '엄마') },
  },
  A1: {
    'home-no-parent':     { account: newcomer, go: (p) => home(p, '엄마 연결하기') },
    'home-parent-empty':  { as: momUid, go: (p) => home(p, '오늘 아직 사진이 없어요') },
    'home-parent-day':    { as: momUid, prepare: () => seedTodayMemos({ momUid, kidUid: self, kidName: KID.name, count: 9 }), go: (p) => home(p, '사진 9장') },
    'photos-yesterday':   { as: momUid, go: async (p) => { await home(p, '사진 9장'); await click(p, '어제 보기'); await waitText(p, '어제') } },
  },
  A2: {
    // One unread notice, so the 알림 tab wears its dot.
    'home-self':      { as: self, prepare: () => getFirestore().collection('notifications').add({ recipientUid: self, patientUid: momUid, actorUid: momUid, type: 'photo.new', message: '엄마님이 새 사진을 올렸어요', memoId: '', read: false, createdAt: FieldValue.serverTimestamp() }), go: (p) => home(p, '안녕하세요') },
    'photos-self':    { as: self, go: async (p) => { await home(p, '안녕하세요'); await tab(p, '사진'); await waitText(p, '사진') } },
    'settings-self':  { as: self, go: async (p) => { await home(p, '안녕하세요'); await tab(p, '설정'); await waitText(p, '설정') } },
    'home-parent':    { as: momUid, prepare: () => seedTodayMemos({ momUid, kidUid: self, kidName: KID.name, count: 3 }), go: (p) => home(p, '사진 보내기') },
    'photos-parent':  { as: momUid, go: async (p) => { await home(p, '사진 보내기'); await tab(p, '사진'); await waitText(p, '사진') } },
  },
  A3: {
    'photos-list':    { as: momUid, prepare: () => seedTodayMemos({ momUid, kidUid: self, kidName: KID.name, count: 3 }), go: async (p) => { await home(p, '엄마'); await tab(p, '사진'); await waitText(p, '♥') } },
    'photo-detail':   { as: momUid, go: async (p) => { await home(p, '엄마'); await tab(p, '사진'); await waitText(p, '♥'); await p.click('.tl-item'); await waitText(p, '가족 이야기') } },
    'photo-menu':     { as: momUid, go: async (p) => { await home(p, '엄마'); await tab(p, '사진'); await waitText(p, '♥'); await p.click('.tl-item'); await click(p, '더보기'); await waitText(p, '지우기') } },
    'photo-confirm':  { as: momUid, go: async (p) => { await home(p, '엄마'); await tab(p, '사진'); await waitText(p, '♥'); await p.click('.tl-item'); await click(p, '더보기'); await sleep(500); await click(p, '지우기', '.sheet-item'); await waitText(p, '이 사진을 지울까요?'); await sleep(400) } },
  },
  A4: {
    'alerts':         { as: momUid, prepare: () => seedNotices(), go: async (p) => { await home(p, '엄마'); await tab(p, '알림'); await waitText(p, '연결 기록') } },
    'alerts-history': { as: momUid, go: async (p) => { await home(p, '엄마'); await tab(p, '알림'); await waitText(p, '연결 기록'); await click(p, '연결 기록'); await waitText(p, '휴대폰(iPhone)이 연결되었어요') } },
    'settings-alerts': { as: momUid, go: async (p) => { await home(p, '엄마'); await tab(p, '설정'); await waitText(p, '앱 알림'); await p.evaluate(() => document.querySelector('.switch[aria-label="앱 알림 전환"]')?.scrollIntoView({ block: 'center' })); await sleep(300) } },
  },
  A5: {
    'settings-parent': { as: momUid, go: async (p) => { await home(p, '엄마'); await tab(p, '설정'); await waitText(p, '도움말') } },
    'settings-self':   { as: self, go: async (p) => { await home(p, '안녕하세요'); await tab(p, '설정'); await waitText(p, '함께 보는 가족') } },
    'settings-menu':   { as: self, go: async (p) => { await home(p, '안녕하세요'); await tab(p, '설정'); await waitText(p, '함께 보는 가족'); await click(p, '엄마님 더보기'); await waitText(p, '엄마님 삭제'); await sleep(400) } },
    'settings-bottom': { as: self, go: async (p) => { await home(p, '안녕하세요'); await tab(p, '설정'); await waitText(p, '계정 삭제하기'); await p.evaluate(() => document.querySelector('.quiet-link')?.scrollIntoView({ block: 'end' })); await sleep(300) } },
  },
}
// ── A6: the parent's phone. Pairing needs the worker, so it runs here with
// the fake model; the camera screens use a fake camera. ──────────────────
const shotFile = (name) => join(OUT, `${PHASE}-${name}.png`)
const snap = async (p, name, { quick = false } = {}) => { if (!quick) await settle(p); await p.screenshot({ path: shotFile(name) }); console.log('  ', `${PHASE}-${name}.png`) }

/** Runs a worker handler in a child process (the worker's own firebase-admin). */
function workerCall(env, script) {
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

async function shootA6() {
  const MODEL_PORT = 5231
  const model = await serveFakeModel(MODEL_PORT)
  const env = {
    ...process.env, GCLOUD_PROJECT: PROJECT, GOOGLE_CLOUD_PROJECT: PROJECT,
    FIREBASE_STORAGE_BUCKET: `${PROJECT}.appspot.com`, WORKER_STATE_DIR: join(HERE, '.tmp', 'ui-state'),
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
  const link = (mode) => workerCall(env, `
    import { initializeApp } from 'firebase-admin/app'
    initializeApp({ projectId: '${PROJECT}', storageBucket: '${PROJECT}.appspot.com' })
    const { createPairingLink } = await import('./dist/handlers/pairing.js')
    console.log(JSON.stringify(await createPairingLink({ uid: '${self}', email: '${KID.email}', name: '${KID.name}', emailVerified: true }, { patientUid: '${momUid}', mode: '${mode}' })))
    process.exit(0)`)
  const plain = await launchBrowser(process.env.UI_HEADFUL === '1')
  const camera = await launchBrowser(process.env.UI_HEADFUL === '1', FAKE_CAMERA_ARGS)
  try {
    // 1. Sign-in: 부모님 휴대폰이에요 under Google.
    {
      const p = await openPage(plain, { device: 'iphone', signedIn: false })
      await p.goto(SITE, { waitUntil: 'load' })
      await waitText(p, '부모님 휴대폰이에요')
      await snap(p, 'signin')
      await p.browserContext().close()
    }
    // 2. The link opened on the parent's phone → 연결하기 → the consent screen → camera's plain sentence.
    {
      const { url } = await link('qr')
      const p = await openPage(plain, { device: 'iphone', signedIn: false })
      const u = new URL(url)
      // web=1: link right here in the browser (no app-install page); on an
      // iPhone the page first offers the home-screen icon — skip it.
      await p.goto(`${SITE}${u.pathname}${u.search}&web=1${u.hash}`, { waitUntil: 'load' })
      try {
        await click(p, '아이콘 없이 여기서 연결하기', 'button.pair-link')
      } catch { /* already on 연결하기 */ }
      try {
        await click(p, '연결하기', 'button.pair-btn')
        await waitText(p, '가족에게 오늘 하루를 보여드릴까요?', 60_000)
        await snap(p, 'consent')
        await click(p, '네, ', 'button.pair-btn')
        await waitText(p, '카메라', 60_000)
        await snap(p, 'ask')
      } catch (err) {
        await p.screenshot({ path: shotFile('FAIL-pair') }).catch(() => {})
        throw err
      }
      await p.browserContext().close()
    }
    // 3. A second phone, linked in-process (QR, no approval), with a fake camera: viewfinder, bubble, overlay.
    {
      const { code } = await link('qr')
      const anon = `anon-${Date.now()}`
      const paired = await workerCall(env, `
        import { initializeApp } from 'firebase-admin/app'
        initializeApp({ projectId: '${PROJECT}', storageBucket: '${PROJECT}.appspot.com' })
        const { pairDevice } = await import('./dist/handlers/pairing.js')
        console.log(JSON.stringify(await pairDevice({ uid: '${anon}', email: null, name: null }, { code: '${code}', device: { name: 'iPhone', platform: 'web' } })))
        process.exit(0)`)
      const session = await elderSession(paired.customToken, momUid)
      const p = await openPage(camera, { device: 'iphone', session })
      await p.goto(SITE, { waitUntil: 'load' })
      try {
        // Headless Chrome reports the camera as not asked yet even with the
        // fake one: the plain sentence comes first — tap 다음 to let it start.
        await p.waitForSelector('.elder-cam, .signin', { timeout: 60_000 })
        const next = await p.waitForSelector('.elder-ask-next', { timeout: 8_000 }).catch(() => null)
        if (next) await next.click()
        await p.waitForSelector('.elder-cam-shutter:not([disabled])', { timeout: 60_000 })
      } catch (err) {
        await p.screenshot({ path: shotFile('FAIL-camera') }).catch(() => {})
        throw err
      }
      await snap(p, 'camera')
      const memoIds = await seedTodayMemos({ momUid, kidUid: self, kidName: KID.name, count: 1 })
      await waitText(p, '글을 남겼어요', 30_000)
      await snap(p, 'bubble')
      await click(p, '글을 남겼어요')
      await sleep(600)
      await p.click('.elder-cam-shutter')
      await p.waitForSelector('.elder-cam-overlay', { timeout: 30_000 })
      await snap(p, 'overlay', { quick: true })
      await p.browserContext().close()
      console.log(`   (memos seeded: ${memoIds.length})`)
    }
  } finally {
    worker.kill('SIGTERM')
    model.close()
    await plain.close().catch(() => {})
    await camera.close().catch(() => {})
  }
}

if (PHASE === 'A6') {
  try { await shootA6(); console.log(`pictures in ${OUT}`) } finally { await browser.close(); site.close() }
  process.exit(0)
}

const screens = PHASES[PHASE]
if (!screens) throw new Error(`no screens defined for phase ${PHASE}`)

try {
  for (const [name, { as, go, prepare, account }] of Object.entries(screens)) {
    if (only && !only.has(name)) continue
    if (prepare) await prepare()
    const who = account ? await account() : acct
    const kid = account ? KID2 : KID
    const p = await openPage(browser, { device: 'iphone', acct: who, kid, activePatient: account ? undefined : as })
    const file = join(OUT, `${PHASE}-${name}.png`)
    try {
      await go(p)
      await settle(p)
      await p.screenshot({ path: file })
      console.log('  ', `${PHASE}-${name}.png`)
    } catch (err) {
      console.log(`   ${name} FAILED: ${String(err.message).split('\n')[0]}`)
      await p.screenshot({ path: join(OUT, `FAIL-${PHASE}-${name}.png`) }).catch(() => {})
    }
    await p.browserContext().close()
  }
  console.log(`pictures in ${OUT}`)
} finally {
  await browser.close()
  site.close()
}
