// Gemini memos: who is let through, falling back to the local model, the
// cloud prompt, and place labels abroad. Gemini itself is a local fake server.

import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Timestamp } from 'firebase-admin/firestore'
import { CloudLlmError, CLOUD_MODEL, generateMemoGemini } from '../src/llm/gemini'
import { cloudMemoAllowed, generateMemoRouted, resetCloudCache, type MemoArgs, type RouteDeps } from '../src/llm/route'
import { LlmGenerationError, type LlmResult } from '../src/llm/ollama'
import { buildPrompt, parseModelResponse } from '../src/llm/prompt'
import { nominatimPlace } from '../src/geocode'
import { mimeFromPath, processMemo, type MemoDeps } from '../src/handlers/memo'
import { resetPlansCache } from '../src/plans'
import { resetHomeCache } from '../src/travel'
import { db, clearFirestore } from './setup'

const ARGS: MemoArgs = { imageBase64: 'aGk=', patientUid: 'p1', placeHint: '신주쿠구, 일본' }
const result = (over: Partial<LlmResult> = {}): LlmResult => ({
  activity: '여행', memo: '신주쿠역 근처 밤거리', scene: '밤거리예요.', model: 'm', cost: { promptTokens: 1, outputTokens: 1, totalUSD: 0 }, ...over,
})

describe('the cloud prompt', () => {
  const hints = { placeHint: '니시신주쿠, 신주쿠구, 일본', placeFull: 'くら寿司 · 니시신주쿠, 신주쿠구, 일본', coords: { lat: 35.694, lng: 139.6988 } }

  it('leaves the local prompt as it was: no Japanese, no shop name, no coordinates', () => {
    const p = buildPrompt(hints)
    expect(p).toContain('일본어나 한자로 된 글자는 옮겨 적거나 번역하지 말고')
    expect(p).not.toContain('くら寿司')
    expect(p).not.toContain('좌표')
  })

  it('lets Gemini read Japanese, gives it the nearest place and coordinates, and forbids made-up shop names', () => {
    const p = buildPrompt(hints, 'cloud')
    expect(p).not.toContain('옮겨 적거나 번역하지 말고')
    expect(p).toContain('"新宿駅" → "신주쿠역"')
    expect(p).toContain('- 지도에서 가장 가까운 곳: くら寿司 · 니시신주쿠, 신주쿠구, 일본')
    expect(p).toContain('- 좌표: 35.69400, 139.69880')
    expect(p).toContain('가게·건물 이름은 사진에서 읽히거나')
  })

  it('says when the place was borrowed from a photo taken minutes apart', () => {
    const p = buildPrompt({ placeHint: '나고야시, 일본', nearHint: true }, 'cloud')
    expect(p).toContain('- 지역: 나고야시, 일본 근처')
    expect(p).not.toContain('지도에서 가장 가까운 곳')
  })

  it('keeps a Gemini memo with a stray kana instead of failing it', () => {
    const raw = JSON.stringify({ activity: '여행', memo: 'くら 회전초밥 앞에서', scene: 'くら寿司 간판이 보여요. 밤거리예요.' })
    expect(parseModelResponse(raw)).toBeNull()
    expect(parseModelResponse(raw, { relaxed: true })?.scene).toBe('くら寿司 간판이 보여요. 밤거리예요.')
  })
})

describe('place labels abroad', () => {
  it('keeps the neighbourhood and the country', () => {
    expect(nominatimPlace({ address: { quarter: '니시신주쿠', city: '신주쿠구', country: '일본', country_code: 'jp' } })?.place)
      .toBe('니시신주쿠, 신주쿠구, 일본')
    expect(nominatimPlace({ address: { shop: 'FamilyMart', city: '도코나메시', country: '일본', country_code: 'jp' } })?.place)
      .toBe('FamilyMart · 도코나메시, 일본')
  })

  it('does not call a place after the street it is on', () => {
    const r = nominatimPlace({ name: 'かえで通り', address: { road: 'かえで通り', suburb: '中町', city: '아쓰기시', country: '일본', country_code: 'jp' } })
    expect(r?.place).toBe('中町, 아쓰기시, 일본')
  })

  it('writes a US street address with the two-letter state', () => {
    const r = nominatimPlace({ address: {
      house_number: '350', road: '5th Avenue', city: 'New York', state: 'New York',
      'ISO3166-2-lvl4': 'US-NY', country: 'United States', country_code: 'us',
    } })
    expect(r?.address).toBe('350 5th Avenue, New York, NY')
    // Elsewhere the state keeps its name.
    expect(nominatimPlace({ address: { road: 'Main St', city: 'Toronto', state: 'Ontario', 'ISO3166-2-lvl4': 'CA-ON', country_code: 'ca' } })?.address)
      .toBe('Main St, Toronto, Ontario')
  })

  it('leaves Korean labels as they were', () => {
    expect(nominatimPlace({ address: { suburb: '반포동', borough: '서초구', country_code: 'kr' } })?.place).toBe('반포동, 서초구')
  })
})

