// Memo pipeline + request queue tests. Storage, geocoding and Ollama are
// injected fakes; Firestore is the real emulator.

import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { MAX_ATTEMPTS, MemoScheduler, memoConcurrency, prepareMemo, processMemo, type MemoDeps } from '../src/handlers/memo'
import { beat } from '../src/heartbeat'
import { locateMemo } from '../src/handlers/place'
import { processRequest } from '../src/handlers/requests'
import { LlmGenerationError, LlmUnavailableError } from '../src/llm/ollama'
import { areaOf, buildPrompt, categoryFromTags, parseModelResponse, readableText, type PromptHints } from '../src/llm/prompt'
import { distanceKm, inferHome, resetHomeCache, setTravelGeocoder, utcOffsetHours } from '../src/travel'
import { db, clearFirestore, seedMembership, count } from './setup'

const PHOTO_URL = 'https://example.test/photo.jpg?token=t'

type Hints = PromptHints & { temperature?: number }

function deps(overrides: Partial<MemoDeps> = {}): MemoDeps & { generateCalls: number; lastHints: Hints | null } {
  const d = {
    generateCalls: 0,
    lastHints: null as Hints | null,
    loadPhoto: async () => ({ photoUrl: PHOTO_URL, base64: async () => 'aGk=' }),
    geocode: async () => ({ place: '서초동, 서초구', address: '서울특별시 서초구 서초대로 1' }),
    generate: async (args: Hints) => {
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

beforeEach(async () => { await clearFirestore(); resetHomeCache(); setTravelGeocoder(async () => ({ place: '', address: '' })) })

describe('thumbnails', () => {
  const withThumb = (thumbUrl: () => Promise<string | null>) =>
    deps({ loadPhoto: async () => ({ photoUrl: PHOTO_URL, base64: async () => 'aGk=', thumbUrl }) })

  it('the quick pass and the finished memo both carry the list-sized link', async () => {
    await seedPending('t1')
    await prepareMemo('t1', withThumb(async () => 'https://example.test/t1.thumb.jpg'))
    expect((await db.doc('memos/t1').get()).get('thumbUrl')).toBe('https://example.test/t1.thumb.jpg')

    await seedPending('t2')
    expect(await processMemo('t2', 1, withThumb(async () => 'https://example.test/t2.thumb.jpg'))).toBe('done')
    const d = (await db.doc('memos/t2').get()).data()!
    expect(d).toMatchObject({ status: 'ready', thumbUrl: 'https://example.test/t2.thumb.jpg' })
  })

  it('a thumbnail that fails never holds the memo up', async () => {
    await seedPending('t3')
    const d = withThumb(async () => { throw new Error('sharp exploded') })
    await prepareMemo('t3', d)
    expect(await processMemo('t3', 1, d)).toBe('done')
    const memo = (await db.doc('memos/t3').get()).data()!
    expect(memo.status).toBe('ready')
    expect(memo.photoUrl).toBe(PHOTO_URL)
    expect(memo.thumbUrl).toBeUndefined()
  })
})

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

  it('simple edition: the per-photo notice and push too (plus the evening count)', async () => {
    await seedMembership('p1', 'cg1')
    await seedPending('m1')
    const pushed: string[][] = []
    process.env.EDITION = 'simple'
    try {
      expect(await processMemo('m1', 1, deps({ push: async (uids) => { pushed.push(uids); return 0 } }))).toBe('done')
    } finally {
      delete process.env.EDITION
    }
    expect((await memo('m1')).status).toBe('ready')
    expect((await memo('m1')).notifiedAt).toBeTruthy()
    expect(await count('notifications', 'type', 'photo.new')).toBe(1)
    expect(pushed).toEqual([['cg1']])
    expect((await db.doc('admin_totals/global').get()).data()!.memos).toBe(1)
  })

  it('keeps what memo v2 adds (its version, hook and facts), and clears them when v1 writes again', async () => {
    await seedPending('m1', { takenAt: Timestamp.fromDate(new Date('2026-04-05T01:00:00Z')), tzOffsetMin: 540, tags: { labels: [{ name: 'tree', confidence: 0.9 }], text: [], faceCount: 0 } })
    const seen = { activity: '산책', subjects: ['벚나무'], setting: '공원', signText: [], peopleCount: 0 }
    const d = deps({ generate: async (a) => {
      d.lastHints = a
      return { activity: '산책', memo: '벚꽃 아래 공원 산책', scene: '벚나무가 늘어서 있어요.', model: 'gemma4:e4b', source: 'local-llm-v2', cost: { promptTokens: 1, outputTokens: 1, totalUSD: 0 }, memoVersion: 2, hookId: 'nth', seen }
    } })
    expect(await processMemo('m1', 1, d)).toBe('done')
    expect(d.lastHints).toMatchObject({ takenAt: new Date('2026-04-05T01:00:00Z'), tzOffsetMin: 540, tags: { labels: [{ name: 'tree', confidence: 0.9 }] } })
    const doc = (await db.doc('memos/m1').get()).data()!
    expect(doc).toMatchObject({ memoSource: 'local-llm-v2', memoVersion: 2, hookId: 'nth', seen })
    // Written again by v1 (a rewrite): the v2 fields go.
    await db.doc('memos/m1').update({ status: 'pending' })
    expect(await processMemo('m1', 1, deps())).toBe('done')
    const again = (await db.doc('memos/m1').get()).data()!
    expect(again.memoSource).toBe('local-llm')
    expect(again.memoVersion).toBeUndefined()
    expect(again.hookId).toBeUndefined()
    expect(again.seen).toBeUndefined()
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

  it('passes on the text the phone read, minus the noise', async () => {
    await seedPending('m1', {
      tags: { labels: [], text: ['Aichi-', 'Nagoya', '2026', '페CCC#아!!', 'The biggest', '2p'], faceCount: 1 },
    })
    const d = deps()
    await processMemo('m1', 1, d)
    expect(d.lastHints?.textHint).toEqual(['Aichi-', 'Nagoya', 'The biggest'])
    expect(d.lastHints?.temperature).toBeUndefined()
  })

  it('asks for a different take when a memo is being re-written', async () => {
    await seedPending('m1')
    const d = deps()
    await processMemo('m1', 1, d)
    await db.doc('memos/m1').update({ status: 'pending' })
    await processMemo('m1', 1, d)
    expect(d.lastHints?.temperature).toBeGreaterThan(0)
  })

  it('tells the model the photo is far from the home the family set', async () => {
    await db.doc('users/p1').set({ patientName: '엄마', home: { lat: 37.48, lng: 127.01 } })
    // Nagoya airport, 13:18 local (04:18 UTC).
    await seedPending('m1', { lat: 34.86, lng: 136.82, takenAt: Timestamp.fromDate(new Date('2026-10-04T04:18:00Z')) })
    const d = deps({ geocode: async () => ({ place: 'FamilyMart · 도코나메시, 일본', address: '' }) })
    await processMemo('m1', 1, d)
    expect(d.lastHints?.homeHint?.away).toBe(true)
    expect(d.lastHints?.homeHint?.km).toBeGreaterThan(800)
    // The nearest shop's name is kept out of the prompt; the area is enough.
    expect(d.lastHints?.placeHint).toBe('도코나메시, 일본')
    expect(d.lastHints?.timeHint).toBe('13:18')
  })

  it('names home for the model when the photo is far from it', async () => {
    setTravelGeocoder(async () => ({ place: '래미안 · 반포동, 서초구', address: '' }))
    await db.doc('users/p1').set({ patientName: '엄마', home: { lat: 37.48, lng: 127.01 } })
    await seedPending('m1', { lat: 34.86, lng: 136.82 })
    const d = deps({ geocode: async () => ({ place: '도코나메시, 일본', address: '' }) })
    await processMemo('m1', 1, d)
    expect(d.lastHints?.homeHint?.homeArea).toBe('반포동, 서초구')
  })

  it('files a suit far from home as 출장 when the model is not used', async () => {
    await db.doc('users/p1').set({ patientName: '엄마', home: { lat: 37.48, lng: 127.01 } })
    await seedPending('m1', { lat: 34.86, lng: 136.82, tags: { labels: [{ name: 'suit', confidence: 0.9 }], text: [], faceCount: 1 } })
    const d = deps({ generate: async () => { throw new LlmGenerationError('bad json') } })
    await processMemo('m1', MAX_ATTEMPTS, d)
    expect((await memo('m1')).activity).toBe('출장')
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

describe('photo and place ahead of the memo', () => {
  it('fills in the photo link and place without the model', async () => {
    await seedPending('m1')
    const d = deps()
    await prepareMemo('m1', d)
    expect(await memo('m1')).toMatchObject({ status: 'pending', photoUrl: PHOTO_URL, place: '서초동, 서초구', memo: '' })
    expect(d.generateCalls).toBe(0)
  })

  it('does not look the place up a second time when the memo is written', async () => {
    await seedPending('m1')
    let lookups = 0
    const d = deps({ geocode: async () => { lookups++; return { place: '서초동, 서초구', address: '서울특별시 서초구 서초대로 1' } } })
    await prepareMemo('m1', d)
    expect(await processMemo('m1', 1, d)).toBe('done')
    expect(lookups).toBe(1)
    expect(d.lastHints?.placeHint).toBe('서초동, 서초구')
    expect(await memo('m1')).toMatchObject({ status: 'ready', place: '서초동, 서초구' })
  })

  it('leaves a failed lookup for the memo step to flag', async () => {
    await seedPending('m1')
    const d = deps({ geocode: async () => ({ place: '', address: '' }) })
    await prepareMemo('m1', d)
    expect((await memo('m1')).needsGeocode).toBeUndefined()
    await processMemo('m1', 1, d)
    expect((await memo('m1')).needsGeocode).toBe(true)
  })

  it('touches nothing on a finished memo or one pointing outside the owner folder', async () => {
    await seedPending('done', { status: 'ready', photoUrl: '' })
    await seedPending('bad', { photoPath: 'photos/someone-else/x.jpg' })
    const d = deps()
    await prepareMemo('done', d)
    await prepareMemo('bad', d)
    expect((await memo('done')).photoUrl).toBe('')
    expect((await memo('bad')).photoUrl).toBe('')
  })
})

describe('MemoScheduler', () => {
  /** A model that only answers when the test lets it. */
  function gatedDeps() {
    const order: string[] = []
    const release: Array<() => void> = []
    const d = deps({
      loadPhoto: async (photoPath) => ({ photoUrl: PHOTO_URL, base64: async () => photoPath }),
      generate: async (args) => {
        order.push((args as { imageBase64: string }).imageBase64.replace(/^photos\/[^/]+\/|\.jpg$/g, ''))
        await new Promise<void>((r) => release.push(r))
        return { activity: '산책', memo: '공원 산책', scene: '', model: 'gemma4:e4b', cost: { promptTokens: 1, outputTokens: 1, totalUSD: 0 } }
      },
    })
    const until = async (cond: () => boolean | Promise<boolean>) => {
      for (let i = 0; i < 100 && !(await cond()); i++) await new Promise((r) => setTimeout(r, 20))
    }
    return { d, order, release, until }
  }

  it('shows photo and place for every waiting memo while the model is busy', async () => {
    await seedPending('a')
    await seedPending('b')
    const { d, order, release, until } = gatedDeps()
    const s = new MemoScheduler(d, { concurrency: 1 })
    s.enqueue('a')
    s.enqueue('b')
    await until(async () => order.length > 0 && !!(await memo('b')).photoUrl)
    expect(order).toEqual(['a']) // b is still in line for the model
    expect(await memo('b')).toMatchObject({ status: 'pending', photoUrl: PHOTO_URL, place: '서초동, 서초구' })
    expect(s.waiting).toBe(2)
    release[0]()
    await until(() => release.length === 2)
    release[1]()
    await s.idle()
    expect((await memo('b')).status).toBe('ready')
    expect(s.waiting).toBe(0)
  })

  it('writes new photos before memos that are being re-written', async () => {
    for (const id of ['first', 'old1', 'old2', 'new']) await seedPending(id)
    const { d, order, release, until } = gatedDeps()
    const s = new MemoScheduler(d, { concurrency: 1 })
    s.enqueue('first')
    s.enqueue('old1', true)
    s.enqueue('old2', true)
    s.enqueue('new')
    for (let i = 0; i < 4; i++) {
      await until(() => release.length === i + 1)
      release[i]()
    }
    await s.idle()
    expect(order).toEqual(['first', 'new', 'old1', 'old2'])
  })

  /** A memo of parent `p` (its photo in p's folder). */
  const seedFor = (id: string, p: string) => seedPending(id, { patientUid: p, photoPath: `photos/${p}/${id}.jpg` })

  it('writes up to N memos at once', async () => {
    for (const [id, p] of [['a', 'p1'], ['b', 'p2'], ['c', 'p3']]) await seedFor(id, p)
    const { d, order, release, until } = gatedDeps()
    const s = new MemoScheduler(d, { concurrency: 2 })
    s.enqueue('a', false, 'p1')
    s.enqueue('b', false, 'p2')
    s.enqueue('c', false, 'p3')
    await until(async () => release.length === 2 && !!(await memo('c')).photoUrl)
    expect(order).toEqual(['a', 'b'])
    expect(s.waiting).toBe(3)
    expect((await memo('c')).photoUrl).toBe(PHOTO_URL) // shown while it waits for a slot
    release[0]()
    await until(() => release.length === 3)
    expect(order).toEqual(['a', 'b', 'c'])
    release[1]()
    release[2]()
    await s.idle()
    for (const id of ['a', 'b', 'c']) expect((await memo(id)).status).toBe('ready')
    expect(s.waiting).toBe(0)
  })

  it('writes one memo per parent at a time', async () => {
    await seedFor('a', 'p1')
    await seedFor('b', 'p1')
    await seedFor('c', 'p2')
    const { d, order, release, until } = gatedDeps()
    const s = new MemoScheduler(d, { concurrency: 3 })
    s.enqueue('a', false, 'p1')
    s.enqueue('b', false, 'p1')
    s.enqueue('c', false, 'p2')
    await until(() => release.length === 2)
    await new Promise((r) => setTimeout(r, 100))
    expect(order).toEqual(['a', 'c']) // b waits for a, though a slot is free
    release[0]()
    await until(() => release.length === 3)
    expect(order).toEqual(['a', 'c', 'b'])
    release[1]()
    release[2]()
    await s.idle()
    for (const id of ['a', 'b', 'c']) expect((await memo(id)).status).toBe('ready')
  })

  it('still writes new photos before re-writes once the slots are full', async () => {
    const ids: Array<[string, string]> = [['f1', 'p1'], ['f2', 'p2'], ['old1', 'p3'], ['old2', 'p4'], ['new', 'p5']]
    for (const [id, p] of ids) await seedFor(id, p)
    const { d, order, release, until } = gatedDeps()
    const s = new MemoScheduler(d, { concurrency: 2 })
    s.enqueue('f1', false, 'p1')
    s.enqueue('f2', false, 'p2')
    s.enqueue('old1', true, 'p3')
    s.enqueue('old2', true, 'p4')
    s.enqueue('new', false, 'p5')
    await until(() => release.length === 2)
    expect([...order].sort()).toEqual(['f1', 'f2'])
    release[0]()
    await until(() => release.length === 3)
    expect(order[2]).toBe('new')
    release[1]()
    release[2]()
    await until(() => release.length === 5)
    release[3]()
    release[4]()
    await s.idle()
    expect(order.slice(3).sort()).toEqual(['old1', 'old2']) // both re-writes, side by side
  })

  it('retries a failing memo while the others keep going', async () => {
    await seedFor('bad', 'p1')
    await seedFor('good', 'p2')
    const d = deps({
      generate: async (args) => {
        if ((args as { imageBase64: string }).imageBase64 === 'bad') throw new LlmGenerationError('garbled')
        return { activity: '산책', memo: '공원 산책', scene: '', model: 'gemma4:e4b', cost: { promptTokens: 1, outputTokens: 1, totalUSD: 0 } }
      },
      loadPhoto: async (photoPath) => ({ photoUrl: PHOTO_URL, base64: async () => photoPath.replace(/^photos\/[^/]+\/|\.jpg$/g, '') }),
    })
    const s = new MemoScheduler(d, { concurrency: 2 })
    s.enqueue('bad', false, 'p1')
    s.enqueue('good', false, 'p2')
    await s.idle()
    expect((await memo('good')).status).toBe('ready')
    expect((await memo('bad')).status).toBe('pending')
    expect(s.waiting).toBe(1) // 'bad' sits on its retry timer
    s.stop()
  })

  it('frees the slot of a memo forgotten while it was being written', async () => {
    await seedFor('a', 'p1')
    await seedFor('b', 'p1')
    const { d, release, until } = gatedDeps()
    const s = new MemoScheduler(d, { concurrency: 2 })
    s.enqueue('a', false, 'p1')
    s.enqueue('b', false, 'p1')
    await until(() => release.length === 1)
    await db.doc('memos/a').delete()
    s.forget('a')
    release[0]()
    await until(() => release.length === 2) // p1 is free again, so b runs
    release[1]()
    await s.idle()
    expect((await memo('b')).status).toBe('ready')
    expect(s.waiting).toBe(0)
  })

  it('keeps a guardian correction made while the model was writing', async () => {
    await seedPending('m1')
    const { d, release, until } = gatedDeps()
    const s = new MemoScheduler(d, { concurrency: 1 })
    s.enqueue('m1', false, 'p1')
    await until(() => release.length === 1)
    await db.doc('memos/m1').update({ humanEdited: true, memo: '직접 쓴 메모' })
    release[0]()
    await s.idle()
    expect(await memo('m1')).toMatchObject({ status: 'ready', memo: '직접 쓴 메모' })
  })

  it('reads MEMO_CONCURRENCY as 1 to 8, default 3', () => {
    expect(memoConcurrency({})).toBe(3)
    expect(memoConcurrency({ MEMO_CONCURRENCY: '1' })).toBe(1)
    expect(memoConcurrency({ MEMO_CONCURRENCY: '99' })).toBe(8)
    expect(memoConcurrency({ MEMO_CONCURRENCY: '0' })).toBe(1)
    expect(memoConcurrency({ MEMO_CONCURRENCY: 'abc' })).toBe(3)
    expect(memoConcurrency({ MEMO_CONCURRENCY: '2.5' })).toBe(3)
  })
})

describe('heartbeat', () => {
  it('records when the worker was last alive and whether the model answers', async () => {
    await beat({ modelUp: async () => false, waiting: () => 3 })
    const hb = (await db.doc('system/worker').get()).data()!
    expect(hb).toMatchObject({ modelUp: false, waiting: 3 })
    expect(hb.lastSeen.toMillis()).toBeGreaterThan(Date.now() - 60_000)
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

describe('place lookups that finish later', () => {
  const NAGOYA = { place: 'FamilyMart · 도코나메시, 일본', address: '' }

  it('leaves place untouched when the photo has no location yet', async () => {
    await seedPending('m1', { lat: null, lng: null })
    await processMemo('m1', 1, deps())
    const m = await memo('m1')
    expect(m.status).toBe('ready')
    expect(m.place).toBe('')
    expect(m.needsGeocode).toBeUndefined()
  })

  it('asks the geocoder in the patient\'s chosen language', async () => {
    const langs: Array<string | undefined> = []
    const geocode: MemoDeps['geocode'] = async (_lat, _lng, lang) => { langs.push(lang); return { place: '', address: '' } }
    await seedPending('m1')
    await processMemo('m1', 1, deps({ geocode }))
    await db.doc('users/p1').set({ geoLang: 'en' })
    await locateMemo('m1', geocode)
    expect(langs).toEqual(['ko', 'en'])
  })

  it('flags the memo when the geocoder does not answer, then fills it in', async () => {
    await seedPending('m1')
    await processMemo('m1', 1, deps({ geocode: async () => ({ place: '', address: '' }) }))
    expect((await memo('m1')).needsGeocode).toBe(true)

    expect(await locateMemo('m1', async () => ({ place: '', address: '' }))).toBe('retry')
    expect(await locateMemo('m1', async () => ({ place: '서초동, 서초구', address: '서초대로 1' }))).toBe('done')
    const m = await memo('m1')
    expect(m.place).toBe('서초동, 서초구')
    expect(m.needsGeocode).toBeUndefined()
    expect(m.status).toBe('ready')
  })

  it('re-queues a memo written blind once a late location shows a trip', async () => {
    await db.doc('users/p1').set({ patientName: '엄마', home: { lat: 37.48, lng: 127.01 } })
    await seedPending('m1', { lat: null, lng: null })
    await processMemo('m1', 1, deps())
    // The phone attaches its fix after the memo was written.
    await db.doc('memos/m1').update({ lat: 34.86, lng: 136.82, needsGeocode: true })
    expect(await locateMemo('m1', async () => NAGOYA)).toBe('done')
    const m = await memo('m1')
    expect(m.place).toBe(NAGOYA.place)
    expect(m.status).toBe('pending')

    const d = deps({ geocode: async () => NAGOYA })
    await processMemo('m1', 1, d)
    expect(d.lastHints?.homeHint?.away).toBe(true)
    expect((await memo('m1')).status).toBe('ready')
    // Re-written, not re-announced.
    expect(await count('notifications', 'type', 'photo.new')).toBe(0)
  })

  it('does not re-queue for a late location near home, or a hand-edited memo', async () => {
    await db.doc('users/p1').set({ patientName: '엄마', home: { lat: 37.48, lng: 127.01 } })
    await seedPending('near', { lat: null, lng: null })
    await seedPending('edited', { lat: null, lng: null })
    await processMemo('near', 1, deps())
    await processMemo('edited', 1, deps())
    await db.doc('memos/near').update({ lat: 37.49, lng: 127.02, needsGeocode: true })
    await db.doc('memos/edited').update({ lat: 34.86, lng: 136.82, needsGeocode: true, humanEdited: true })
    await locateMemo('near', async () => ({ place: '서초동, 서초구', address: '' }))
    await locateMemo('edited', async () => NAGOYA)
    expect((await memo('near')).status).toBe('ready')
    expect((await memo('edited')).status).toBe('ready')
    expect((await memo('edited')).place).toBe(NAGOYA.place)
  })

  it('uses the time zone the phone reported', async () => {
    await seedPending('m1', { lat: null, lng: null, tzOffsetMin: -420, takenAt: Timestamp.fromDate(new Date('2026-10-04T04:18:00Z')) })
    const d = deps()
    await processMemo('m1', 1, d)
    expect(d.lastHints?.timeHint).toBe('21:18')
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

describe('text in the photo', () => {
  it('keeps readable Korean and English lines only', () => {
    expect(readableText(['Higashi Betsuin Sta.', 'SUBWAY', '비상시 누르세요', '1ㄷ$', '0019-=+1', 'T1', 'SUBWAY']))
      .toEqual(['Higashi Betsuin Sta.', 'SUBWAY', '비상시 누르세요'])
    expect(readableText(undefined)).toEqual([])
  })
  it('shows the model the text as a hint', () => {
    expect(buildPrompt({ textHint: ['Aichi-Nagoya 2026'] })).toContain('"Aichi-Nagoya 2026"')
    expect(buildPrompt()).not.toContain('휴대폰이 사진에서 읽은 글자')
  })
  it('does not split a description at a full stop inside a quoted sign', () => {
    const out = parseModelResponse(JSON.stringify({
      activity: '이동', memo: 'Higashi Betsuin 역 입구',
      scene: "'Higashi Betsuin Sta.'라고 쓰인 간판이 보여요. 지하철 입구예요.",
    }))!
    expect(out.scene).toBe("'Higashi Betsuin Sta.'라고 쓰인 간판이 보여요. 지하철 입구예요.")
  })
  it('drops copied Japanese text from the description and rejects it in the title', () => {
    const out = parseModelResponse(JSON.stringify({
      activity: '기타', memo: '광고판 앞에서', scene: "'また話したく'라고 적혀 있어요. 실내예요.",
    }))!
    expect(out.scene).toBe('실내예요.')
    expect(parseModelResponse('{"activity":"기타","memo":"精神科医 광고 앞","scene":"실내예요."}')).toBeNull()
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
  it('gives the model the area, not the nearest shop name', () => {
    expect(areaOf('리김밥(고터) 김밥 · 센트럴시티, 서초구')).toBe('센트럴시티, 서초구')
    expect(areaOf('서초동, 서초구')).toBe('서초동, 서초구')
    expect(areaOf('')).toBe('')
  })
  it('only steers toward 여행/출장 when far from home', () => {
    expect(buildPrompt({ homeHint: { km: 900, away: true } })).toContain('여행이나 출장 중일 가능성')
    expect(buildPrompt({ homeHint: { km: 1, away: false } })).toContain('집 또는 집 근처')
    expect(buildPrompt()).not.toContain('집과의 거리')
  })
  it('names home and reads work clothes as 출장 only when away', () => {
    const away = buildPrompt({ homeHint: { km: 8000, away: true, homeArea: '팔로알토, 미국' } })
    expect(away).toContain('집(팔로알토, 미국)에서 약 8000km')
    expect(away).toContain('집은 팔로알토, 미국, 지금은 다른 지역이에요')
    expect(away).toContain('정장·넥타이·재킷')
    expect(away).toContain('노트북·서류가 놓인 책상')
    expect(buildPrompt({ homeHint: { km: 900, away: true } })).not.toContain('집은 ')
    expect(buildPrompt({ homeHint: { km: 1, away: false } })).not.toContain('정장')
    expect(buildPrompt({ homeHint: { km: 1, away: false } })).not.toContain('노트북·서류')
  })
  it('reads a suit as 출장 from the tags only when away', () => {
    const suit = { labels: [{ name: 'suit', confidence: 0.9 }], text: [], faceCount: 1 }
    expect(categoryFromTags(suit, true)).toBe('출장')
    expect(categoryFromTags(suit, false)).toBe('기타')
    expect(categoryFromTags({ labels: [{ name: 'suitcase', confidence: 0.9 }], text: [], faceCount: 0 }, true)).toBe('이동')
  })
})
