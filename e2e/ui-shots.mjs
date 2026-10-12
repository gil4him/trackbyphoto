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
import { getFirestore } from 'firebase-admin/firestore'
import { serveSite } from './servers.mjs'
import { seedDemoFamily, seedTodayMemos } from './demo-seed.mjs'
import { click, familyAccount, launchBrowser, openPage, settle, tab, waitText } from './shot-kit.mjs'

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
