// What the screenshot scripts share (shots.mjs for the store, ui-shots.mjs for
// design review): phone viewports, a family account in the Auth emulator, a
// signed-in page, and small helpers to tap and wait.

import puppeteer from 'puppeteer-core'

export const API_KEY = 'demo-key'
export const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// App Store 6.7" (1290×2796) and a common Android phone (1080×2400).
export const DEVICES = {
  iphone: { width: 430, height: 932, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  android: { width: 360, height: 800, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
}
export const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A family account in the Auth emulator, as run.mjs makes one. */
export async function familyAccount(kid) {
  const res = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: `g-${kid.email}`, email: kid.email, name: kid.name, email_verified: true }))}&providerId=google.com`,
      requestUri: 'http://localhost', returnIdpCredential: true, returnSecureToken: true,
    }),
  })
  const acct = await res.json()
  if (!acct.localId) throw new Error(`no family account: ${JSON.stringify(acct).slice(0, 200)}`)
  return acct
}

export function launchBrowser(headful = false, extraArgs = []) {
  return puppeteer.launch({ executablePath: CHROME, headless: !headful, args: ['--no-first-run', '--hide-scrollbars', ...extraArgs] })
}

/** A fake camera for the parent's viewfinder (no permission prompt). */
export const FAKE_CAMERA_ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']

/** The SDK's stored session for a parent's linked phone (a custom token with
 *  the elder claim, exchanged at the Auth emulator). */
export async function elderSession(customToken, uid) {
  const res = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  })
  const t = await res.json()
  if (!t.idToken) throw new Error(`no elder session: ${JSON.stringify(t).slice(0, 200)}`)
  return {
    uid, email: null, emailVerified: false, displayName: null, isAnonymous: false, providerData: [],
    stsTokenManager: { refreshToken: t.refreshToken, accessToken: t.idToken, expirationTime: Date.now() + 3500_000 },
    createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey: API_KEY, appName: '[DEFAULT]',
  }
}

/** A fresh page on one device; signed in as `acct` (with the SDK's session
 *  put where it keeps it) unless signedIn is false. */
export async function openPage(browser, { device, acct, kid, signedIn = true, activePatient, extraStorage = [], session = null }) {
  const ctx = await browser.createBrowserContext()
  const p = await ctx.newPage()
  await p.setViewport(DEVICES[device])
  await p.setUserAgent(UA[device])
  await p.emulateTimezone('Asia/Seoul')
  p.on('pageerror', (e) => console.log(`  [${device} page error]`, String(e).split('\n')[0]))
  const entries = [...extraStorage]
  if (session) {
    entries.push([`firebase:authUser:${API_KEY}:[DEFAULT]`, JSON.stringify(session)])
  } else if (signedIn) {
    const session = {
      uid: acct.localId, email: kid.email, emailVerified: true, displayName: kid.name, isAnonymous: false,
      providerData: [{ providerId: 'google.com', uid: `g-${kid.email}`, displayName: kid.name, email: kid.email, phoneNumber: null, photoURL: null }],
      stsTokenManager: { refreshToken: acct.refreshToken, accessToken: acct.idToken, expirationTime: Date.now() + 3500_000 },
      createdAt: String(Date.now()), lastLoginAt: String(Date.now()), apiKey: API_KEY, appName: '[DEFAULT]',
    }
    entries.push([`firebase:authUser:${API_KEY}:[DEFAULT]`, JSON.stringify(session)])
    if (activePatient) entries.push([`tbp.activePatient.${acct.localId}`, activePatient])
  }
  if (entries.length) {
    await p.evaluateOnNewDocument((kv) => {
      for (const [k, v] of kv) if (!localStorage.getItem(k)) localStorage.setItem(k, v)
    }, entries)
  }
  return p
}

export const click = async (p, want, selector = 'button, a, [role=button]') => {
  const h = await p.waitForFunction((sel, w) => [...document.querySelectorAll(sel)].find((e) =>
    (e.getAttribute('aria-label') || '').includes(w) || e.textContent.replace(/\s+/g, ' ').includes(w)), { timeout: 20_000 }, selector, want)
  await h.asElement().click()
}
export const tab = async (p, label) => {
  await p.waitForSelector('nav.tabbar')
  await sleep(500)
  await p.evaluate((l) => [...document.querySelectorAll('nav.tabbar button.tab')].find((b) => b.getAttribute('aria-label') === l).click(), label)
}
export const waitText = (p, s, timeout = 30_000) => p.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, s)
/** Waits for every <img> on screen to finish loading, then a moment more. */
export const settle = async (p) => {
  await p.waitForFunction(() => [...document.images].every((i) => i.complete), { timeout: 20_000 }).catch(() => {})
  await sleep(1200)
}
