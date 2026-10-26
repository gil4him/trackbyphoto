// Design-review screenshots for docs/DAYLIE_V3_UI_FIX.md: one phase's screens
// of the simple edition, from the website on the emulators with the demo
// family (demo-seed.mjs), signed in as the family member. Nothing touches a
// real project. Run by ui-shots.sh; pictures land in docs/v3-ui/<phase>-*.png.
//
//   UI_PHASE=A0 (default)   which phase's set of screens
//   UI_ONLY=<name,...>      only those screens
//   UI_MATRIX=1             every screen on the §Q.2 device matrix instead
//                           (<phase>-<screen>-<width>[-L].png) with the §Q.1 audit

import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { serveSite } from './servers.mjs'
import { seedDemoFamily, seedFamilyPhotos, seedOwnMemos, seedSecondParent, seedTodayMemos } from './demo-seed.mjs'
import { spawn } from 'node:child_process'
import { audit, click, elderSession, FAKE_CAMERA_ARGS, familyAccount, launchBrowser, openPage, QA_MATRIX, settle, sleep, tab, textScale, waitText } from './shot-kit.mjs'
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
// UI_DEVICE=play takes Play-ratio shots (shot-kit VIEWPORTS); default iPhone 6.7".
const DEVICE = process.env.UI_DEVICE || 'iphone'
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

// Nine photos of 엄마's today, seeded once per run (A13's three screens share them).
let nine = null
const nineToday = () => (nine ??= seedTodayMemos({ momUid, kidUid: self, kidName: KID.name, count: 9 }))

