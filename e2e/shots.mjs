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
import { serveSite } from './servers.mjs'
import { seedDemoFamily } from './demo-seed.mjs'
import { DEVICES, click, familyAccount, launchBrowser, openPage, settle, sleep, tab, waitText } from './shot-kit.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TMP = join(HERE, '.tmp')
const OUT = join(TMP, 'store-shots')
const SITE_PORT = 5221
const SITE = `http://localhost:${SITE_PORT}`
const PROJECT = 'demo-trackbyphoto'
const KID = { name: '지민', email: 'jimin@example.com' }

const only = process.env.SHOTS_ONLY ? new Set(process.env.SHOTS_ONLY.split(',')) : null

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })
initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` })
const db = getFirestore()
await db.doc('admin_config/plans').set({
  flags: { reactions: true, familyPhotos: true, trailMap: true, pushFamily: true, digest: false, planSheet: false, voiceReplies: false, retentionJob: false, usageCaps: false, cloudMemo: false },
})

const acct = await familyAccount(KID)
const { momUid, memoIds } = await seedDemoFamily({ kidUid: acct.localId, kidName: KID.name })
const site = await serveSite(join(TMP, 'shots-site'), SITE_PORT)
const browser = await launchBrowser(process.env.SHOTS_HEADFUL === '1')
const page = (device, opts = {}) => openPage(browser, { device, acct, kid: KID, ...opts })

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
