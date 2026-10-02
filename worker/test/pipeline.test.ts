// Memo pipeline + request queue tests. Storage, geocoding and Ollama are
// injected fakes; Firestore is the real emulator.

import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { MAX_ATTEMPTS, processMemo, type MemoDeps } from '../src/handlers/memo'
import { processRequest } from '../src/handlers/requests'
import { LlmGenerationError, LlmUnavailableError } from '../src/llm/ollama'
import { parseModelResponse } from '../src/llm/prompt'
import { db, clearFirestore, seedMembership, count } from './setup'

const PHOTO_URL = 'https://example.test/photo.jpg?token=t'

function deps(overrides: Partial<MemoDeps> = {}): MemoDeps & { generateCalls: number } {
  const d = {
    generateCalls: 0,
    loadPhoto: async () => ({ photoUrl: PHOTO_URL, base64: async () => 'aGk=' }),
    geocode: async () => '서초동, 서초구',
    generate: async () => {
      d.generateCalls++
      return {
        activity: '산책', memo: '공원에서 산책 중이세요.', scene: '나무 사이를 걷고 계세요. 평온한 오후예요.',
        model: 'gemma4:e4b', cost: { promptTokens: 1200, outputTokens: 50, totalUSD: 0 },
      }
    },
    ...overrides,
  }
  return d
}

async function seedPending(id: string, extra: Record<string, unknown> = {}) {
  await db.doc(`memos/${id}`).set({
    patientUid: 'p1',
    photoPath: `photos/p1/${id}.jpg`,
    photoUrl: '',
    takenAt: Timestamp.now(),
    lat: 37.48, lng: 127.01,
    place: '', activity: '기타', memo: '', scene: '',
    status: 'pending',
    createdAt: Timestamp.now(),
    ...extra,
  })
}

const memo = async (id: string) => (await db.doc(`memos/${id}`).get()).data()!

beforeEach(async () => { await clearFirestore() })

describe('processMemo', () => {
  it('writes the local-model memo, notifies caregivers once, bumps counters', async () => {
    await seedMembership('p1', 'cg1')
    await seedPending('m1')
    const d = deps()
    expect(await processMemo('m1', 1, d)).toBe('done')
    const m = await memo('m1')
    expect(m.status).toBe('ready')
    expect(m.memo).toBe('공원에서 산책 중이세요.')
    expect(m.memoSource).toBe('local-llm')
    expect(m.model).toBe('gemma4:e4b')
    expect(m.photoUrl).toBe(PHOTO_URL)
    expect(m.place).toBe('서초동, 서초구')
    expect(await count('notifications', 'type', 'photo.new')).toBe(1)
    const totals = (await db.doc('admin_totals/global').get()).data()!
    expect(totals.memos).toBe(1)
    expect(totals.bySource['local-llm']).toBe(1)
    expect(totals.byCategory['산책']).toBe(1)
    expect(totals.byModel['gemma4_e4b'].calls).toBe(1)
    expect(totals.geminiUSD).toBe(0)

    // A second pass (e.g. worker restart) is a no-op: already ready.
    expect(await processMemo('m1', 1, d)).toBe('done')
    expect(d.generateCalls).toBe(1)
    expect(await count('notifications', 'type', 'photo.new')).toBe(1)
  })

  it('uses the on-device memo verbatim and skips the model', async () => {
    await seedPending('m1', {
      deviceMemo: '맛있는 식사를 하고 계세요.',
      deviceMemoSource: 'foundation-models',
      tags: { labels: [{ name: 'food', confidence: 0.9 }], text: [], faceCount: 0 },
    })
    const d = deps()
    await processMemo('m1', 1, d)
    const m = await memo('m1')
    expect(d.generateCalls).toBe(0)
    expect(m.memo).toBe('맛있는 식사를 하고 계세요.')
    expect(m.activity).toBe('식사')
    expect(m.memoSource).toBe('foundation-models')
    expect(m.deviceMemo).toBeUndefined()
  })

  it('leaves the memo pending while Ollama is unreachable', async () => {
    await seedPending('m1')
    const d = deps({ generate: async () => { throw new LlmUnavailableError('down') } })
    expect(await processMemo('m1', 1, d)).toBe('unavailable')
    expect((await memo('m1')).status).toBe('pending')
  })

  it('retries generation failures, then writes the stub on the final attempt', async () => {
    await seedPending('m1')
    const d = deps({ generate: async () => { throw new LlmGenerationError('bad json') } })
    expect(await processMemo('m1', 1, d)).toBe('failed')
    expect((await memo('m1')).status).toBe('pending')
    expect(await processMemo('m1', MAX_ATTEMPTS, d)).toBe('done')
    const m = await memo('m1')
    expect(m.status).toBe('ready')
    expect(m.memoSource).toBe('local-stub')
    expect(m.memo).toBeTruthy()
  })

  it('preserves a guardian edit made while pending', async () => {
    await seedPending('m1', { humanEdited: true, memo: '직접 쓴 메모', memoSource: 'human' })
    await processMemo('m1', 1, deps())
    const m = await memo('m1')
    expect(m.status).toBe('ready')
    expect(m.memo).toBe('직접 쓴 메모')
    expect(m.memoSource).toBe('human')
    expect(m.photoUrl).toBe(PHOTO_URL)
  })

  it('marks error when the photo is missing or outside the owner folder', async () => {
    await seedPending('m1')
    await processMemo('m1', 1, deps({ loadPhoto: async () => null }))
    expect((await memo('m1')).status).toBe('error')

    await seedPending('m2', { photoPath: 'photos/someone_else/x.jpg' })
    await processMemo('m2', 1, deps())
    expect((await memo('m2')).status).toBe('error')
  })
})

