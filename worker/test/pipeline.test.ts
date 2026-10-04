// Memo pipeline + request queue tests. Storage, geocoding and Ollama are
// injected fakes; Firestore is the real emulator.

import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { MAX_ATTEMPTS, processMemo, type MemoDeps } from '../src/handlers/memo'
import { processRequest } from '../src/handlers/requests'
import { LlmGenerationError, LlmUnavailableError } from '../src/llm/ollama'
import { buildPrompt, parseModelResponse, type PromptHints } from '../src/llm/prompt'
import { distanceKm, inferHome, resetHomeCache, utcOffsetHours } from '../src/travel'
import { db, clearFirestore, seedMembership, count } from './setup'

const PHOTO_URL = 'https://example.test/photo.jpg?token=t'

function deps(overrides: Partial<MemoDeps> = {}): MemoDeps & { generateCalls: number; lastHints: PromptHints | null } {
  const d = {
    generateCalls: 0,
    lastHints: null as PromptHints | null,
    loadPhoto: async () => ({ photoUrl: PHOTO_URL, base64: async () => 'aGk=' }),
    geocode: async () => ({ place: '서초동, 서초구', address: '서울특별시 서초구 서초대로 1' }),
    generate: async (args: PromptHints) => {
      d.generateCalls++
      d.lastHints = args
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

beforeEach(async () => { await clearFirestore(); resetHomeCache() })

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
    expect(m.address).toBe('서울특별시 서초구 서초대로 1')
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

  it('ignores a memo written on the phone and writes its own from the photo', async () => {
    await seedPending('m1', {
      deviceMemo: '오늘의 한 순간을 담았어요.\n\n지어낸 긴 이야기.',
      deviceMemoSource: 'foundation-models',
      tags: { labels: [{ name: 'food', confidence: 0.9 }], text: [], faceCount: 0 },
    })
    const d = deps()
    await processMemo('m1', 1, d)
    const m = await memo('m1')
    expect(d.generateCalls).toBe(1)
    expect(m.memo).toBe('공원에서 산책 중이세요.')
    expect(m.memoSource).toBe('local-llm')
    expect(m.deviceMemo).toBeUndefined()
  })

  it('tells the model the photo is far from the home the family set', async () => {
    await db.doc('users/p1').set({ patientName: '엄마', home: { lat: 37.48, lng: 127.01 } })
    // Nagoya airport, 13:18 local (04:18 UTC).
    await seedPending('m1', { lat: 34.86, lng: 136.82, takenAt: Timestamp.fromDate(new Date('2026-10-04T04:18:00Z')) })
    const d = deps({ geocode: async () => ({ place: 'FamilyMart · 도코나메시, 일본', address: '' }) })
    await processMemo('m1', 1, d)
    expect(d.lastHints?.homeHint?.away).toBe(true)
    expect(d.lastHints?.homeHint?.km).toBeGreaterThan(800)
    expect(d.lastHints?.placeHint).toBe('FamilyMart · 도코나메시, 일본')
    expect(d.lastHints?.timeHint).toBe('13:18')
  })

  it('infers home from where most photos were taken', async () => {
    for (let i = 0; i < 6; i++) await seedPending(`old${i}`, { status: 'ready', lat: 37.48 + i * 0.001, lng: 127.01 })
    await seedPending('m1', { lat: 37.481, lng: 127.011 })
    const d = deps()
    await processMemo('m1', 1, d)
    expect(d.lastHints?.homeHint).toEqual({ km: 0, away: false })
  })

  it('gives no distance hint when the photo has no location', async () => {
    await db.doc('users/p1').set({ patientName: '엄마', home: { lat: 37.48, lng: 127.01 } })
    await seedPending('m1', { lat: null, lng: null, takenAt: Timestamp.fromDate(new Date('2026-10-04T04:18:00Z')) })
    const d = deps()
    await processMemo('m1', 1, d)
    expect(d.lastHints?.homeHint).toBeUndefined()
    // Falls back to the home's clock rather than the worker's.
    expect(d.lastHints?.timeHint).toBe('13:18')
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
    expect(m.memo).toBe('사진을 기록했어요.')
    expect(m.activity).toBe('기타')
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

describe('memo text clean-up', () => {
  it('accepts the wider category list', () => {
    expect(parseModelResponse('{"activity":"여행","memo":"나고야 시내 거리 구경","scene":"거리예요."}')?.activity).toBe('여행')
  })
  it('keeps the title to one line and the description to three sentences', () => {
    const out = parseModelResponse(JSON.stringify({
      activity: '이동',
      memo: '공항에 도착했어요.\n\n그리고 아주 길게 이어지는 지어낸 이야기가 계속 이어지고 또 이어집니다.',
      scene: '하나예요. 둘이에요.\n셋이에요. 넷이에요.',
    }))!
    expect(out.memo).toBe('공항에 도착했어요.')
    expect(out.scene).toBe('하나예요. 둘이에요. 셋이에요.')
  })
})

describe('travel context', () => {
  const seoul = { lat: 37.48, lng: 127.01 }
  it('measures distance and picks the photographer\'s clock', () => {
    expect(Math.round(distanceKm(seoul, { lat: 34.86, lng: 136.82 }) / 100)).toBe(9)
    expect(utcOffsetHours(seoul)).toBe(9)
    expect(utcOffsetHours({ lat: 37.4, lng: -122.1 })).toBe(-8)
  })
  it('needs enough agreeing photos to infer a home', () => {
    expect(inferHome([seoul, seoul, seoul])).toBeNull()
    expect(inferHome([seoul, seoul, seoul, seoul, seoul, { lat: 34.86, lng: 136.82 }])?.lat).toBeCloseTo(37.48)
  })
  it('only steers toward 여행/출장 when far from home', () => {
    expect(buildPrompt({ homeHint: { km: 900, away: true } })).toContain('여행이나 출장 중일 가능성')
    expect(buildPrompt({ homeHint: { km: 1, away: false } })).toContain('집 또는 집 근처')
    expect(buildPrompt()).not.toContain('집과의 거리')
  })
})
