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
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { serveFakeModel, serveSite } from './servers.mjs'
import { seedDemoFamily, seedSecondParent, seedTodayMemos } from './demo-seed.mjs'
import { ADMIN_QA_MATRIX, audit, click, familyAccount, launchBrowser, openPage, settle, sleep, textScale, waitText } from './shot-kit.mjs'

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
  // 오늘 waits for the worker's numbers (no skeleton left).
  { id: 'today', search: '', ready: '북극성 지표', settled: '.hq-today:not(:has(.hq-skel)):not(:has(.hq-err))' },
  { id: 'today-30', search: '', ready: '북극성 지표', settled: '.hq-today:not(:has(.hq-skel)):not(:has(.hq-err))', press: '30일' },
  // 해결됨 on the first item: saved, gone from the list, and still gone after a reload (one viewport).
  { id: 'inbox-resolved', search: '?tab=inbox', ready: '할 일은 이렇게 골라요', settled: '.hq-inbox-view .hq-ibx:not(:has(.hq-skel))', press: '해결됨', reload: true, only: '1440' },
  // D10: 안부 알림 보내기 on the quiet 할머니 — the line as the family reads it, then sent.
  { id: 'inbox-checkin', search: '?tab=inbox', ready: '할 일은 이렇게 골라요', settled: '.hq-inbox-view .hq-ibx:not(:has(.hq-skel))', only: ['1440', '393'],
    act: async (p) => { await click(p, '안부 알림 보내기'); await p.waitForSelector('.hq-quote'); await sleep(400) } },
  { id: 'inbox-checkin-sent', search: '?tab=inbox', ready: '할 일은 이렇게 골라요', settled: '.hq-inbox-view .hq-ibx:not(:has(.hq-skel))', only: '1440',
    act: async (p) => {
      await click(p, '안부 알림 보내기'); await p.waitForSelector('.hq-quote')
      await click(p, '보내기', '.hq-ask button')
      await waitText(p, '에게 보냈어요', 30_000)
      const notes = await getFirestore().collection('notifications').where('type', '==', 'checkin.quiet').get()
      const log = await getFirestore().collection('admin_log').where('action', '==', 'checkin.send').get()
      console.log('  check-in notices:', notes.docs.map((d) => `${d.get('recipientUid').slice(0, 6)}… “${d.get('message')}”`).join(' | '), '· admin_log rows:', log.size)
    } },
  { id: 'inbox', search: '?tab=inbox', ready: '할 일은 이렇게 골라요', settled: '.hq-inbox-view .hq-ibx:not(:has(.hq-skel))' },
  { id: 'growth', search: '?tab=growth', ready: '한 가족이 들어와', settled: '.hq-growth:not(:has(.hq-skel)):not(:has(.hq-err))' },
  { id: 'families-parent', search: '?tab=families&kind=parent', ready: '엄마', settled: '.hq-families .hq-tbl' },
  { id: 'families-unpaired', search: '?tab=families&kind=parent&f=unpaired', ready: '엄마', settled: '.hq-families .hq-tbl' },
  { id: 'families-child', search: '?tab=families&kind=child', ready: KID.email },
  { id: 'revenue', search: '?tab=revenue', ready: '가정으로 계산해 보기', settled: '.hq-revenue:not(:has(.hq-skel)):not(:has(.hq-err))' },
  // A new price, saved, and still there after a reload (one viewport).
  { id: 'revenue-saved', search: '?tab=revenue', ready: '가정으로 계산해 보기', settled: '.hq-revenue:not(:has(.hq-skel))', only: '1440',
    act: async (p) => {
      const input = await p.$('input[aria-label="Plus 유료 가족 수"]')
      await input.click({ clickCount: 3 }); await input.type('12')
      await click(p, '가정 저장'); await waitText(p, '가정을 저장했어요', 15_000)
      await p.reload({ waitUntil: 'load' }); await p.waitForSelector('.hq-revenue:not(:has(.hq-skel))', { timeout: 60_000 })
      console.log('  Plus families after reload:', await p.$eval('input[aria-label="Plus 유료 가족 수"]', (e) => e.value))
    } },
  { id: 'costs', search: '?tab=costs', ready: '고정 비용', settled: '.hq-costs:not(:has(.hq-skel))' },
  // Mac mini 전기 entered, saved, and still there after a reload (one viewport).
  { id: 'costs-saved', search: '?tab=costs', ready: '고정 비용', settled: '.hq-costs:not(:has(.hq-skel))', only: '1440',
    act: async (p) => {
      await p.evaluate(() => [...document.querySelectorAll('.hq-costs .hq-card')].find((c) => c.textContent.includes('고정 비용')).querySelector('.hq-link').click())
      const input = await p.waitForSelector('.hq-form label:nth-of-type(3) input')
      await input.click({ clickCount: 3 }); await input.type('6000')
      await p.evaluate(() => [...document.querySelectorAll('.hq-form .hq-btn.pri')].at(-1).click())
      await waitText(p, '고정 비용을 저장했어요', 15_000)
      await p.reload({ waitUntil: 'load' }); await p.waitForSelector('.hq-costs:not(:has(.hq-skel))', { timeout: 60_000 })
      console.log('  Mac mini line after reload:', await p.evaluate(() => [...document.querySelectorAll('.hq-rows > div')].find((d) => d.textContent.includes('Mac mini'))?.textContent))
    } },
  { id: 'system', search: '?tab=system', ready: '최근 60분 신호', settled: '.hq-system .hq-beats' },
  { id: 'flags', search: '?tab=flags', ready: '최근 바꾼 기록', settled: '.hq-flags' },
  // A risky switch asks first, on the page.
  { id: 'flags-ask', search: '?tab=flags', ready: '최근 바꾼 기록', settled: '.hq-flags', only: ['1440', '393'],
    act: async (p) => { await p.click('button[role="switch"][aria-label="보관 기간 정리"]'); await p.waitForSelector('.hq-ask'); await sleep(600) } },
  // A plain switch: the plans doc changes and the log shows it (one viewport).
  { id: 'flags-switched', search: '?tab=flags', ready: '최근 바꾼 기록', settled: '.hq-flags', only: '1440',
    act: async (p) => {
      await p.click('button[role="switch"][aria-label="하루 요약"]')
      await waitText(p, '하루 요약 켰어요', 30_000)
      await waitText(p, '하루 요약 켬', 30_000)
      const flags = (await getFirestore().doc('admin_config/plans').get()).get('flags')
      const log = await getFirestore().collection('admin_log').where('action', '==', 'flag.set').get()
      console.log('  plans.flags.digest:', flags.digest, '· admin_log flag.set rows:', log.size)
    } },
  { id: 'ai', search: '?tab=ai', ready: 'AI' },
  // An old link lands on its new view.
  { id: 'old-parents-link', search: '?tab=parents', ready: '엄마', expectUrl: '/admin?tab=families&kind=parent' },
  // A row opens the person, as before.
  { id: 'families-open', search: '?tab=families&kind=parent', ready: '엄마', settled: '.hq-families .hq-tbl', press: '엄마 열기', pressSel: 'tr[aria-label]', expectUrlStart: '/admin?tab=families&kind=parent&uid=', only: '1440' },
  // Last: the worker stops. Each view must say the server is not answering.
  { id: 'today-down', search: '', ready: '북극성 지표', settled: '.hq-today .hq-err', down: true, only: ['1440', '393'] },
  { id: 'inbox-down', search: '?tab=inbox', ready: '할 일은 이렇게 골라요', settled: '.hq-inbox-view .hq-err', down: true, only: '1440' },
  { id: 'growth-down', search: '?tab=growth', ready: '한 가족이 들어와', settled: '.hq-growth .hq-err', down: true, only: '1440' },
  { id: 'revenue-down', search: '?tab=revenue', ready: '가정으로 계산해 보기', settled: '.hq-revenue .hq-err', down: true, only: '1440' },
  { id: 'system-down', search: '?tab=system', ready: '시스템', settled: '.hq-system .hq-err', down: true, only: '1440' },
]

