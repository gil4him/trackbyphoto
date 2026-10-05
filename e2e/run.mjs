// End-to-end check of the website: one browser plays a family member, a
// second (separate storage, phone-sized) plays the parent's linked phone.
// Started by run.sh inside `firebase emulators:exec`, so Firestore, Auth and
// Storage are the local emulators. The worker is the real one, run as a
// child process against those emulators.

import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import puppeteer from 'puppeteer-core'
import { FAKE_MEMO, FAKE_SUMMARY, serveFakeModel, serveSite } from './servers.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TMP = join(HERE, '.tmp')
const SHOTS = join(TMP, 'shots')
const SITE_PORT = 5220
const MODEL_PORT = 11500
const SITE = `http://localhost:${SITE_PORT}`
const PROJECT = 'demo-trackbyphoto'
const API_KEY = 'demo-key'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const REAL_LLM = process.env.E2E_REAL_LLM === '1'
const MEMO_WAIT = REAL_LLM ? 180_000 : 60_000
const PARENT = '할머니'
const KID = { name: '민수', email: 'minsu@example.com' }

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  console.error('Run this through run.sh: it must only ever talk to the emulators.')
  process.exit(2)
}

// ── A made-up plans table, with the switches as they are in production ──────
const tier = (o) => ({ familyMembers: 1, retentionDays: 9, messenger: false, weekly: false, checkin: false, recap: false, voiceReplies: false, voiceAlbum: false, aiPhotosPerDay: null, seniors: 1, ...o })
const PLANS = {
  free: tier({}),
  plus: tier({ familyMembers: 3, retentionDays: 400, weekly: true, checkin: true }),
  family: tier({ familyMembers: 6, retentionDays: null, weekly: true, checkin: true, recap: true, seniors: 2 }),
  fairUse: { photosPerDay: null },
  flags: { reactions: true, pushFamily: true, trailMap: true, digest: true, voiceReplies: false, emailDigest: false, usageCaps: false, retentionJob: false, messengerFree: false, planSheet: false },
}