describe('the photo type', () => {
  it('comes from the file name, JPEG when unsure', () => {
    expect(mimeFromPath('photos/p/1.jpg')).toBe('image/jpeg')
    expect(mimeFromPath('photos/p/1.HEIC')).toBe('image/heic')
    expect(mimeFromPath('photos/p/1.png')).toBe('image/png')
    expect(mimeFromPath('photos/p/1')).toBe('image/jpeg')
  })
})

describe('choosing the model', () => {
  function route(allowed: boolean, cloud: RouteDeps['cloud']) {
    const calls = { cloud: 0, local: 0 }
    const deps: RouteDeps = {
      allowed: async () => allowed,
      cloud: async (a) => { calls.cloud++; return cloud(a) },
      local: async () => { calls.local++; return result({ model: 'gemma4:e4b' }) },
    }
    return { deps, calls }
  }

  it('never sends the photo to Gemini for someone not let through', async () => {
    const { deps, calls } = route(false, async () => result({ source: 'cloud-llm' }))
    const r = await generateMemoRouted(ARGS, deps)
    expect(calls).toEqual({ cloud: 0, local: 1 })
    expect(r.source).toBe('local-llm')
  })

  it('uses Gemini for someone let through', async () => {
    const { deps, calls } = route(true, async () => result({ source: 'cloud-llm', model: CLOUD_MODEL }))
    const r = await generateMemoRouted(ARGS, deps)
    expect(calls).toEqual({ cloud: 1, local: 0 })
    expect(r.source).toBe('cloud-llm')
  })

  it('writes with the local model when Gemini fails', async () => {
    const { deps, calls } = route(true, async () => { throw new CloudLlmError('HTTP 503') })
    const r = await generateMemoRouted(ARGS, deps)
    expect(calls).toEqual({ cloud: 1, local: 1 })
    expect(r.source).toBe('local-llm')
  })

  it('keeps the local model\'s own errors as they are', async () => {
    const deps: RouteDeps = { allowed: async () => false, cloud: async () => result(), local: async () => { throw new LlmGenerationError('bad json') } }
    await expect(generateMemoRouted(ARGS, deps)).rejects.toBeInstanceOf(LlmGenerationError)
  })
})

describe('who is let through', () => {
  const key = process.env.GEMINI_API_KEY
  beforeEach(async () => { await clearFirestore(); resetPlansCache(); resetCloudCache(); process.env.GEMINI_API_KEY = 'test-key' })
  afterAll(() => { if (key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = key })

  it('nobody while the switch is off and the list is empty', async () => {
    await db.doc('admin_config/plans').set({ flags: { cloudMemo: false } })
    expect(await cloudMemoAllowed('p1')).toBe(false)
  })

  it('only the people on the list while the switch is off', async () => {
    await db.doc('admin_config/cloudLlm').set({ allow: ['p1'] })
    expect(await cloudMemoAllowed('p1')).toBe(true)
    expect(await cloudMemoAllowed('p2')).toBe(false)
  })

  it('everyone once the switch is on', async () => {
    await db.doc('admin_config/plans').set({ flags: { cloudMemo: true } })
    expect(await cloudMemoAllowed('p2')).toBe(true)
  })

  it('nobody without a key, whatever the switch says', async () => {
    delete process.env.GEMINI_API_KEY
    await db.doc('admin_config/plans').set({ flags: { cloudMemo: true } })
    await db.doc('admin_config/cloudLlm').set({ allow: ['p1'] })
    expect(await cloudMemoAllowed('p1')).toBe(false)
  })
})

describe('the Gemini call', () => {
  let server: Server
  let reply: (body: Record<string, unknown>) => { status: number; json?: unknown; delayMs?: number }
  let last: { url: string; key: string; body: Record<string, unknown> } | null = null
  const env = { base: process.env.GEMINI_BASE_URL, key: process.env.GEMINI_API_KEY }

  beforeAll(async () => {
    server = createServer((req, res) => {
      let data = ''
      req.on('data', (c) => { data += c })
      req.on('end', () => {
        const body = JSON.parse(data || '{}')
        last = { url: req.url ?? '', key: String(req.headers['x-goog-api-key'] ?? ''), body }
        const r = reply(body)
        setTimeout(() => { res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.json ?? {})) }, r.delayMs ?? 0)
      })
    })
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
    process.env.GEMINI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    process.env.GEMINI_API_KEY = 'test-key'
  })
  afterAll(async () => {
    await new Promise((ok) => server.close(ok))
    for (const [k, v] of [['GEMINI_BASE_URL', env.base], ['GEMINI_API_KEY', env.key]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v
    }
  })

  const answer = (text: string) => ({
    status: 200,
    json: { candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 60, thoughtsTokenCount: 40 } },
  })

  it('sends the photo with the cloud prompt and reads the memo and its cost', async () => {
    reply = () => answer(JSON.stringify({ activity: '여행', memo: '신주쿠역 근처 밤거리', scene: '밤거리예요.' }))
    const r = await generateMemoGemini({ ...ARGS, mimeType: 'image/jpeg', coords: { lat: 35.694, lng: 139.6988 } })
    expect(last?.url).toBe(`/v1beta/models/${CLOUD_MODEL}:generateContent`)
    expect(last?.key).toBe('test-key')
    const parts = (last?.body.contents as Array<{ parts: Array<Record<string, any>> }>)[0].parts
    expect(parts[0].inline_data).toEqual({ mime_type: 'image/jpeg', data: 'aGk=' })
    expect(parts[1].text).toContain('- 좌표: 35.69400, 139.69880')
    expect((last?.body.generationConfig as Record<string, unknown>).responseMimeType).toBe('application/json')
    expect(r).toMatchObject({ memo: '신주쿠역 근처 밤거리', source: 'cloud-llm', model: CLOUD_MODEL })
    // 2000 in at $0.25/M + (60 + 40 thinking) out at $1.50/M.
    expect(r.cost.totalUSD).toBeCloseTo(0.0005 + 0.00015, 8)
    expect(r.cost.outputTokens).toBe(100)
  })

  it('turns an error, a refusal or nonsense into one CloudLlmError', async () => {
    reply = () => ({ status: 503, json: { error: { message: 'overloaded' } } })
    await expect(generateMemoGemini({ ...ARGS, mimeType: 'image/jpeg' })).rejects.toBeInstanceOf(CloudLlmError)
    reply = () => ({ status: 200, json: { candidates: [{ finishReason: 'SAFETY' }] } })
    await expect(generateMemoGemini({ ...ARGS, mimeType: 'image/jpeg' })).rejects.toBeInstanceOf(CloudLlmError)
    reply = () => answer('not json')
    await expect(generateMemoGemini({ ...ARGS, mimeType: 'image/jpeg' })).rejects.toBeInstanceOf(CloudLlmError)
  })
})