await mkdir(OUT, { recursive: true })
initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` })
// The plans table as the owner set it (CLAUDE.md, 2026-10-22): Free, Plus, Family.
await getFirestore().doc('admin_config/plans').set({
  // payments on (D12): 매출 shows the store purchases on file.
  flags: { reactions: true, familyPhotos: true, payments: true, ceoMorningPush: true },
  free: { familyMembers: 3 }, plus: { familyMembers: 6, priceLabel: '₩4,400/월' }, family: { familyMembers: 10, priceLabel: '₩7,700/월' },
})

const kid = await familyAccount(KID)
const { momUid } = await seedDemoFamily({ kidUid: kid.localId, kidName: KID.name })
await seedTodayMemos({ momUid, kidUid: kid.localId, kidName: KID.name, count: 5 })
// A second parent who sent photos yesterday, so the story has a yesterday.
await seedSecondParent({ kidUid: kid.localId, kidName: KID.name, name: '아빠', yesterday: 3 })
const admin = await familyAccount(ADMIN)

// 할 일 cases (D2), all on the emulator: a parent who went quiet after a
// week of daily photos, a parent with only a viewer (no 대표 가족), a blocked
// family account, and a month over its Firebase budget.
{
  const db = getFirestore()
  const day = 86_400_000
  const parent = async (uid, name, role, sinceDays = 0) => {
    await getAuth().createUser({ uid })
    await db.doc(`users/${uid}`).set({ accountType: 'managed', patientName: name, createdBy: kid.localId })
    await db.doc(`memberships/${uid}_${kid.localId}`).set({ patientUid: uid, caregiverUid: kid.localId, caregiverName: KID.name, role, status: 'active', createdAt: Timestamp.fromMillis(Date.now() - sinceDays * day), acceptedAt: Timestamp.fromMillis(Date.now() - sinceDays * day), revokedAt: null })
  }
  // Looked after for 12 days, so the 90-day chart has some history.
  await parent('granQuiet0000000000000000000', '할머니', 'guardian', 12)
  for (let d = 4; d <= 10; d++) await db.collection('memos').add({ patientUid: 'granQuiet0000000000000000000', takenAt: Timestamp.fromMillis(Date.now() - d * day), createdAt: Timestamp.fromMillis(Date.now() - d * day), status: 'ready', memo: '산책', place: '공원' })
  await parent('grandpaViewer000000000000000', '할아버지', 'viewer')
  // 할머니 is on Plus since this week, bought in the store by the demo family
  // member (매출: plan mix, an upgrade, a store purchase on file). 할아버지 is
  // on Family through another payer whose card the store is retrying. With no
  // RevenueCat key in the e2e worker both rows read 확인 전.
  await db.doc('users/granQuiet0000000000000000000').set({ plan: { tier: 'plus', status: 'active', since: Timestamp.now(), changedBy: kid.localId, payment: { provider: 'revenuecat', reference: 'daylie_plus_monthly', payerUid: kid.localId, expiresAt: Timestamp.fromMillis(Date.now() + 27 * day) } } }, { merge: true })
  await db.doc(`planPayments/${kid.localId}`).set({ patientUid: 'granQuiet0000000000000000000', tier: 'plus', productId: 'daylie_plus_monthly', expiresAt: Timestamp.fromMillis(Date.now() + 27 * day), updatedAt: Timestamp.now() })
  await db.collection('auditLogs').add({ patientUid: 'granQuiet0000000000000000000', actorUid: kid.localId, action: 'plan.change', details: { from: 'free', to: 'plus', provider: 'revenuecat', source: 'sheet' }, timestamp: Timestamp.now() })
  await db.doc('users/grandpaViewer000000000000000').set({ plan: { tier: 'family', status: 'grace', since: Timestamp.fromMillis(Date.now() - 40 * day), payment: { provider: 'revenuecat', reference: 'daylie_family_monthly:monthly', payerUid: 'arrivedIos000000000000000000', expiresAt: Timestamp.fromMillis(Date.now() + 3 * day) } } }, { merge: true })
  await db.doc('planPayments/arrivedIos000000000000000000').set({ patientUid: 'grandpaViewer000000000000000', tier: 'family', productId: 'daylie_family_monthly:monthly', expiresAt: Timestamp.fromMillis(Date.now() + 3 * day), updatedAt: Timestamp.fromMillis(Date.now() - 40 * day) })
  // One subscription the poll already ended this month (a refund).
  await db.collection('auditLogs').add({ patientUid: momUid, actorUid: 'gonePayer0000000000000000000', action: 'plan.change', details: { from: 'plus', to: 'free', provider: 'revenuecat', source: 'subscription', refunded: true }, timestamp: Timestamp.fromMillis(Date.now() - 2 * day) })
  await getAuth().createUser({ uid: 'blockedKid00000000000000000', email: 'blocked@example.com', displayName: '민수', disabled: true })
  // 어디서 들어왔나 (D11): the demo family came in on Android; three more recent
  // family accounts from the App Store, the tester link and a web search. 민수
  // above has no stamp (기록 전).
  await db.doc(`users/${kid.localId}`).set({ arrival: { platform: 'android', ref: null, at: Timestamp.now() } }, { merge: true })
  const arrived = async (uid, email, name, platform, ref) => {
    await getAuth().createUser({ uid, email, displayName: name })
    await db.doc(`users/${uid}`).set({ patientName: name, arrival: { platform, ref, at: Timestamp.now() }, lastModifiedBy: uid })
  }
  await arrived('arrivedIos000000000000000000', 'ios@example.com', '지우', 'ios', null)
  await arrived('arrivedTester000000000000000', 'tester@example.com', '하늘', 'web', 'tester')
  await arrived('arrivedWeb000000000000000000', 'web@example.com', '서준', 'web', 'naver.com')
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date())
  await db.doc('admin_config/dashboard').set({ costs: { [month]: { firebaseUSD: 11.4, budgetUSD: 5, storageUSD: 8.21, firestoreUSD: 2.64, hostingUSD: 0.31, otherUSD: 0.24 } } }, { merge: true })
  // 시스템: one photo today whose memo failed.
  await db.collection('memos').add({ patientUid: momUid, takenAt: Timestamp.now(), createdAt: Timestamp.now(), status: 'error' })
  // 비용: two days of cloud AI memos this month (the worker's counters, by UTC day).
  const today = new Date().toISOString().slice(0, 10)
  await db.doc(`admin_daily/${today}`).set({ date: today, memos: 4, geminiCalls: 4, geminiUSD: 0.0123 }, { merge: true })
}

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
let workerStopped = false
try {
  for (const v of VIEWS) {
    if (only && !only.has(v.id)) continue
    if (v.down && !workerStopped) { worker.kill('SIGTERM'); workerStopped = true; console.log('  (worker stopped)') }
    for (const q of ADMIN_QA_MATRIX.filter((x) => !v.only || [].concat(v.only).includes(x.id))) {
      const p = await openPage(browser, { device: q.device, acct: admin, kid: ADMIN })
      await p.goto(`${SITE}/admin${v.search}`, { waitUntil: 'load' })
      await waitText(p, v.ready, 45_000)
      if (v.settled) await p.waitForSelector(v.settled, { timeout: v.down ? 150_000 : 90_000 }).catch(async (err) => {
        console.log('  worker log:', log.split('\n').filter((l) => /adminInbox|error|ERROR|WARN/.test(l)).slice(-12).join('\n'))
        console.log('  page says:', (await p.evaluate(() => document.body.innerText)).slice(0, 2000).replace(/\n+/g, ' | '))
        throw err
      })
      if (v.press) { await click(p, v.press, v.pressSel); await sleep(1500) }
      if (v.act) await v.act(p)
      if (v.reload) {
        const before = await p.evaluate(() => document.querySelector('.hq-vhead h1')?.textContent)
        await waitText(p, '해결됨으로 옮겼어요', 15_000)
        await p.reload({ waitUntil: 'load' })
        await p.waitForSelector(v.settled, { timeout: 90_000 })
        const after = await p.evaluate(() => document.querySelector('.hq-vhead h1')?.textContent)
        console.log(`  resolved: ${before} → after reload: ${after}`)
      }
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
      if (v.expectUrlStart && !where.startsWith(v.expectUrlStart)) findings.push(`address ${where}, expected ${v.expectUrlStart}…`)
      const shell = findings.filter((f) => /hq|address|horizontal scroll/.test(f))
      if (shell.length) failed++
      report.push({ view: v.id, viewport: q.id, shell, inside: findings.filter((f) => !shell.includes(f)) })
      // Saved as it goes, so a run that dies midway keeps what it found.
      await writeFile(join(OUT, process.env.ADMIN_REPORT || 'report.json'), JSON.stringify(report, null, 1))
      console.log(`  ${name}.png  shell:${shell.length ? ' ' + shell.join(' | ') : ' OK'}  inside: ${findings.length - shell.length}`)
      await p.browserContext().close()
    }
  }
} finally {
  // How long the worker took for each 운영실 request (and any failure).
  console.log(log.split('\n').filter((l) => /"type":"admin|handler threw|ERROR/.test(l)).map((l) => l.slice(0, 260)).join('\n'))
  await writeFile(join(OUT, process.env.ADMIN_REPORT || 'report.json'), JSON.stringify(report, null, 1))
  await browser.close()
  site.close(); model.close(); worker.kill('SIGTERM')
}
console.log(`pictures in ${OUT}`)
process.exit(failed ? 1 : 0)
