// A family account that looks lived in: a parent ("엄마") registered and
// linked, four photos from the last few days with their place and note, a
// heart and a comment, and a photo the family sent her. Used for the store
// reviewers' demo account (seed-review-demo.mjs) and the store screenshots
// (shots.mjs, on the emulators).
//
// Every document is written finished, the way the worker leaves it — memos
// 'ready' with no needsGeocode, reactions notified, the family photo 'ready'
// — so a running worker never picks any of it up. Shapes follow
// worker/src/handlers/pairing.ts (createManagedElder), memo.ts,
// app/src/lib/reactions.ts and familyPhotos.ts.

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

const PHOTOS = join(dirname(fileURLToPath(import.meta.url)), 'demo-photos')
const H = 3600e3

// DEMO_LANG=en seeds the same family in English for the store screenshots'
// English set: Mia looks after Mom (and Dad), in Seattle. Every piece of
// text has an English twin of the same shape; `activity` keeps the Korean
// category key, which is what the app's styles and the worker use. With
// DEMO_LANG unset nothing changes — the Korean seed is the one below.
const EN = process.env.DEMO_LANG === 'en'
/** The language of everything seeded here, for the user docs' geoLang. */
export const DEMO_LANG = EN ? 'en' : 'ko'
const PARENT_NAME = EN ? 'Mom' : '엄마'
const SECOND_PARENT = EN ? 'Dad' : '아빠'
/** Where the parent lives, so the day's caption can say how far she went. */
const PARENT_HOME = EN
  ? { lat: 47.6686, lng: -122.3832, label: 'Ballard' }
  : { lat: 37.5096, lng: 127.104, label: '잠실동' }
/** The word the family left on the newest photo (seedTodayMemos). */
const DEMO_COMMENT = EN ? 'Mom, nice walk today!' : '엄마 산책 잘하셨어요!'
const FIRST_COMMENT = EN ? 'Mom, what a nice day for a walk! 😊' : '엄마 오늘 날씨 좋았네요! 산책 잘하셨어요 😊'
const FIRST_CAPTION = EN ? "Mom, let's go to Green Lake this weekend!" : '엄마, 주말에 한강 같이 가요!'
const CAPTIONS = EN
  ? ["Dad, let's have dinner together tonight", 'A drawing from your grandchild', '', "Let's go this weekend"]
  : ['아빠, 오늘 저녁 같이 먹어요', '손주가 그린 그림이에요', '', '주말에 같이 가요']
/** The title a photo gets when no model wrote one (memoSource 'stub'). */
const STUB_MEMO = EN ? 'Took a photo' : '사진을 남겼어요'

const MEMOS_KO = [
  { day: 1, at: '15:10', file: 'photo3.jpg', lat: 37.5480, lng: 127.0745, place: '어린이대공원 · 능동, 광진구', address: '서울 광진구 능동로 216', activity: '자연', memo: '초록 나무가 가득한 공원', scene: '키 큰 나무 두 그루 사이로 넓은 잔디밭이 펼쳐져 있어요. 햇살이 따뜻한 오후예요.' },
  { day: 1, at: '18:20', file: 'photo1.jpg', lat: 37.5096, lng: 127.1040, place: '석촌호수 · 잠실동, 송파구', address: '서울 송파구 잠실로 148', activity: '산책', memo: '노을 지는 호숫가 산책', scene: '하늘이 주황빛으로 물들 무렵 호숫가 길을 걸으셨어요. 나무 사이로 해가 지고 있어요.' },
  { day: 2, at: '11:05', file: 'photo2.jpg', lat: 37.5178, lng: 127.0866, place: '한강공원 잠실지구 · 잠실동, 송파구', address: '서울 송파구 한가람로 65', activity: '휴식', memo: '한강공원에서 쉬어 가기', scene: '잔디밭 옆 산책로에서 잠시 쉬셨어요. 하늘이 맑고 바람이 시원해 보여요.' },
  { day: 3, at: '08:30', file: 'photo0.jpg', lat: 37.5207, lng: 127.1214, place: '올림픽공원 · 방이동, 송파구', address: '서울 송파구 올림픽로 424', activity: '산책', memo: '올림픽공원 아침 산책', scene: '맑은 하늘 아래 흙길을 따라 걸으셨어요. 양옆으로 나무가 서 있어요.' },
]