describe('memos written through the router', () => {
  beforeEach(async () => { await clearFirestore(); resetHomeCache() })

  const seed = (id: string, extra: Record<string, unknown> = {}) => db.doc(`memos/${id}`).set({
    patientUid: 'p1', photoPath: `photos/p1/${id}.jpg`, photoUrl: '', takenAt: Timestamp.fromDate(new Date('2026-10-06T11:39:00Z')),
    lat: 35.694, lng: 139.6988, place: '', activity: '기타', memo: '', scene: '', status: 'pending', createdAt: Timestamp.now(), ...extra,
  })
  function deps(source: 'cloud-llm' | 'local-llm') {
    const d = {
      last: null as MemoArgs | null,
      loadPhoto: async () => ({ photoUrl: 'https://example.test/p.jpg', base64: async () => 'aGk=' }),
      geocode: async () => ({ place: 'くら寿司 · 니시신주쿠, 신주쿠구, 일본', address: '' }),
      generate: async (a: MemoArgs) => { d.last = a; return result({ source, model: source === 'cloud-llm' ? CLOUD_MODEL : 'gemma4:e4b' }) },
    }
    return d as MemoDeps & { last: MemoArgs | null }
  }

  it('records that Gemini wrote it, and hands over who, the full place and the coordinates', async () => {
    await seed('m1')
    const d = deps('cloud-llm')
    await processMemo('m1', 1, d)
    const m = (await db.doc('memos/m1').get()).data()!
    expect(m.memoSource).toBe('cloud-llm')
    expect(m.model).toBe(CLOUD_MODEL)
    expect(d.last).toMatchObject({ patientUid: 'p1', mimeType: 'image/jpeg', placeFull: 'くら寿司 · 니시신주쿠, 신주쿠구, 일본', coords: { lat: 35.694, lng: 139.6988 } })
    expect(d.last?.placeHint).toBe('니시신주쿠, 신주쿠구, 일본')
  })

  it('borrows the place of a photo taken minutes apart as a hint, writing none of it down', async () => {
    await seed('near', { status: 'ready', place: 'FamilyMart · 도코나메시, 일본', lat: 34.86, lng: 136.82, takenAt: Timestamp.fromDate(new Date('2026-10-06T11:30:00Z')) })
    await seed('far', { status: 'ready', place: '먼 곳, 일본', lat: 35, lng: 135, takenAt: Timestamp.fromDate(new Date('2026-10-06T10:00:00Z')) })
    await seed('m1', { lat: null, lng: null })
    const d = deps('local-llm')
    await processMemo('m1', 1, d)
    expect(d.last?.placeHint).toBe('도코나메시, 일본')
    expect(d.last?.nearHint).toBe(true)
    expect(d.last?.coords).toBeUndefined()
    const m = (await db.doc('memos/m1').get()).data()!
    expect(m.lat).toBeNull()
    expect(m.place).toBe('')
  })
})
