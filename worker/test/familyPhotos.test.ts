// Photos family send to a parent: the link, and the parent's reply reaching the sender.
import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { announceFamilyPhotoReply, readyFamilyPhoto, type FamilyPhotoDeps } from '../src/handlers/familyPhotos'
import { resetPlansCache } from '../src/plans'
import { db, clearFirestore, seedMembership } from './setup'

const flag = async (on: boolean) => {
  await db.doc('admin_config/plans').set({ flags: { familyPhotos: on, pushFamily: true } })
  resetPlansCache()
}
function fakes(files = new Set<string>()) {
  const f = { pushes: [] as Array<{ uids: string[]; body: string }>, files }
  const deps: FamilyPhotoDeps = {
    linkTo: async (path) => (files.has(path) ? `https://example.test/${path}` : null),
    push: async (uids, message) => { f.pushes.push({ uids, body: message.body }); return 1 },
  }
  return { f, deps }
}
const photo = (id: string, extra: Record<string, unknown> = {}) => db.doc(`familyPhotos/${id}`).set({
  patientUid: 'p1', senderUid: 'cg1', senderName: '민수', photoPath: `familyPhotos/p1/${id}.jpg`, caption: '보고 싶어요',
  status: 'pending', createdAt: Timestamp.now(), ...extra,
})
const notices = async (uid: string) => (await db.collection('notifications').where('recipientUid', '==', uid).get()).docs.map((d) => d.data())

beforeEach(async () => {
  await clearFirestore()
  await flag(true)
  await db.doc('users/p1').set({ patientName: '할머니' })
  await seedMembership('p1', 'cg1')
})

describe('a photo from the family', () => {
  it('gets its link and becomes ready', async () => {
    await photo('a')
    const { deps } = fakes(new Set(['familyPhotos/p1/a.jpg']))
    expect(await readyFamilyPhoto('a', deps)).toBe('ready')
    const d = (await db.doc('familyPhotos/a').get()).data()!
    expect(d.status).toBe('ready')
    expect(d.photoUrl).toBe('https://example.test/familyPhotos/p1/a.jpg')
    expect(await readyFamilyPhoto('a', deps)).toBe('skipped')
  })

  it('waits while the file has not arrived, and while the switch is off', async () => {
    await photo('a')
    const { deps } = fakes()
    expect(await readyFamilyPhoto('a', deps)).toBe('no-file')
    expect((await db.doc('familyPhotos/a').get()).get('status')).toBe('pending')
    await flag(false)
    expect(await readyFamilyPhoto('a', fakes(new Set(['familyPhotos/p1/a.jpg'])).deps)).toBe('off')
    expect((await db.doc('familyPhotos/a').get()).get('status')).toBe('pending')
  })
})

describe("the parent's reply", () => {
  it('reaches the sender once, in the app and by push', async () => {
    await photo('a', { status: 'ready', reply: { kind: 'heart', at: Timestamp.now(), notified: false } })
    const { f, deps } = fakes()
    expect(await announceFamilyPhotoReply('a', deps)).toBe(true)
    expect(await announceFamilyPhotoReply('a', deps)).toBe(false)
    const [n] = await notices('cg1')
    expect(n).toMatchObject({ type: 'familyPhoto.reply', patientUid: 'p1', familyPhotoId: 'a', message: '할머니님이 보낸 사진에 ❤️를 보냈어요', read: false })
    expect(await notices('cg1')).toHaveLength(1)
    expect(f.pushes).toEqual([{ uids: ['cg1'], body: '할머니님이 보낸 사진에 ❤️를 보냈어요' }])
    expect((await db.doc('familyPhotos/a').get()).get('reply.notified')).toBe(true)
  })

  it('carries the written line, and a changed reply is told again', async () => {
    await photo('a', { status: 'ready', reply: { kind: 'comment', text: '고마워', at: Timestamp.now(), notified: false } })
    const { f, deps } = fakes()
    await announceFamilyPhotoReply('a', deps)
    expect(f.pushes[0].body).toBe('할머니님이 보낸 사진에 답장했어요: “고마워”')
    await db.doc('familyPhotos/a').update({ reply: { kind: 'heart', at: Timestamp.now(), notified: false } })
    expect(await announceFamilyPhotoReply('a', deps)).toBe(true)
    expect(await notices('cg1')).toHaveLength(2)
  })

  it('is nothing to announce without a reply', async () => {
    await photo('a', { status: 'ready' })
    expect(await announceFamilyPhotoReply('a', fakes().deps)).toBe(false)
  })
})
