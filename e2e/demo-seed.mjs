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

const MEMOS = [
  { day: 1, at: '15:10', file: 'photo3.jpg', lat: 37.5480, lng: 127.0745, place: '어린이대공원 · 능동, 광진구', address: '서울 광진구 능동로 216', activity: '자연', memo: '초록 나무가 가득한 공원', scene: '키 큰 나무 두 그루 사이로 넓은 잔디밭이 펼쳐져 있어요. 햇살이 따뜻한 오후예요.' },
  { day: 1, at: '18:20', file: 'photo1.jpg', lat: 37.5096, lng: 127.1040, place: '석촌호수 · 잠실동, 송파구', address: '서울 송파구 잠실로 148', activity: '산책', memo: '노을 지는 호숫가 산책', scene: '하늘이 주황빛으로 물들 무렵 호숫가 길을 걸으셨어요. 나무 사이로 해가 지고 있어요.' },
  { day: 2, at: '11:05', file: 'photo2.jpg', lat: 37.5178, lng: 127.0866, place: '한강공원 잠실지구 · 잠실동, 송파구', address: '서울 송파구 한가람로 65', activity: '휴식', memo: '한강공원에서 쉬어 가기', scene: '잔디밭 옆 산책로에서 잠시 쉬셨어요. 하늘이 맑고 바람이 시원해 보여요.' },
  { day: 3, at: '08:30', file: 'photo0.jpg', lat: 37.5207, lng: 127.1214, place: '올림픽공원 · 방이동, 송파구', address: '서울 송파구 올림픽로 424', activity: '산책', memo: '올림픽공원 아침 산책', scene: '맑은 하늘 아래 흙길을 따라 걸으셨어요. 양옆으로 나무가 서 있어요.' },
]

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
    patientName: kidName, recipients: [], cadence: 'daily', autoMode: true, bigText: true, retention: '90', geoLang: 'ko',
    lastModifiedBy: kidUid, lastModifiedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  const mom = (await getAuth().createUser({ displayName: '엄마' })).uid
  await db.doc(`users/${mom}`).set({
    patientName: '엄마', recipients: [], cadence: 'daily', geoLang: 'ko', autoMode: true, bigText: true, retention: '90',
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
  await db.collection('reactions').add({ ...reaction, kind: 'comment', text: '엄마 오늘 날씨 좋았네요! 산책 잘하셨어요 😊', createdAt: ts(newest.t + 21 * 60e3) })

  // A photo sent to mom, answered with a heart.
  const ft = kst(now, 1, '20:40')
  const fid = `${ft}_${rand()}`
  const fpath = `familyPhotos/${mom}/${fid}.jpg`
  await db.doc(`familyPhotos/${fid}`).set({
    patientUid: mom, senderUid: kidUid, senderName: kidName, photoPath: fpath,
    photoUrl: await upload(bucket, fpath, 'photo2.jpg', emulatorHost),
    caption: '엄마, 주말에 한강 같이 가요!', status: 'ready', createdAt: ts(ft), readyAt: ts(ft + 3000),
    seenAt: ts(ft + H), reply: { kind: 'heart', at: ts(ft + H + 60e3), notified: true },
  })

  return { momUid: mom, memoIds: memoIds.map((m) => m.id), familyPhotoId: fid }
}