// ── Results ────────────────────────────────────────────────────────────────
const results = []
let pages = {}
async function step(name, fn, { skip } = {}) {
  if (skip) { results.push({ name, state: 'SKIP', note: skip }); console.log(`SKIP  ${name}  (${skip})`); return false }
  const t0 = Date.now()
  try {
    const note = await fn()
    results.push({ name, state: 'PASS', note: note || '' })
    console.log(`PASS  ${name}${note ? '  — ' + note : ''}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
    return true
  } catch (err) {
    const slug = name.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 50)
    for (const [who, page] of Object.entries(pages)) {
      await page.screenshot({ path: join(SHOTS, `${slug}.${who}.png`) }).catch(() => {})
      const text = await page.evaluate(() => document.body.innerText).catch(() => '')
      await writeFile(join(SHOTS, `${slug}.${who}.txt`), text).catch(() => {})
    }
    results.push({ name, state: 'FAIL', note: String(err.message || err).split('\n')[0] })
    console.log(`FAIL  ${name}  — ${String(err.message || err).split('\n')[0]}`)
    return false
  }
}
const expect = (cond, message) => { if (!cond) throw new Error(message) }

// ── Page helpers ───────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const text = (page) => page.evaluate(() => document.body.innerText)
const has = async (page, s) => (await text(page)).includes(s)
const waitText = (page, s, timeout = 20_000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, s)
const waitGone = (page, s, timeout = 20_000) => page.waitForFunction((t) => !document.body.innerText.includes(t), { timeout }, s)
/** Click the first visible, enabled control whose text or aria-label contains `label`. */
async function click(page, label, { selector = 'button, a', timeout = 20_000 } = {}) {
  const handle = await page.waitForFunction((sel, want) => {
    const match = (e) => (e.getAttribute('aria-label') || '').includes(want) || e.textContent.replace(/\s+/g, ' ').includes(want)
    return [...document.querySelectorAll(sel)].find((e) => match(e) && !e.disabled && e.getClientRects().length > 0) || null
  }, { timeout }, selector, label)
  await handle.asElement().click()
}
const tab = (page, label) => click(page, label, { selector: 'nav.tabbar button.tab' })

// ── Setup ──────────────────────────────────────────────────────────────────
await rm(SHOTS, { recursive: true, force: true })
await mkdir(SHOTS, { recursive: true })
initializeApp({ projectId: PROJECT })
const db = getFirestore()
await db.doc('admin_config/plans').set(PLANS)

const site = await serveSite(process.env.E2E_SITE_DIR || join(TMP, 'site'), SITE_PORT)
const model = REAL_LLM ? null : await serveFakeModel(MODEL_PORT)

const workerEnv = {
  ...process.env,
  GCLOUD_PROJECT: PROJECT,
  GOOGLE_CLOUD_PROJECT: PROJECT,
  FIREBASE_STORAGE_BUCKET: `${PROJECT}.appspot.com`,
  WORKER_STATE_DIR: join(TMP, 'state'),
  APP_URL: `${SITE}/`,
  ...(REAL_LLM ? {} : { OLLAMA_BASE_URL: `http://127.0.0.1:${MODEL_PORT}` }),
}
// Never a real key: the worker must only see the emulators.
delete workerEnv.GOOGLE_APPLICATION_CREDENTIALS
delete workerEnv.KAKAO_REST_KEY
delete workerEnv.SMTP_URL
const worker = spawn(process.execPath, [join(HERE, '..', 'worker', 'dist', 'index.js')], { env: workerEnv, stdio: ['ignore', 'pipe', 'pipe'] })
let workerLog = ''
const workerUp = new Promise((resolve, reject) => {
  const onData = (chunk) => { workerLog += chunk; if (workerLog.includes('[worker] listening')) resolve() }
  worker.stdout.on('data', onData)
  worker.stderr.on('data', onData)
  worker.on('exit', (code) => reject(new Error(`worker exited (${code})\n${workerLog.slice(-800)}`)))
  setTimeout(() => reject(new Error(`worker did not start\n${workerLog.slice(-800)}`)), 30_000)
})

// Hosted CI runners have no sandbox for Chrome to use.
const browser = await puppeteer.launch({ executablePath: CHROME, headless: process.env.E2E_HEADFUL !== '1', args: ['--no-first-run', ...(process.env.CI ? ['--no-sandbox'] : [])] })
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

async function finish(code) {
  await browser.close().catch(() => {})
  worker.kill('SIGTERM')
  site.close()
  model?.close()
  const failed = results.filter((r) => r.state === 'FAIL')
  console.log(`\n${results.filter((r) => r.state === 'PASS').length} passed, ${failed.length} failed, ${results.filter((r) => r.state === 'SKIP').length} skipped`)
  if (failed.length) console.log(`Screens and page text of each failure: ${SHOTS}`)
  await writeFile(join(TMP, 'worker.log'), workerLog).catch(() => {})
  process.exit(code ?? (failed.length ? 1 : 0))
}

try {
  await workerUp
} catch (err) {
  console.error(String(err))
  await finish(2)
}

// A synthetic test photo, drawn in the browser (no real photo is in the repo).
async function makePhoto(file, hue) {
  const page = await browser.newPage()
  const b64 = await page.evaluate((h) => {
    const c = document.createElement('canvas')
    c.width = 1200; c.height = 900
    const g = c.getContext('2d')
    g.fillStyle = `hsl(${h} 60% 80%)`; g.fillRect(0, 0, 1200, 900)
    g.fillStyle = '#6aa85a'; g.fillRect(0, 600, 1200, 300)
    g.fillStyle = '#c8b48c'; g.beginPath(); g.moveTo(380, 600); g.lineTo(520, 600); g.lineTo(640, 900); g.lineTo(260, 900); g.fill()
    for (const x of [150, 950]) { g.fillStyle = '#6e5032'; g.fillRect(x - 15, 380, 30, 240); g.fillStyle = '#3c823c'; g.beginPath(); g.arc(x, 330, 110, 0, 7); g.fill() }
    g.fillStyle = '#ffe178'; g.beginPath(); g.arc(1040, 120, 60, 0, 7); g.fill()
    return c.toDataURL('image/jpeg', 0.85).split(',')[1]
  }, hue)
  await page.close()
  await writeFile(file, Buffer.from(b64, 'base64'))
  return file
}
const photos = []
for (const [i, hue] of [200, 30, 280, 120].entries()) photos.push(await makePhoto(join(TMP, `photo${i}.jpg`), hue))

/** A Google-style family account in the Auth emulator, signed in by putting
 *  its session where the Firebase SDK keeps it. (Google's own sign-in screen
 *  can't be part of a local check.) */
async function signedInFamilyPage(who = KID) {
  const res = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: `g-${who.email}`, email: who.email, name: who.name, email_verified: true }))}&providerId=google.com`,
      requestUri: 'http://localhost', returnIdpCredential: true, returnSecureToken: true,
    }),
  })
  const acct = await res.json()
  if (!acct.localId) throw new Error(`could not create the family account: ${JSON.stringify(acct).slice(0, 200)}`)
  const session = {
    uid: acct.localId, email: who.email, emailVerified: true, displayName: who.name, isAnonymous: false,
    providerData: [{ providerId: 'google.com', uid: `g-${who.email}`, displayName: who.name, email: who.email, phoneNumber: null, photoURL: null }],
    stsTokenManager: { refreshToken: acct.refreshToken, accessToken: acct.idToken, expirationTime: Date.now() + 3500_000 },
    createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey: API_KEY, appName: '[DEFAULT]',
  }
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport(PHONE)
  await page.evaluateOnNewDocument((key, value) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, value)
  }, `firebase:authUser:${API_KEY}:[DEFAULT]`, JSON.stringify(session))
  page.on('pageerror', (e) => console.log(`  [${who.name} page error]`, String(e).split('\n')[0]))
  return { page, uid: acct.localId }
}

// ── The run ────────────────────────────────────────────────────────────────
let patientUid = ''
const memoCount = async () => (await db.collection('memos').where('patientUid', '==', patientUid).get()).docs.filter((d) => d.get('status') === 'ready').length
const waitMemos = async (n, timeout = MEMO_WAIT) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { if ((await memoCount()) >= n) return; await sleep(1000) }
  throw new Error(`only ${await memoCount()} of ${n} photos got their note within ${timeout / 1000}s`)
}
async function takePhoto(page, file) {
  const input = await page.waitForSelector('input[type=file]', { timeout: 20_000 })
  await input.uploadFile(file)
}

const { page: family, uid: familyUid } = await signedInFamilyPage()
pages = { family }

await step('family: signed in and on the home screen', async () => {
  await family.goto(SITE, { waitUntil: 'load' })
  await family.waitForSelector('nav.tabbar', { timeout: 30_000 })
})

let pairUrl = ''
await step('family: registers a parent and gets a link for the parent\'s phone', async () => {
  await tab(family, '설정')
  await click(family, '부모님 등록하기')
  await family.type('.modal input', PARENT)
  await click(family, '다음', { selector: '.modal button' })
  await click(family, '다음', { selector: '.modal button' })
  await click(family, '동의하고 등록하기', { selector: '.modal button' })
  await waitText(family, '휴대폰 연결', 70_000)
  // The link itself travels by KakaoTalk, text or QR; catch it where the
  // worker answers (the app removes the answer once it has read it).
  const stop = db.collection('requests').onSnapshot((snap) => {
    for (const c of snap.docChanges()) {
      const r = c.doc.data()
      if (r.type === 'createPairingLink' && r.result?.url) pairUrl = r.result.url
    }
  })
  await click(family, 'QR 보여주기', { selector: '.modal button' })
  const end = Date.now() + 60_000
  while (!pairUrl && Date.now() < end) await sleep(200)
  stop()
  expect(pairUrl, 'the worker never answered with a link')
  const users = await db.collection('users').where('accountType', '==', 'managed').get()
  patientUid = users.docs[0]?.id || ''
  expect(patientUid, 'no managed parent account was created')
  await click(family, '완료', { selector: '.modal button' })
  return 'link received'
})

const parentCtx = await browser.createBrowserContext()
const parent = await parentCtx.newPage()
await parent.setViewport(PHONE)
await parent.setUserAgent(ANDROID)
parent.on('pageerror', (e) => console.log('  [parent page error]', String(e).split('\n')[0]))
pages = { family, parent }

await step('parent: opens the link, taps 연결하기, and lands on the two-button screen', async () => {
  const url = new URL(pairUrl)
  await parent.goto(`${SITE}${url.pathname}${url.search}${url.hash}`, { waitUntil: 'load' })
  await click(parent, '연결하기')
  await waitText(parent, '연결되었어요', 70_000)
  // 확인, then possibly one more screen about the home-screen icon.
  for (let i = 0; i < 3 && !(await parent.$('input[type=file]')); i++) {
    await click(parent, '확인', { timeout: 10_000 }).catch(() => {})
    await sleep(800)
  }
  await parent.waitForSelector('input[type=file]', { timeout: 20_000 })
  expect(await has(parent, '사진 찍기'), 'no 사진 찍기 button')
  expect(!(await parent.$('nav.tabbar')), 'the parent screen shows the tab bar')
  for (const word of ['설정', '요금제', '알림 켜기', '음성']) expect(!(await has(parent, word)), `the parent screen mentions “${word}”`)
})

await step('family: is told a phone was connected', async () => {
  const end = Date.now() + 30_000
  let found = false
  while (!found && Date.now() < end) {
    const n = await db.collection('notifications').where('recipientUid', '==', familyUid).get()
    found = n.docs.some((d) => String(d.get('message')).includes('연결'))
    if (!found) await sleep(500)
  }
  expect(found, 'no “connected” notice for the family')
})

await step('parent takes a photo → the family sees it with its written note', async () => {
  await takePhoto(parent, photos[0])
  await waitText(parent, '사진을 저장했어요', 20_000)
  await waitMemos(1)
  await tab(family, '사진')
  await waitText(family, REAL_LLM ? PARENT : FAKE_MEMO.memo, 30_000)
})

await step('parent takes a photo with no connection → it waits, then goes by itself when the connection returns', async () => {
  await parent.evaluate(() => { window.__noReload = true })
  await parent.setOfflineMode(true)
  await takePhoto(parent, photos[1])
  await waitText(parent, '사진을 저장했어요', 20_000)
  await sleep(4000)
  expect((await memoCount()) === 1, 'the photo reached the server while offline?')
  expect(await has(parent, '휴대폰에 안전하게 보관했어요') || await has(parent, '보내는 중'), 'the parent screen does not say the photo is waiting')
  await parent.setOfflineMode(false)
  await waitMemos(2)
  expect(await parent.evaluate(() => window.__noReload === true), 'the page had to be reloaded')
  await waitGone(parent, '보내는 중', 30_000).catch(() => {})
})

await step('an upload that dies quietly is given up on and retried, without closing the app', async () => {
  // Hold the first upload request for ever: neither an answer nor an error,
  // which is what a connection that went quiet looks like.
  let held = 0
  await parent.setRequestInterception(true)
  const onRequest = (req) => {
    const upload = req.url().includes(':9199') && req.method() === 'POST'
    if (upload && held === 0) { held += 1; return } // never answered
    req.continue().catch(() => {})
  }
  parent.on('request', onRequest)
  const t0 = Date.now()
  await takePhoto(parent, photos[2])
  await waitText(parent, '사진을 저장했어요', 20_000)
  // A second photo queues up behind the dead one.
  await sleep(1500)
  await takePhoto(parent, photos[3])
  await sleep(20_000)
  expect(held === 1, 'the upload request was not held')
  expect((await memoCount()) === 2, 'a photo got through while its upload was held')
  await waitMemos(4, 200_000)
  parent.off('request', onRequest)
  await parent.setRequestInterception(false)
  expect(await parent.evaluate(() => window.__noReload === true), 'the page had to be reloaded')
  return `both photos delivered ${Math.round((Date.now() - t0) / 1000)}s after the upload went quiet`
}, { skip: process.env.E2E_SKIP_STALL === '1' ? 'E2E_SKIP_STALL=1' : undefined })

await step('family sends a heart and a comment → the parent\'s 가족 소식 card lights up', async () => {
  await tab(family, '사진')
  await family.waitForSelector('.tl-item:not(.waiting)', { timeout: 20_000 })
  await family.click('.tl-item:not(.waiting)')
  await click(family, '하트 보내기')
  await family.type('input[aria-label="글 남기기"]', '사진 잘 봤어요')
  await click(family, '보내기', { selector: 'button.rx-send' })
  await waitText(family, '사진 잘 봤어요', 20_000)
  await parent.waitForSelector('.news-card.tappable', { timeout: 40_000 })
  await parent.waitForFunction((name) => {
    const card = document.querySelector('.news-card.tappable')?.textContent || ''
    return card.includes(name) && (card.includes('글을 남겼어요') || card.includes('하트를 보냈어요'))
  }, { timeout: 20_000 }, KID.name)
})

await step('parent answers with a ready-made reply → the family sees it and gets a notice', async () => {
  await parent.click('.news-card.tappable')
  await click(parent, '글로 답장하기')
  await click(parent, '고마워', { selector: 'button.news-btn' })
  await waitText(parent, '보냈어요', 20_000)
  expect(!(await parent.$('.news-rec, .rec-btn')) && !(await has(parent, '꾹 누르고')), 'the parent screen offers voice recording')
  await waitText(family, '고마워', 40_000)
  const end = Date.now() + 30_000
  let found = false
  while (!found && Date.now() < end) {
    const n = await db.collection('notifications').where('recipientUid', '==', familyUid).get()
    found = n.docs.some((d) => String(d.get('type')).startsWith('reaction.'))
    if (!found) await sleep(500)
  }
  expect(found, 'no notice for the parent\'s reply')
})

await step('family 알림: only 앱 알림 is offered (no e-mail, no KakaoTalk)', async () => {
  await click(family, '뒤로', { timeout: 5000 }).catch(() => {})
  await tab(family, '알림')
  await waitText(family, '앱 알림')
  const t = await text(family)
  expect(!t.includes('이메일 요약'), '이메일 요약 is shown')
  expect(!t.includes('카카오톡 요약'), '카카오톡 요약 is shown')
})

await step('daily summary: written, announced to the family, and opens from 알림', async () => {
  // The worker makes summaries at 20:00 in the parent's time zone; ask it for
  // this evening's now instead of waiting for the clock.
  const kst = new Date(Date.now() + 9 * 3600_000)
  const evening = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 23 - 9, 30))
  const now = new Date(Math.max(Date.now(), evening.getTime()))
  const run = spawn(process.execPath, ['--input-type=module', '-e', `
    import { initializeApp } from 'firebase-admin/app'
    initializeApp({ projectId: '${PROJECT}', storageBucket: '${PROJECT}.appspot.com' })
    const { runDigests } = await import('${join(HERE, '..', 'worker', 'dist', 'handlers', 'digest.js')}')
    console.log(JSON.stringify(await runDigests(new Date(${now.getTime()}))))
    process.exit(0)
  `], { env: workerEnv, cwd: join(HERE, '..', 'worker'), stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  run.stdout.on('data', (c) => { out += c })
  run.stderr.on('data', (c) => { out += c })
  await new Promise((resolve) => run.on('exit', resolve))
  const digests = await db.collection('digests').where('patientUid', '==', patientUid).get()
  expect(digests.size >= 1, `no summary was made: ${out.slice(-300)}`)
  const d = digests.docs[0].data()
  expect(d.photoCount >= 2, `the summary counts ${d.photoCount} photos`)
  if (!REAL_LLM) expect(d.summary === FAKE_SUMMARY, `unexpected summary text: ${d.summary}`)
  expect(JSON.stringify(d.delivered).includes('inapp'), 'the family was not told in the app')
  await waitText(family, '요약이 도착했어요', 30_000)
  await click(family, '요약이 도착했어요', { selector: 'button, a, li, .ntf-row' })
  await waitText(family, REAL_LLM ? '사진' : FAKE_SUMMARY, 30_000)
  return `${d.photoCount} photos`
})

await step('family 설정: reply and summary settings are there; voice and plans are not', async () => {
  await family.goto(SITE, { waitUntil: 'load' })
  await family.waitForSelector('nav.tabbar', { timeout: 30_000 })
  await tab(family, '설정')
  await waitText(family, '글로 답장')
  const t = await text(family)
  expect(t.includes(PARENT), 'these are not the parent\'s settings')
  expect(t.includes('하루 요약'), 'no 하루 요약 section')
  expect(t.includes('짧은 답장'), 'no 짧은 답장 option')
  expect(!t.includes('음성 답장'), '음성 답장 is shown')
  expect(!t.includes('요금제'), '요금제 is shown')
})

await step('parent: the app opens with no connection', async () => {
  await parent.setOfflineMode(true)
  try {
    await parent.reload({ waitUntil: 'load' }).catch(() => {})
    await parent.waitForSelector('input[type=file]', { timeout: 20_000 })
    // Long enough for "no answer from the server" to be mistaken for anything.
    await sleep(4000)
    const t = await text(parent)
    expect(!t.includes('연결이 해제되었어요'), 'the phone says the family unlinked it')
    expect(t.includes('사진 찍기'), 'no 사진 찍기 button offline')
    expect(t.includes(`${PARENT}님`), `the greeting lost the parent's name: ${t.split('\n')[1]}`)
  } finally {
    await parent.setOfflineMode(false)
  }
}, { skip: (await parent.evaluate(() => !!navigator.serviceWorker?.controller).catch(() => false)) ? undefined : 'this build keeps no copy on the phone (before the faster-opening change)' })

