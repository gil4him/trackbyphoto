// Fills the store reviewers' demo account on the simple project
// (daylie-simple-4df13) with a linked parent and sample photos.
//
//   cd e2e && GOOGLE_APPLICATION_CREDENTIALS=~/daylie-secrets/simple/daylie-simple-sa.json \
//     node seed-review-demo.mjs review.oneulharu@gmail.com 지민
//
// The account must already exist (Firebase console → Authentication). Runs
// once: it stops if the account already looks after someone.

import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { seedDemoFamily } from './demo-seed.mjs'

const PROJECT = 'daylie-simple-4df13'
const [email, kidName = '지민'] = process.argv.slice(2)
if (!email) {
  console.error('usage: node seed-review-demo.mjs <demo account email> [display name]')
  process.exit(1)
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT, storageBucket: `${PROJECT}.firebasestorage.app` })
try {
  const kid = await getAuth().getUserByEmail(email)
  const out = await seedDemoFamily({ kidUid: kid.uid, kidName })
  console.log(`Seeded ${email} (${kid.uid}) on ${PROJECT}: parent 엄마 ${out.momUid}, ${out.memoIds.length} photos, 1 family photo.`)
} catch (err) {
  console.error(String(err?.message ?? err))
  process.exit(1)
}
