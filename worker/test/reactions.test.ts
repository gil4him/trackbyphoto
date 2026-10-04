// Reactions: family hearts/comments, the parent's hearts and voice replies.
// Storage and speech-to-text are injected fakes; Firestore is the emulator.

import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { MAX_ATTEMPTS, processReaction, ReactionScheduler, type ReactionDeps } from '../src/handlers/reactions'
import { SttError, SttUnavailableError, tidyTranscript } from '../src/llm/stt'
import { db, clearFirestore, seedMembership, count } from './setup'

const AUDIO_URL = 'https://example.test/voice.webm?token=t'

function deps(overrides: Partial<ReactionDeps> = {}): ReactionDeps & { transcribeCalls: number } {
  const d = {
    transcribeCalls: 0,
    loadClip: async () => ({ audioUrl: AUDIO_URL, bytes: async () => Buffer.from('audio') }),
    transcribe: async () => { d.transcribeCalls++; return '괜찮아, 오늘 많이 걸었어' },
    ...overrides,
  }
  return d
}

async function seed(id: string, data: Record<string, unknown>) {
  await db.doc(`reactions/${id}`).set({
    memoId: 'm1', patientUid: 'p1', status: 'ready', notified: false, createdAt: Timestamp.now(), ...data,
  })
}
const familyHeart = (id = 'r1') => seed(id, { actorUid: 'cg1', actorName: '민수', kind: 'heart' })
const elderVoice = (id = 'v1', extra: Record<string, unknown> = {}) =>
  seed(id, { actorUid: 'p1', actorName: '어머니', kind: 'voice', status: 'pending', audioPath: `voice/p1/m1/${id}.webm`, ...extra })

const reaction = async (id: string) => (await db.doc(`reactions/${id}`).get()).data()!
const notices = async (recipientUid: string) =>
  (await db.collection('notifications').where('recipientUid', '==', recipientUid).get()).docs.map((d) => d.data())

beforeEach(async () => {
  await clearFirestore()
  await db.doc('users/p1').set({ patientName: '어머니' })
  await seedMembership('p1', 'cg1')
  await seedMembership('p1', 'cg2', { role: 'viewer' })
  await seedMembership('p1', 'gone', { status: 'revoked' })
})

describe('family reactions', () => {
  it('a heart reaches the parent as one notice', async () => {
    await familyHeart()
    expect(await processReaction('r1', 1, deps())).toBe('done')
    expect(await notices('p1')).toEqual([expect.objectContaining({
      type: 'reaction.heart', message: '민수님이 하트를 보냈어요', actorUid: 'cg1', memoId: 'm1', reactionId: 'r1', read: false,
    })])
    expect((await reaction('r1')).notified).toBe(true)
    // Nothing goes to the other family members.
    expect(await notices('cg2')).toEqual([])
  })

  it('a comment reaches the parent', async () => {
    await seed('c1', { actorUid: 'cg1', actorName: '민수', kind: 'comment', text: '엄마 날씨 좋네요' })
    await processReaction('c1', 1, deps())
    expect((await notices('p1'))[0]).toMatchObject({ type: 'reaction.comment', message: '민수님이 글을 남겼어요' })
  })

  it('is announced once however often it is processed', async () => {
    await familyHeart()
    await processReaction('r1', 1, deps())
    await processReaction('r1', 1, deps())
    expect(await count('notifications', 'recipientUid', 'p1')).toBe(1)
  })

  it('rejects a kind the sender may not use', async () => {
    await seed('bad', { actorUid: 'cg1', actorName: '민수', kind: 'voice', status: 'pending', audioPath: 'voice/p1/m1/x.webm' })
    const d = deps()
    await processReaction('bad', 1, d)
    expect(await reaction('bad')).toMatchObject({ status: 'error', notified: true })
    expect(d.transcribeCalls).toBe(0)
    expect((await db.collection('notifications').get()).size).toBe(0)
  })
})