await step('a slow connection never replaces someone\'s own settings with defaults', async () => {
  // A second person, using the app for themselves.
  const me = { name: '지은', email: 'jieun@example.com' }
  const { page: self, uid } = await signedInFamilyPage(me)
  pages = { ...pages, self }
  await self.goto(SITE, { waitUntil: 'load' })
  await self.waitForSelector('nav.tabbar', { timeout: 30_000 })
  const ref = db.doc(`users/${uid}`)
  for (let i = 0; i < 40 && !(await ref.get()).exists; i++) await sleep(500)
  expect((await ref.get()).exists, 'the account never got its settings doc')
  await ref.set({ patientName: '지은 본인', bigText: false }, { merge: true })
  await sleep(1000)

  // Open the app again while the database can't be reached for a while.
  let unreachable = true
  await self.setRequestInterception(true)
  self.on('request', (req) => {
    if (unreachable && req.url().includes(':8080')) req.abort('connectionfailed').catch(() => {})
    else req.continue().catch(() => {})
  })
  await self.reload({ waitUntil: 'load' })
  await sleep(15_000)
  unreachable = false
  await sleep(12_000)
  const after = (await ref.get()).data()
  expect(after?.patientName === '지은 본인' && after?.bigText === false, `settings were replaced: ${JSON.stringify({ patientName: after?.patientName, bigText: after?.bigText })}`)
})

await finish()