describe('processRequest', () => {
  async function request(type: string, payload: unknown, caller = { uid: 'p1', email: 'p1@x.com', name: '환자' }) {
    const ref = db.collection('requests').doc()
    await ref.set({ type, payload, ...caller, status: 'pending', createdAt: Timestamp.now() })
    await processRequest(ref.id)
    return (await ref.get()).data()!
  }

  it('runs the handler and writes the result', async () => {
    const r = await request('createInvite', { patientUid: 'p1', role: 'viewer' })
    expect(r.status).toBe('done')
    expect(r.result.code).toMatch(/^\d{6}$/)
  })

  it('reports handler errors with their code', async () => {
    const r = await request('createInvite', { patientUid: 'p1' }, { uid: 'stranger', email: null as any, name: null as any })
    expect(r.status).toBe('error')
    expect(r.code).toBe('permission-denied')
  })

  it('rejects regenerateMemo from a non-admin email', async () => {
    const r = await request('regenerateMemo', { memoId: 'm1' })
    expect(r.code).toBe('permission-denied')
  })

  it('rejects unknown request types', async () => {
    const r = await request('deleteEverything', {})
    expect(r.code).toBe('unimplemented')
  })

  it('never runs a request twice', async () => {
    const ref = db.collection('requests').doc()
    await ref.set({ type: 'createInvite', payload: { patientUid: 'p1' }, uid: 'p1', email: null, name: null, status: 'pending', createdAt: Timestamp.now() })
    await Promise.all([processRequest(ref.id), processRequest(ref.id)])
    expect(await count('auditLogs', 'action', 'invite.create')).toBe(1)
  })
})

describe('parseModelResponse', () => {
  it('snaps unknown categories to 기타 and strips code fences', () => {
    expect(parseModelResponse('```json\n{"activity":"점심","memo":"식사 중이세요.","scene":""}\n```'))
      .toEqual({ activity: '기타', memo: '식사 중이세요.', scene: '' })
  })
  it('rejects output without a memo', () => {
    expect(parseModelResponse('{"activity":"산책"}')).toBeNull()
  })
})