describe('the parent\'s reactions', () => {
  it('a heart reaches every active family member', async () => {
    await seed('h1', { actorUid: 'p1', actorName: '어머니', kind: 'heart' })
    await processReaction('h1', 1, deps())
    expect((await notices('cg1'))[0]).toMatchObject({ type: 'reaction.heart', message: '어머니님이 하트를 보내셨어요' })
    expect(await count('notifications', 'recipientUid', 'cg2')).toBe(1)
    expect(await count('notifications', 'recipientUid', 'gone')).toBe(0)
  })

  it('a voice reply is transcribed, made playable, then announced', async () => {
    await elderVoice()
    expect(await processReaction('v1', 1, deps())).toBe('done')
    expect(await reaction('v1')).toMatchObject({
      status: 'ready', transcript: '괜찮아, 오늘 많이 걸었어', audioUrl: AUDIO_URL, notified: true,
    })
    expect((await notices('cg1'))[0]).toMatchObject({ type: 'reaction.voice', message: '어머니님이 음성 답장을 남기셨어요', reactionId: 'v1' })
    expect(await count('notifications', 'recipientUid', 'cg2')).toBe(1)
  })

  it('two runs of the same voice reply announce it once', async () => {
    await elderVoice()
    await Promise.all([processReaction('v1', 1, deps()), processReaction('v1', 1, deps())])
    expect(await count('notifications', 'recipientUid', 'cg1')).toBe(1)
    expect(await count('notifications', 'recipientUid', 'cg2')).toBe(1)
  })

  it('waits while speech-to-text is not installed or down', async () => {
    await elderVoice()
    const d = deps({ transcribe: async () => { throw new SttUnavailableError('no whisper') } })
    expect(await processReaction('v1', 1, d)).toBe('unavailable')
    expect(await reaction('v1')).toMatchObject({ status: 'pending', notified: false })
    expect((await db.collection('notifications').get()).size).toBe(0)
  })

  it('retries a failed transcription, then sends the clip without a transcript', async () => {
    await elderVoice()
    const d = deps({ transcribe: async () => { throw new SttError('bad audio') } })
    expect(await processReaction('v1', 1, d)).toBe('failed')
    expect((await reaction('v1')).status).toBe('pending')
    expect(await processReaction('v1', MAX_ATTEMPTS, d)).toBe('done')
    expect(await reaction('v1')).toMatchObject({ status: 'ready', transcript: '', audioUrl: AUDIO_URL })
    expect(await count('notifications', 'recipientUid', 'cg1')).toBe(1)
  })

  it('marks error when the clip is missing or outside the parent\'s folder', async () => {
    await elderVoice('gone', {})
    await elderVoice('else', { audioPath: 'voice/someone-else/m1/x.webm' })
    await processReaction('gone', 1, deps({ loadClip: async () => null }))
    await processReaction('else', 1, deps())
    expect((await reaction('gone')).status).toBe('error')
    expect((await reaction('else')).status).toBe('error')
    expect((await db.collection('notifications').get()).size).toBe(0)
  })
})

describe('ReactionScheduler', () => {
  it('works through queued reactions in order', async () => {
    await familyHeart('r1')
    await elderVoice('v1')
    const s = new ReactionScheduler(deps())
    s.enqueue('r1')
    s.enqueue('v1')
    s.enqueue('v1')
    await s.idle()
    expect((await reaction('r1')).notified).toBe(true)
    expect((await reaction('v1')).status).toBe('ready')
    expect(await count('notifications', 'recipientUid', 'cg1')).toBe(1)
  })
})

describe('tidyTranscript', () => {
  it('keeps what was said on one line', () => {
    expect(tidyTranscript('  괜찮아,\n 오늘 많이 걸었어 \n')).toBe('괜찮아, 오늘 많이 걸었어')
  })
  it('drops what whisper prints for silence and noise', () => {
    expect(tidyTranscript('[음악] (박수)')).toBe('')
    expect(tidyTranscript(' 시청해주셔서 감사합니다. ')).toBe('')
    expect(tidyTranscript('[BLANK_AUDIO] 고마워')).toBe('고마워')
  })
  it('caps very long output', () => {
    expect(tidyTranscript('가'.repeat(500)).length).toBe(200)
  })
})