// The same four days in Seattle, WA.
const MEMOS_EN = [
  { day: 1, at: '15:10', file: 'photo3.jpg', lat: 47.6386, lng: -122.2960, place: 'Washington Park Arboretum · Madison Park, Seattle', address: '2300 Arboretum Dr E, Seattle, WA', activity: '자연', memo: 'Tall trees at the Arboretum', scene: 'A warm afternoon, with sunlight on the wide lawn between the trees.' },
  { day: 1, at: '18:20', file: 'photo1.jpg', lat: 47.6295, lng: -122.3600, place: 'Kerry Park · Queen Anne, Seattle', address: '211 W Highland Dr, Seattle, WA', activity: '산책', memo: 'Took a photo at Kerry Park', scene: 'The sky turned orange over the water as the sun went down.' },
  { day: 2, at: '11:05', file: 'photo2.jpg', lat: 47.6097, lng: -122.3425, place: 'Pike Place Market · Downtown, Seattle', address: '85 Pike St, Seattle, WA', activity: '휴식', memo: 'Lunch at Pike Place Market', scene: 'A clear, breezy noon, sitting a while by the market.' },
  { day: 3, at: '08:30', file: 'photo0.jpg', lat: 47.6805, lng: -122.3281, place: 'Green Lake Park · Green Lake, Seattle', address: '7201 E Green Lake Dr N, Seattle, WA', activity: '산책', memo: 'Walked around Green Lake in the morning', scene: 'A clear, cool Monday morning, starting the day with a lap around the lake.' },
]

const MEMOS = EN ? MEMOS_EN : MEMOS_KO

/** Korean time on a day before today: (1, '15:10') is yesterday 오후 3:10 KST. */
function kst(now, day, at) {
  const KST = 9 * H
  const midnight = Math.floor((now + KST) / (24 * H)) * 24 * H - KST
  const [h, m] = at.split(':').map(Number)
  return midnight - day * 24 * H + h * H + m * 60e3
}

const rand = () => Math.random().toString(36).slice(2, 8)