// Each phase: screen name → { as: whose records are open, go: how to get
// there, prepare?: data to write first, account?: who is signed in,
// open?: (device) → page, for screens that are not the family's (a parent's phone) }.
// §Q.1 audit rules for A14 (see the phase).
const A14_FAMILY = { smallOk: 'nav.tabbar, .memo-row-rx, .diary-status, .day-time' }
const A14_PARENT = { minFont: 20, minTap: 60, smallOk: 'nav.tabbar' }
let momSession = null
let dad = null
let dadPhone = null
const momPhone = async (device) => { const k = await elderKit(); momSession ??= await k.phone(); return openPage(k.camera, { device, session: momSession }) }
const PHASES = {
  // A14: calmer family lists and the parent's 내 사진 (docs/DAYLIE_V3_UI_FIX.md
  // Round 3). The empty day comes first, before anything is seeded for today.
  // The family's 13pt counts (♥ n 💬 n, 보냈어요) and the 14pt time column
  // are set by the spec, as the tab labels are; the parent's 내 사진 is held to the parent's 60pt buttons
  // and its own type sizes (20pt at the smallest).
  A14: {
    'myday-empty': { as: self, rules: A14_FAMILY, go: async (p) => { await home(p, '내 하루'); await waitText(p, '찍은 사진은') } },
    myday: {
      as: self, rules: A14_FAMILY,
      prepare: async () => {
        await seedOwnMemos({ kidUid: self, days: [0, 1, 2] })
        await seedTodayMemos({ momUid, kidUid: self, kidName: KID.name, count: 4 })
        await seedFamilyPhotos({ momUid, kidUid: self, kidName: KID.name, count: 1 })
      },
      go: async (p) => { await home(p, '내 하루'); await p.waitForSelector('.day-card') },
    },
    'myday-expanded': { as: self, rules: A14_FAMILY, go: async (p) => { await home(p, '내 하루'); await p.waitForSelector('.diary-group'); await p.click('.diary-group'); await sleep(300) } },
    'detail-hint': { as: self, rules: A14_FAMILY, go: async (p) => { await home(p, '내 하루'); await p.click('.day-card > .day-item > .memo-row:not(.diary-row)'); await p.waitForSelector('.menu-hint') } },
    'send-sheet': {
      as: self, rules: A14_FAMILY,
      go: async (p) => {
        await home(p, '내 하루'); await p.click('.day-card > .day-item > .memo-row:not(.diary-row)')
        await click(p, '더보기'); await sleep(300); await click(p, '부모님께 보내기', '.sheet-item'); await p.waitForSelector('.send-message'); await sleep(400)
      },
    },
    past: { as: self, rules: A14_FAMILY, go: async (p) => { await home(p, '내 하루'); await tab(p, '어제까지'); await p.waitForSelector('.day-card') } },
    'past-bottom': { as: self, rules: A14_FAMILY, go: async (p) => { await home(p, '내 하루'); await tab(p, '어제까지'); await p.waitForSelector('.day-card'); await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(400) } },
    'parent-day': { as: momUid, rules: A14_FAMILY, prepare: () => seedTodayMemos({ momUid, kidUid: self, kidName: KID.name, count: 9 }), go: (p) => home(p, '다녀온 곳') },
    trail: { as: momUid, rules: A14_FAMILY, go: async (p) => { await home(p, '다녀온 곳'); await click(p, '다녀온 곳', '.day-map-open'); await waitText(p, '들름'); await sleep(1500) } },
    'elder-records': { open: momPhone, rules: A14_PARENT, go: async (p) => { await viewfinder(p); await p.click('.elder-cam-records'); await p.waitForSelector('.elder-card'); await sleep(600) } },
    'elder-records-bottom': {
      open: momPhone, rules: A14_PARENT,
      go: async (p) => { await viewfinder(p); await p.click('.elder-cam-records'); await p.waitForSelector('.elder-card'); await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(600) },
    },
  },
  // T1: the family's tabs by time. 오늘 (own page) is 내 하루: one's own
  // photos by time with 엄마's and what one sent her woven in, indented;
  // 지난 기록: everything before today. The same two on 엄마's page.
  T1: {
    'today-self': {
      as: self,
      prepare: async () => {
        await seedTodayMemos({ momUid: self, kidUid: momUid, kidName: '엄마', count: 3 })
        await seedTodayMemos({ momUid, kidUid: self, kidName: KID.name, count: 3 })
        await seedFamilyPhotos({ momUid, kidUid: self, kidName: KID.name, count: 1 })
      },
      go: async (p) => { await home(p, '내 하루'); await p.waitForSelector('.parent-memo') },
    },
    'past-self': {
      as: self,
      prepare: () => seedTodayMemos({ momUid: self, kidUid: momUid, kidName: '엄마', count: 3, now: Date.now() - 24 * 3600e3 }),
      go: async (p) => { await home(p, '안녕하세요'); await tab(p, '어제까지'); await waitText(p, '어제') },
    },
    'today-parent': { as: momUid, prepare: () => nineToday(), go: (p) => home(p, '다녀온 곳') },
    'past-parent': {
      as: momUid,
      prepare: () => seedTodayMemos({ momUid, kidUid: self, kidName: KID.name, count: 4, now: Date.now() - 24 * 3600e3 }),
      go: async (p) => { await home(p, '엄마'); await tab(p, '어제까지'); await waitText(p, '어제') },
    },
  },
  A0: {
    'home-self':          { as: self,   go: (p) => home(p, '안녕하세요') },
    'photos-self':        { as: self,   go: async (p) => { await home(p, '안녕하세요'); await tab(p, '어제까지'); await waitText(p, '사진') } },
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
    'photos-self':    { as: self, go: async (p) => { await home(p, '안녕하세요'); await tab(p, '어제까지'); await waitText(p, '사진') } },
    'settings-self':  { as: self, go: async (p) => { await home(p, '안녕하세요'); await tab(p, '설정'); await waitText(p, '설정') } },
    'home-parent':    { as: momUid, prepare: () => seedTodayMemos({ momUid, kidUid: self, kidName: KID.name, count: 3 }), go: (p) => home(p, '사진 보내기') },
    'photos-parent':  { as: momUid, go: async (p) => { await home(p, '사진 보내기'); await tab(p, '어제까지'); await waitText(p, '사진') } },
  },
  A3: {
    'photos-list':    { as: momUid, prepare: () => seedTodayMemos({ momUid, kidUid: self, kidName: KID.name, count: 3 }), go: async (p) => { await home(p, '엄마'); await tab(p, '어제까지'); await waitText(p, '♥') } },
    'photo-detail':   { as: momUid, go: async (p) => { await home(p, '엄마'); await tab(p, '어제까지'); await waitText(p, '♥'); await p.click('.memo-row'); await waitText(p, '가족 이야기') } },
    'photo-menu':     { as: momUid, go: async (p) => { await home(p, '엄마'); await tab(p, '어제까지'); await waitText(p, '♥'); await p.click('.memo-row'); await click(p, '더보기'); await waitText(p, '지우기') } },
    'photo-confirm':  { as: momUid, go: async (p) => { await home(p, '엄마'); await tab(p, '어제까지'); await waitText(p, '♥'); await p.click('.memo-row'); await click(p, '더보기'); await sleep(500); await click(p, '지우기', '.sheet-item'); await waitText(p, '이 사진을 지울까요?'); await sleep(400) } },
  },
  A4: {
    'alerts':         { as: momUid, prepare: () => seedNotices(), go: async (p) => { await home(p, '엄마'); await tab(p, '알림'); await waitText(p, '연결 기록') } },
    'alerts-history': { as: momUid, go: async (p) => { await home(p, '엄마'); await tab(p, '알림'); await waitText(p, '연결 기록'); await click(p, '연결 기록'); await waitText(p, '휴대폰(iPhone)이 연결되었어요') } },
    'settings-alerts': { as: momUid, go: async (p) => { await home(p, '엄마'); await tab(p, '설정'); await waitText(p, '앱 알림'); await p.evaluate(() => document.querySelector('.switch[aria-label="앱 알림 전환"]')?.scrollIntoView({ block: 'center' })); await sleep(300) } },
  },
  A5: {
    'settings-parent': { as: momUid, go: async (p) => { await home(p, '엄마'); await tab(p, '설정'); await waitText(p, '도움말') } },
    'settings-self':   { as: self, go: async (p) => { await home(p, '안녕하세요'); await tab(p, '설정'); await waitText(p, '함께 보는 가족') } },
    'settings-menu':   { as: self, go: async (p) => { await home(p, '안녕하세요'); await tab(p, '설정'); await waitText(p, '함께 보는 가족'); await click(p, '엄마 더보기'); await waitText(p, '엄마 삭제'); await sleep(400) } },
    'settings-bottom': { as: self, go: async (p) => { await home(p, '안녕하세요'); await tab(p, '설정'); await waitText(p, '계정 삭제하기'); await p.evaluate(() => document.querySelector('.quiet-link')?.scrollIntoView({ block: 'end' })); await sleep(300) } },
  },
  A7: {
    'home-trail':  { as: momUid, prepare: () => seedTodayMemos({ momUid, kidUid: self, kidName: KID.name, count: 9 }), go: (p) => home(p, '다녀온 곳') },
    'trail':       { as: momUid, go: async (p) => { await home(p, '다녀온 곳'); await click(p, '다녀온 곳', '.day-map-open'); await waitText(p, '오늘 다녀온 곳'); await sleep(4000) } },
    'photos-link': { as: momUid, go: async (p) => { await home(p, '엄마'); await tab(p, '어제까지'); await waitText(p, '다녀온 곳 ›') } },
  },
  // A13: one memo row everywhere. The parent's day with nine photos (the rail,
  // the badges, the small map under the caption), the 사진 tab, and 다녀온 곳
  // opened from the map's pill.
  // Each screen seeds the day once, so any one of them can be taken alone (UI_ONLY).
  A13: {
    'home':   { as: momUid, prepare: () => nineToday(), go: (p) => home(p, '다녀온 곳') },
    'photos': { as: momUid, prepare: () => nineToday(), go: async (p) => { await home(p, '엄마'); await tab(p, '어제까지'); await waitText(p, '다녀온 곳 ›') } },
    'trail':  { as: momUid, prepare: () => nineToday(), go: async (p) => { await home(p, '다녀온 곳'); await click(p, '다녀온 곳', '.day-map-open'); await waitText(p, '오늘 다녀온 곳'); await sleep(4000) } },
  },
  // A10: the family dashboard. One parent with three photos today and an
  // unread notice, then a second parent (아빠, quiet today); nobody linked;
  // the parent's day ending in the 보낸 사진 row.
  // A12: the family-photo viewer on 엄마's phone: three photos from 지민
  // (the demo seed's answered one removed, so the run is 1 / 3 → 3 / 3),
  // opened from the camera's banner. Nothing is answered, so every row sees the same run.
  A12: {
    'viewer-1': {
      prepare: async () => {
        const old = await getFirestore().collection('familyPhotos').where('patientUid', '==', momUid).get()
        await Promise.all(old.docs.map((d) => d.ref.delete()))
        await seedFamilyPhotos({ momUid, kidUid: self, kidName: KID.name, count: 3 })
      },
      open: momPhone,
      go: async (p) => { await openViewer(p); await waitText(p, '1 / 3') },
    },
    'viewer-last': {
      open: momPhone,
      go: async (p) => {
        await openViewer(p)
        await click(p, '다음 사진', '.fp-btn'); await waitText(p, '2 / 3')
        await click(p, '다음 사진', '.fp-btn'); await waitText(p, '돌아가기')
      },
    },
    'viewer-text': {
      open: momPhone,
      go: async (p) => { await openViewer(p); await click(p, '글로 답하기', '.fp-btn'); await waitText(p, '무엇이라고 답할까요?') },
    },
    // 내 사진 on the parent's phone: the photos the family sent sit among the day's own, tinted.
    'records-received': {
      prepare: () => seedTodayMemos({ momUid, kidUid: self, kidName: KID.name, count: 2 }),
      open: momPhone,
      go: async (p) => { await viewfinder(p); await p.click('.elder-cam-records'); await waitText(p, '보냈어요'); await sleep(800) },
    },
  },
  // A11: the parent's camera in the iPhone-camera layout. 엄마's phone has
  // photos (the newest fills the 내 사진 circle) and an answered family photo
  // (the quiet re-view banner); 아빠's phone has nothing yet.
  A11: {
    camera: {
      open: momPhone,
      // The seen family photos live in 내 사진 now; the camera has no quiet re-view bubble.
      go: async (p) => { await viewfinder(p); await sleep(800) },
    },
    'camera-news': {
      prepare: () => seedTodayMemos({ momUid, kidUid: self, kidName: KID.name, count: 1 }),
      open: momPhone,
      go: async (p) => { await viewfinder(p); await waitText(p, '글을 남겼어요') },
    },
    'camera-sent': {
      open: momPhone,
      go: async (p) => {
        await viewfinder(p)
        // The word from family, read; then the shutter. The sent card stays
        // 1.5 s, less than the picture takes to set up: keep that one timer.
        const bubble = await p.$('.elder-cam-bubble:not(.dim)')
        if (bubble) { await bubble.click(); await sleep(600) }
        await p.evaluate(() => { const st = window.setTimeout; window.setTimeout = (fn, ms, ...a) => st(fn, ms === 1500 ? 600_000 : ms, ...a) })
        await p.click('.elder-cam-shutter')
        await p.waitForSelector('.elder-cam-overlay', { timeout: 30_000 })
      },
    },
    'camera-empty': {
      prepare: async () => { dad = await seedSecondParent({ kidUid: self, kidName: KID.name, yesterday: 0 }) },
      open: async (device) => { const k = await elderKit(); dadPhone ??= await k.phone(dad.uid); return openPage(k.camera, { device, session: dadPhone }) },
      go: async (p) => { await viewfinder(p); await sleep(800) },
    },
  },
  A10: {
    'home-self-1':    { as: self, prepare: async () => {
      await seedTodayMemos({ momUid, kidUid: self, kidName: KID.name, count: 3 })
      await getFirestore().collection('notifications').add({ recipientUid: self, patientUid: momUid, actorUid: momUid, type: 'photo.new', message: '엄마님이 새 사진을 올렸어요', memoId: '', read: false, createdAt: FieldValue.serverTimestamp() })
    }, go: (p) => home(p, '엄마의 하루') },
    'home-self-2':    { as: self, prepare: () => seedSecondParent({ kidUid: self, kidName: KID.name, name: '아빠', yesterday: 2 }), go: (p) => home(p, '아빠의 하루') },
    'home-no-parent': { account: newcomer, go: (p) => home(p, '엄마 연결하기') },
    'parent-day':     { as: momUid, go: (p) => home(p, '보낸 사진 · 1장') },
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

/** The parent's side, started once when a phase needs it: the worker with
 *  the fake model (pairing links), and a browser with a fake camera. */
let elder = null
async function elderKit() {
  if (elder) return elder
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
  const link = (mode, patientUid = momUid) => workerCall(env, `
    import { initializeApp } from 'firebase-admin/app'
    initializeApp({ projectId: '${PROJECT}', storageBucket: '${PROJECT}.appspot.com' })
    const { createPairingLink } = await import('./dist/handlers/pairing.js')
    console.log(JSON.stringify(await createPairingLink({ uid: '${self}', email: '${KID.email}', name: '${KID.name}', emailVerified: true }, { patientUid: '${patientUid}', mode: '${mode}' })))
    process.exit(0)`)
  /** A parent's phone linked in-process (QR, no approval): the SDK session for it. */
  const phone = async (patientUid = momUid) => {
    const { code } = await link('qr', patientUid)
    const anon = `anon-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const paired = await workerCall(env, `
      import { initializeApp } from 'firebase-admin/app'
      initializeApp({ projectId: '${PROJECT}', storageBucket: '${PROJECT}.appspot.com' })
      const { pairDevice } = await import('./dist/handlers/pairing.js')
      console.log(JSON.stringify(await pairDevice({ uid: '${anon}', email: null, name: null }, { code: '${code}', device: { name: 'iPhone', platform: 'web' } })))
      process.exit(0)`)
    return elderSession(paired.customToken, patientUid)
  }
  const camera = await launchBrowser(process.env.UI_HEADFUL === '1', FAKE_CAMERA_ARGS)
  const stop = async () => { worker.kill('SIGTERM'); model.close(); await camera.close().catch(() => {}) }
  return (elder = { link, phone, camera, stop })
}

/** The camera page on a parent's phone, up to a live shutter. Headless
 *  Chrome reports the camera as not asked yet even with the fake one: the
 *  plain sentence comes first — tap 카메라 켜기 to let it start. */
async function viewfinder(p) {
  await p.goto(SITE, { waitUntil: 'load' })
  await p.waitForSelector('.elder-cam, .signin', { timeout: 60_000 })
  const next = await p.waitForSelector('.elder-ask-next', { timeout: 8_000 }).catch(() => null)
  if (next) await next.click()
  await p.waitForSelector('.elder-cam-shutter:not([disabled])', { timeout: 60_000 })
  await sleep(1500) // the viewfinder's first frames
}

/** From the camera to the first photo of the run (the banner, lit or quiet). */
async function openViewer(p) {
  await viewfinder(p)
  await p.waitForSelector('.elder-cam-bubble', { timeout: 30_000 })
  await p.click('.elder-cam-bubble')
  await waitText(p, '글로 답하기')
  await p.waitForFunction(() => [...document.querySelectorAll('.fp-photo img')].every((i) => i.complete && i.naturalWidth > 0), { timeout: 20_000 }).catch(() => {})
}

async function shootA6() {
  const { link, phone, camera } = await elderKit()
  const plain = await launchBrowser(process.env.UI_HEADFUL === '1')
  try {
    // 1. Sign-in: 부모님 휴대폰이에요 under Google.
    {
      const p = await openPage(plain, { device: DEVICE, signedIn: false })
      await p.goto(SITE, { waitUntil: 'load' })
      await waitText(p, '부모님 휴대폰이에요')
      await snap(p, 'signin')
      await p.browserContext().close()
    }
    // 2. The link opened on the parent's phone → 연결하기 → the consent screen → camera's plain sentence.
    {
      const { url } = await link('qr')
      const p = await openPage(plain, { device: DEVICE, signedIn: false })
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
        await snap(p, PHASE === 'A9' ? 'permission' : 'ask')
      } catch (err) {
        await p.screenshot({ path: shotFile('FAIL-pair') }).catch(() => {})
        throw err
      }
      await p.browserContext().close()
    }
    // 3. A second phone, linked in-process (QR, no approval), with a fake camera: viewfinder, bubble, overlay.
    {
      const p = await openPage(camera, { device: DEVICE, session: await phone() })
      try {
        await viewfinder(p)
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
      // Photos from the family (A9): the banner opens the newest unseen photo,
      // 다음 walks on, 돌아가기 on the last one brings the camera back with a toast.
      // Only the two new ones: the demo seed's answered photo would be a third stop.
      const old = await getFirestore().collection('familyPhotos').where('patientUid', '==', momUid).get()
      await Promise.all(old.docs.map((d) => d.ref.delete()))
      await seedFamilyPhotos({ momUid, kidUid: self, kidName: KID.name, count: 2 })
      await waitText(p, '사진 2장을 보냈어요', 30_000)
      await snap(p, PHASE === 'A9' ? 'banner' : 'photo-bubble')
      await click(p, '사진 2장을 보냈어요', '.elder-cam-bubble')
      await waitText(p, '글로 답하기')
      await snap(p, 'photo-view')
      await click(p, '다음 사진', '.fp-btn')
      await waitText(p, '돌아가기')
      await click(p, '돌아가기', '.fp-btn')
      await waitText(p, '다 보셨어요', 10_000)
      await snap(p, 'last-to-camera', { quick: true })
      await p.waitForSelector('.elder-cam-shutter:not([disabled])', { timeout: 30_000 })
      await p.click('.elder-cam-shutter')
      await p.waitForSelector('.elder-cam-overlay', { timeout: 30_000 })
      await snap(p, 'overlay', { quick: true })
      await p.browserContext().close()
      console.log(`   (memos seeded: ${memoIds.length})`)
    }
  } finally {
    await plain.close().catch(() => {})
  }
}

if (PHASE === 'A6' || PHASE === 'A9') {
  try { await shootA6(); console.log(`pictures in ${OUT}`) } finally { await elder?.stop(); await browser.close(); site.close() }
  process.exit(0)
}

const screens = PHASES[PHASE]
if (!screens) throw new Error(`no screens defined for phase ${PHASE}`)

// One picture per screen on the chosen device, or (UI_MATRIX=1) one per row
// of the §Q.2 matrix, each with the §Q.1 audit's findings printed under it.
const rows = process.env.UI_MATRIX === '1' ? QA_MATRIX : [{ id: null, device: DEVICE }]
const findings = {}
try {
  for (const [name, { as, go, prepare, account, open, rules }] of Object.entries(screens)) {
    if (only && !only.has(name)) continue
    if (prepare) await prepare()
    const who = account ? await account() : acct
    const kid = account ? KID2 : KID
    for (const row of rows) {
      const file = row.id ? `${PHASE}-${name}-${row.id}.png` : `${PHASE}-${name}.png`
      const p = open ? await open(row.device) : await openPage(browser, { device: row.device, acct: who, kid, activePatient: account ? undefined : as })
      try {
        await go(p)
        await settle(p)
        // The parent's 글자 크기 (App sets the root size from the setting; the demo accounts have it on).
        if (row.bigText) await p.evaluate(() => { document.documentElement.style.fontSize = '17px' })
        if (row.textScale) { await textScale(p, row.textScale); await sleep(300) }
        if (row.id) {
          const found = await audit(p, rules)
          findings[file] = found
          for (const f of found) console.log(`      ! ${f}`)
        }
        // UI_FULL=1: the whole page, not just the first screen.
        await p.screenshot({ path: join(OUT, file), fullPage: process.env.UI_FULL === '1' })
        console.log('  ', file, row.id && !findings[file].length ? 'OK' : '')
      } catch (err) {
        console.log(`   ${file} FAILED: ${String(err.message).split('\n')[0]}`)
        await p.screenshot({ path: join(OUT, `FAIL-${file}`) }).catch(() => {})
      }
      await p.browserContext().close()
    }
  }
  if (rows[0].id) {
    const bad = Object.entries(findings).filter(([, f]) => f.length)
    console.log(bad.length ? `audit: ${bad.length} picture(s) with findings` : 'audit: clean')
  }
  console.log(`pictures in ${OUT}`)
} finally {
  await elder?.stop()
  await browser.close()
  site.close()
}
