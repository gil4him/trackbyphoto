// Store screenshots of 오늘하루 (the simple edition), taken from the website
// on the emulators with the demo family from demo-seed.mjs. Nothing touches
// a real project. Run by shots.sh; pictures land in e2e/.tmp/store-shots.
//
// SHOTS_ONLY=<name,...> takes only those screens (see SCREENS below).

import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import puppeteer from 'puppeteer-core'
import { serveSite } from './servers.mjs'
import { seedDemoFamily } from './demo-seed.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TMP = join(HERE, '.tmp')
const OUT = join(TMP, 'store-shots')
const SITE_PORT = 5221
const SITE = `http://localhost:${SITE_PORT}`
const PROJECT = 'demo-trackbyphoto'
const API_KEY = 'demo-key'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const KID = { name: '지민', email: 'jimin@example.com' }

// App Store 6.7" (1290×2796) and a common Android phone (1080×2400).
const DEVICES = {
  iphone: { width: 430, height: 932, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  android: { width: 360, height: 800, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
}
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const only = process.env.SHOTS_ONLY ? new Set(process.env.SHOTS_ONLY.split(',')) : null

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })
initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` })
const db = getFirestore()
await db.doc('admin_config/plans').set({
  flags: { reactions: true, familyPhotos: true, trailMap: true, pushFamily: true, digest: false, planSheet: false, voiceReplies: false, retentionJob: false, usageCaps: false, cloudMemo: false },
})

/** A family account in the Auth emulator, as run.mjs makes one. */
async function familyAccount() {
  const res = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: `g-${KID.email}`, email: KID.email, name: KID.name, email_verified: true }))}&providerId=google.com`,
      requestUri: 'http://localhost', returnIdpCredential: true, returnSecureToken: true,
    }),
  })
  const acct = await res.json()
  if (!acct.localId) throw new Error(`no family account: ${JSON.stringify(acct).slice(0, 200)}`)
  return acct
}

const acct = await familyAccount()
const { momUid, memoIds } = await seedDemoFamily({ kidUid: acct.localId, kidName: KID.name })
const site = await serveSite(join(TMP, 'shots-site'), SITE_PORT)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: process.env.SHOTS_HEADFUL !== '1', args: ['--no-first-run', '--hide-scrollbars'] })

async function page(device, { signedIn = true, activePatient } = {}) {
  const ctx = await browser.createBrowserContext()
  const p = await ctx.newPage()
  await p.setViewport(DEVICES[device])
  await p.setUserAgent(UA[device])
  await p.emulateTimezone('Asia/Seoul')
  p.on('pageerror', (e) => console.log(`  [${device} page error]`, String(e).split('\n')[0]))
  if (signedIn) {
    const session = {
      uid: acct.localId, email: KID.email, emailVerified: true, displayName: KID.name, isAnonymous: false,
      providerData: [{ providerId: 'google.com', uid: `g-${KID.email}`, displayName: KID.name, email: KID.email, phoneNumber: null, photoURL: null }],
      stsTokenManager: { refreshToken: acct.refreshToken, accessToken: acct.idToken, expirationTime: Date.now() + 3500_000 },
      createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey: API_KEY, appName: '[DEFAULT]',
    }
    await p.evaluateOnNewDocument((entries) => {
      for (const [k, v] of entries) if (!localStorage.getItem(k)) localStorage.setItem(k, v)
    }, [
      [`firebase:authUser:${API_KEY}:[DEFAULT]`, JSON.stringify(session)],
      ...(activePatient ? [[`tbp.activePatient.${acct.localId}`, activePatient]] : []),
    ])
  }
  return p
}

const click = async (p, want, selector = 'button, a, [role=button]') => {
  const h = await p.waitForFunction((sel, w) => [...document.querySelectorAll(sel)].find((e) =>
    (e.getAttribute('aria-label') || '').includes(w) || e.textContent.replace(/\s+/g, ' ').includes(w)), { timeout: 20_000 }, selector, want)
  await h.asElement().click()
}
const tab = async (p, label) => {
  await p.waitForSelector('nav.tabbar')
  await sleep(500)
  await p.evaluate((l) => [...document.querySelectorAll('nav.tabbar button.tab')].find((b) => b.getAttribute('aria-label') === l).click(), label)
}
const waitText = (p, s, timeout = 30_000) => p.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, s)
/** Waits for every <img> on screen to finish loading, then a moment more. */
const settle = async (p) => {
  await p.waitForFunction(() => [...document.images].every((i) => i.complete), { timeout: 20_000 }).catch(() => {})
  await sleep(1200)
}

// Each screen: how to get there, from a fresh signed-in page.
const SCREENS = {
  // The parent's photos on the family phone (switched to 엄마).
  'mom-home': async (p) => {
    await p.goto(SITE, { waitUntil: 'load' })
    await waitText(p, '엄마')
    await waitText(p, '보낸 사진')
  },
  'mom-photos': async (p) => {
    await p.goto(SITE, { waitUntil: 'load' })
    await tab(p, '사진')
    await waitText(p, '노을 지는 호숫가 산책')
  },
  'mom-detail': async (p) => {
    await p.goto(SITE, { waitUntil: 'load' })
    await tab(p, '사진')
    await waitText(p, '초록 나무가 가득한 공원')
    await click(p, '초록 나무가 가득한 공원')
    await waitText(p, '산책 잘하셨어요')
  },
  'mom-trail': async (p) => {
    await p.goto(SITE, { waitUntil: 'load' })
    await tab(p, '사진')
    await click(p, '다녀온 곳')
    await sleep(4000) // map tiles
  },
}

const shot = async (p, name) => { await settle(p); await p.screenshot({ path: join(OUT, name) }); console.log('  ', name) }

try {
  for (const device of Object.keys(DEVICES)) {
    // The sign-in screen.
    if (!only || only.has('signin')) {
      const p = await page(device, { signedIn: false })
      await p.goto(SITE, { waitUntil: 'load' })
      await waitText(p, '부모님 휴대폰이에요')
      await shot(p, `${device}-signin.png`)
      await p.browserContext().close()
    }
    for (const [name, go] of Object.entries(SCREENS)) {
      if (only && !only.has(name)) continue
      const p = await page(device, { activePatient: momUid })
      try {
        await go(p)
        await shot(p, `${device}-${name}.png`)
      } catch (err) {
        console.log(`   ${device}-${name} FAILED: ${String(err.message).split('\n')[0]}`)
        await p.screenshot({ path: join(OUT, `FAIL-${device}-${name}.png`) }).catch(() => {})
      }
      await p.browserContext().close()
    }
  }
  console.log(`memos ${memoIds.length}; pictures in ${OUT}`)
} finally {
  await browser.close()
  site.close()
}