/** The same kind of link the worker stores in photoUrl (storageLinks.ts). */
async function upload(bucket, path, file, emulatorHost) {
  const token = randomUUID()
  await bucket.file(path).save(await readFile(join(PHOTOS, file)), {
    contentType: 'image/jpeg',
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  })
  const base = emulatorHost ? `http://${emulatorHost}` : 'https://firebasestorage.googleapis.com'
  return `${base}/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
}

/** Seeds kidUid's family. Refuses if the account already looks after someone. */
export async function seedDemoFamily({ kidUid, kidName, now = Date.now() }) {
  const db = getFirestore()
  const bucket = getStorage().bucket()
  const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST
  const ts = (ms) => Timestamp.fromMillis(Math.round(ms))

  const existing = await db.collection('memberships').where('caregiverUid', '==', kidUid).where('status', '==', 'active').get()
  if (!existing.empty) throw new Error(`${kidUid} already looks after someone (${existing.docs.map((d) => d.id).join(', ')})`)

  await db.doc(`users/${kidUid}`).set({
    patientName: kidName, recipients: [], cadence: 'daily', autoMode: true, bigText: true, retention: '90', geoLang: DEMO_LANG,
    lastModifiedBy: kidUid, lastModifiedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  const mom = (await getAuth().createUser({ displayName: PARENT_NAME })).uid
  await db.doc(`users/${mom}`).set({
    patientName: PARENT_NAME, recipients: [], cadence: 'daily', geoLang: DEMO_LANG, autoMode: true, bigText: true, retention: '90',
    accountType: 'managed', voiceEnabled: false, createdBy: kidUid, lastModifiedBy: kidUid, lastModifiedAt: FieldValue.serverTimestamp(),
  })
  const consent = (type, scope) => db.collection('consents').add({
    patientUid: mom, grantedBy: 'guardian', guardianUid: kidUid, consentTextVersion: 'simple-v1', type, scope, timestamp: FieldValue.serverTimestamp(),
  })
  const sensitive = await consent('sensitive_data', '메모 텍스트와 사진')
  const share = await consent('third_party_share', '메모 + 위치 + 사진을 가족과 공유')
  await db.doc(`memberships/${mom}_${kidUid}`).set({
    patientUid: mom, caregiverUid: kidUid, caregiverName: kidName, role: 'guardian', status: 'active', invitedBy: kidUid,
    consentId: share.id, createdAt: FieldValue.serverTimestamp(), acceptedAt: FieldValue.serverTimestamp(), revokedAt: null,
  })
  await db.collection('auditLogs').add({
    patientUid: mom, actorUid: kidUid, action: 'elder.create',
    details: { sensitiveConsentId: sensitive.id, thirdPartyConsentId: share.id, voiceConsentId: null, consentTextVersion: 'simple-v1' },
    timestamp: FieldValue.serverTimestamp(),
  })

  const memoIds = []
  for (const m of MEMOS) {
    const t = kst(now, m.day, m.at)
    const id = `${t}_${rand()}`
    const photoPath = `photos/${mom}/${id}.jpg`
    const photoUrl = await upload(bucket, photoPath, m.file, emulatorHost)
    await db.doc(`memos/${id}`).set({
      patientUid: mom, photoPath, photoUrl, takenAt: ts(t), createdAt: ts(t + 5000), tzOffsetMin: 540,
      lat: m.lat, lng: m.lng, place: m.place, address: m.address, activity: m.activity, memo: m.memo, scene: m.scene,
      status: 'ready', memoSource: 'local-llm', model: 'gemma4:e4b', notifiedAt: ts(t + 30000),
    })
    memoIds.push({ id, t })
  }

  // A heart and a comment on the newest photo, already seen by mom.
  const [newest] = memoIds
  const reaction = { memoId: newest.id, patientUid: mom, actorUid: kidUid, actorName: kidName, status: 'ready', notified: true, readByElderAt: ts(newest.t + H) }
  await db.doc(`reactions/${newest.id}_${kidUid}`).set({ ...reaction, kind: 'heart', createdAt: ts(newest.t + 20 * 60e3) })
  await db.collection('reactions').add({ ...reaction, kind: 'comment', text: FIRST_COMMENT, createdAt: ts(newest.t + 21 * 60e3) })

  // A photo sent to mom, answered with a heart.
  const ft = kst(now, 1, '20:40')
  const fid = `${ft}_${rand()}`
  const fpath = `familyPhotos/${mom}/${fid}.jpg`
  await db.doc(`familyPhotos/${fid}`).set({
    patientUid: mom, senderUid: kidUid, senderName: kidName, photoPath: fpath,
    photoUrl: await upload(bucket, fpath, 'photo2.jpg', emulatorHost),
    caption: FIRST_CAPTION, status: 'ready', createdAt: ts(ft), readyAt: ts(ft + 3000),
    seenAt: ts(ft + H), reply: { kind: 'heart', at: ts(ft + H + 60e3), notified: true },
  })

  return { momUid: mom, memoIds: memoIds.map((m) => m.id), familyPhotoId: fid }
}

/**
 * For the design-review screenshots: `count` photos the family sent the parent,
 * all unseen, the newest sent a minute ago (so the parent's phone shows the lit
 * bubble and an album with dots). Same finished shape as seedDemoFamily's.
 */
export async function seedFamilyPhotos({ momUid, kidUid, kidName, count = 3, now = Date.now() }) {
  const db = getFirestore()
  const bucket = getStorage().bucket()
  const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST
  const ts = (ms) => Timestamp.fromMillis(Math.round(ms))
  const captions = CAPTIONS
  const ids = []
  for (let i = 0; i < count; i++) {
    const t = now - 60e3 - i * 5 * H
    const fid = `${t}_${rand()}`
    const fpath = `familyPhotos/${momUid}/${fid}.jpg`
    await db.doc(`familyPhotos/${fid}`).set({
      patientUid: momUid, senderUid: kidUid, senderName: kidName, photoPath: fpath,
      photoUrl: await upload(bucket, fpath, `photo${i % 4}.jpg`, emulatorHost),
      caption: captions[i % captions.length], status: 'ready', createdAt: ts(t), readyAt: ts(t + 3000),
    })
    ids.push(fid)
  }
  return ids
}

/**
 * For the design-review screenshots (ui-shots.mjs): `count` photos taken
 * today, spread over the day, newest with a heart and a comment from the
 * family. Same finished shapes as seedDemoFamily.
 */
export async function seedTodayMemos({ momUid, kidUid, kidName, count = 9, now = Date.now() }) {
  const db = getFirestore()
  const bucket = getStorage().bucket()
  const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST
  const ts = (ms) => Timestamp.fromMillis(Math.round(ms))
  const times = ['07:40', '08:55', '10:10', '11:30', '12:45', '14:05', '15:30', '17:15', '18:40', '19:50', '20:30']
  // Home is set (석촌호수 / Ballard), so the day's caption can say how far she went.
  await db.doc(`users/${momUid}`).set({ home: PARENT_HOME }, { merge: true })
  const ids = []
  for (let i = 0; i < Math.min(count, times.length); i++) {
    const src = MEMOS[i % MEMOS.length]
    // Fixed daytime slots (even when the Korean clock has not reached them
    // yet) so the review picture is the same whenever it is taken.
    const t = kst(now, 0, times[i])
    const id = `${t}_${rand()}`
    const photoPath = `photos/${momUid}/${id}.jpg`
    const photoUrl = await upload(bucket, photoPath, src.file, emulatorHost)
    await db.doc(`memos/${id}`).set({
      patientUid: momUid, photoPath, photoUrl, takenAt: ts(t), createdAt: ts(t + 5000), tzOffsetMin: 540,
      lat: src.lat, lng: src.lng, place: src.place, address: src.address, activity: src.activity,
      memo: i % 4 === 3 ? STUB_MEMO : src.memo, scene: src.scene,
      status: 'ready', memoSource: i % 4 === 3 ? 'stub' : 'local-llm', model: 'gemma4:e4b', notifiedAt: ts(t + 30000),
    })
    ids.push({ id, t })
  }
  const newest = ids[ids.length - 1]
  if (newest) {
    const reaction = { memoId: newest.id, patientUid: momUid, actorUid: kidUid, actorName: kidName, status: 'ready', notified: true }
    await db.doc(`reactions/${newest.id}_${kidUid}`).set({ ...reaction, kind: 'heart', createdAt: ts(newest.t + 60e3) })
    await db.collection('reactions').add({ ...reaction, kind: 'comment', text: DEMO_COMMENT, createdAt: ts(newest.t + 120e3) })
  }
  return ids.map((m) => m.id)
}

// The family member's own photos (A14.6): their own scenes, places and times,
// so a review picture of 내 하루 never looks like 엄마's day twice.
const OWN_MEMOS_KO = [
  { at: '08:20', file: 'own-cafe.jpg', lat: 37.5446, lng: 127.0557, place: '성수 카페 · 성수동, 성동구', address: '서울 성동구 아차산로 7', activity: '식사', memo: '출근 전 카페에서 커피 한 잔', scene: '창가 자리에서 따뜻한 커피를 마셨어요.' },
  { at: '12:40', file: 'own-city.jpg', lat: 37.5660, lng: 126.9910, place: '을지로 · 을지로동, 중구', address: '서울 중구 을지로 100', activity: '이동', memo: '점심 먹고 회사 앞 산책', scene: '빌딩 사이 길을 따라 잠깐 걸었어요.' },
  { at: '19:10', file: 'own-dinner.jpg', lat: 37.5559, lng: 126.9019, place: '우리 집 · 망원동, 마포구', address: '서울 마포구 망원로 50', activity: '식사', memo: '집에서 저녁 한 끼', scene: '따뜻한 조명 아래 저녁을 차렸어요.' },
]

const OWN_MEMOS_EN = [
  { at: '08:20', file: 'own-cafe.jpg', lat: 47.6510, lng: -122.3500, place: 'Fremont Coffee · Fremont, Seattle', address: '459 N 36th St, Seattle, WA', activity: '식사', memo: 'Coffee before work', scene: 'A warm cup by the window on the way in.' },
  { at: '12:40', file: 'own-city.jpg', lat: 47.6062, lng: -122.3353, place: '2nd Avenue · Downtown, Seattle', address: '1200 2nd Ave, Seattle, WA', activity: '이동', memo: 'A short walk after lunch', scene: 'A few blocks between the buildings before going back in.' },
  { at: '19:10', file: 'own-dinner.jpg', lat: 47.6686, lng: -122.3832, place: 'Home · Ballard, Seattle', address: '5400 Ballard Ave NW, Seattle, WA', activity: '식사', memo: 'Dinner at home', scene: 'Supper laid out under a warm light.' },
]

const OWN_MEMOS = EN ? OWN_MEMOS_EN : OWN_MEMOS_KO

/** One's own photos on `days` (0 = today, 1 = yesterday …), the OWN_MEMOS slots each day. */
export async function seedOwnMemos({ kidUid, days = [0, 1], now = Date.now() }) {
  const db = getFirestore()
  const bucket = getStorage().bucket()
  const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST
  const ts = (ms) => Timestamp.fromMillis(Math.round(ms))
  const ids = []
  for (const day of days) {
    for (const src of OWN_MEMOS) {
      const t = kst(now, day, src.at)
      const id = `${t}_${rand()}`
      const photoPath = `photos/${kidUid}/${id}.jpg`
      const photoUrl = await upload(bucket, photoPath, src.file, emulatorHost)
      await db.doc(`memos/${id}`).set({
        patientUid: kidUid, photoPath, photoUrl, takenAt: ts(t), createdAt: ts(t + 5000), tzOffsetMin: 540,
        lat: src.lat, lng: src.lng, place: src.place, address: src.address, activity: src.activity,
        memo: src.memo, scene: src.scene, status: 'ready', memoSource: 'local-llm', model: 'gemma4:e4b', notifiedAt: ts(t + 30000),
      })
      ids.push(id)
    }
  }
  return ids
}

/**
 * A second parent for the family's home with two cards (A10): registered and
 * linked like seedDemoFamily's 엄마, with `yesterday` photos yesterday and
 * none today, so the card shows its quiet line.
 */
export async function seedSecondParent({ kidUid, kidName, name = SECOND_PARENT, yesterday = 2, now = Date.now() }) {
  const db = getFirestore()
  const bucket = getStorage().bucket()
  const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST
  const ts = (ms) => Timestamp.fromMillis(Math.round(ms))
  const uid = (await getAuth().createUser({ displayName: name })).uid
  await db.doc(`users/${uid}`).set({
    patientName: name, recipients: [], cadence: 'daily', geoLang: DEMO_LANG, autoMode: true, bigText: true, retention: '90',
    accountType: 'managed', voiceEnabled: false, createdBy: kidUid, lastModifiedBy: kidUid, lastModifiedAt: FieldValue.serverTimestamp(),
  })
  const share = await db.collection('consents').add({
    patientUid: uid, grantedBy: 'guardian', guardianUid: kidUid, consentTextVersion: 'simple-v1', type: 'third_party_share', scope: '메모 + 위치 + 사진을 가족과 공유', timestamp: FieldValue.serverTimestamp(),
  })
  await db.doc(`memberships/${uid}_${kidUid}`).set({
    patientUid: uid, caregiverUid: kidUid, caregiverName: kidName, role: 'guardian', status: 'active', invitedBy: kidUid,
    consentId: share.id, createdAt: FieldValue.serverTimestamp(), acceptedAt: FieldValue.serverTimestamp(), revokedAt: null,
  })
  const times = ['09:20', '12:10', '16:45', '18:30']
  for (let i = 0; i < Math.min(yesterday, times.length); i++) {
    const src = MEMOS[(i + 2) % MEMOS.length]
    const t = kst(now, 1, times[i])
    const id = `${t}_${rand()}`
    const photoPath = `photos/${uid}/${id}.jpg`
    const photoUrl = await upload(bucket, photoPath, src.file, emulatorHost)
    await db.doc(`memos/${id}`).set({
      patientUid: uid, photoPath, photoUrl, takenAt: ts(t), createdAt: ts(t + 5000), tzOffsetMin: 540,
      lat: src.lat, lng: src.lng, place: src.place, address: src.address, activity: src.activity, memo: src.memo, scene: src.scene,
      status: 'ready', memoSource: 'local-llm', model: 'gemma4:e4b', notifiedAt: ts(t + 30000),
    })
  }
  return { uid }
}
