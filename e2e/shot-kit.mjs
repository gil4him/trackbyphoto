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
  // Play store screenshots: the longest side may be at most 2x the shortest.
  play:    { width: 360, height: 720, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  // Store listing (shots.mjs): App Store 6.9" (1320×2868) and a 9:16 Android phone (1080×1920).
  iphone69:   { width: 440, height: 956, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  android916: { width: 360, height: 640, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  // The UI QA device matrix (docs/DAYLIE_V3_UI_FIX.md §Q.2).
  se:     { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  s24:    { width: 360, height: 780, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  i15:    { width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  pixel8: { width: 412, height: 915, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  promax: { width: 430, height: 932, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  // Smaller iPhones, for layout checks: iPhone 15/16 and iPhone SE.
  'iphone-15': { width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  'iphone-se': { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  // Display Zoom on a small iPhone (and the iPhone SE 1st gen).
  'iphone-zoom': { width: 320, height: 568, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
}
/** §Q.2, in order: name → device, text scale, the parent's 큰 글자 setting. */
export const QA_MATRIX = [
  { id: '375', device: 'se' },
  { id: '360', device: 's24' },
  { id: '393', device: 'i15' },
  { id: '393-L', device: 'i15', textScale: 1.3 },
  { id: '412', device: 'pixel8' },
  { id: '430', device: 'promax' },
  { id: '393-big', device: 'i15', bigText: true },
]
export const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  // Play-ratio shots keep the iPhone UA: the pairing link flow on an Android UA
  // detours through the add-to-home-screen page before the consent screen.
  play: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphone69: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  // Same reason as play: the store pictures are of the app's own screens.
  android916: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
}
UA['iphone-15'] = UA['iphone-se'] = UA['iphone-zoom'] = UA.iphone

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
export const FAKE_CAMERA_ARGS = [
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  // UI_CAMERA_FILE=<.mjpeg or .y4m>: the viewfinder shows that clip instead
  // of Chromium's green test pattern (store screenshots).
  ...(process.env.UI_CAMERA_FILE ? [`--use-file-for-fake-video-capture=${process.env.UI_CAMERA_FILE}`] : []),
]

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
  await p.setUserAgent(UA[device] ?? UA.iphone)
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

/**
 * Every piece of text `factor` bigger, the way an Android WebView follows the
 * system font size (and iOS Larger Text, where the app follows it). Each
 * element gets its own computed size times the factor, so nothing compounds.
 * Run once the screen is final, right before the picture.
 */
export const textScale = (p, factor) => p.evaluate((f) => {
  const els = [...document.querySelectorAll('body *')]
  const sizes = els.map((e) => parseFloat(getComputedStyle(e).fontSize))
  els.forEach((e, i) => { if (sizes[i]) e.style.fontSize = `${sizes[i] * f}px` })
}, factor)

/**
 * The §Q.1 checks a script can make: horizontal scroll, text clipped by a
 * box that neither ellipsises nor clamps it, text under the minimum size,
 * tap targets under the minimum, anything past the right edge, and content
 * that ends under the fixed tab bar. Returns one line per finding.
 */
export const audit = (p, { minFont = 15, minTap = 48, smallOk = 'nav.tabbar' } = {}) => p.evaluate((o) => {
  const out = []
  const de = document.documentElement
  const W = de.clientWidth
  if (de.scrollWidth > W + 1) out.push(`horizontal scroll: page ${de.scrollWidth} > ${W}`)
  const name = (e) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')
  const label = (e) => `“${(e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 18)}”`
  const inScroller = (e) => { for (let a = e.parentElement; a; a = a.parentElement) { const ox = getComputedStyle(a).overflowX; if (ox === 'auto' || ox === 'scroll') return true } return false }
  const fixed = (e) => { for (let a = e; a; a = a.parentElement) if (getComputedStyle(a).position === 'fixed') return true; return false }
  let lowest = 0
  for (const e of de.querySelectorAll('body *')) {
    const s = getComputedStyle(e)
    const r = e.getBoundingClientRect()
    if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'none') continue
    if (e.closest('svg')) continue // drawings: their text is part of the picture, not UI text
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    // What the reader sees (text, pictures, controls) — not the boxes around it,
    // which reach under the fixed bar by design.
    if (!fixed(e) && (own || e.matches('img, svg, button, input, textarea, select'))) lowest = Math.max(lowest, r.bottom + window.scrollY)
    if (own) {
      const fs = parseFloat(s.fontSize)
      if (fs < o.minFont - 0.01 && !e.closest(o.smallOk)) out.push(`small text ${fs}px: ${name(e)} ${label(e)}`)
      const hides = [s.overflow, s.overflowX, s.overflowY].includes('hidden')
      const clamps = (s.webkitLineClamp && s.webkitLineClamp !== 'none') || s.textOverflow === 'ellipsis'
      if (hides && !clamps && (e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2)) out.push(`clipped: ${name(e)} ${label(e)}`)
    }
    if (e.matches('button, a[href], [role=button]') && (r.width < o.minTap - 0.5 || r.height < o.minTap - 0.5)) out.push(`tap ${Math.round(r.width)}×${Math.round(r.height)}: ${name(e)} ${label(e)}`)
    if (r.right > W + 1 && !inScroller(e) && !fixed(e)) out.push(`past the right edge (${Math.round(r.right)} > ${W}): ${name(e)}`)
  }
  const bar = document.querySelector('nav.tabbar')
  if (bar) {
    const pageEnd = Math.max(de.scrollHeight, lowest)
    const barTop = pageEnd - (window.innerHeight - bar.getBoundingClientRect().top)
    if (lowest > barTop + 1) out.push(`content under the tab bar by ${Math.round(lowest - barTop)}px`)
  }
  return out
}, { minFont, minTap, smallOk })
