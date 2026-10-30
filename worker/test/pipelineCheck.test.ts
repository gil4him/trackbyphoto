// The whole path of a photo with this week's additions together: memo, weather,
// notices, the playful line, rotation, the evening notice. One family's days,
// run in order. Storage, the models and pushes are fakes; Firestore is the
// emulator, so nothing here can reach production.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
const weatherAt = vi.hoisted(() => vi.fn(async (_lat: number, _lng: number, _at: Date) => ({ code: 'clear', label: '맑음', tempC: 20 })))
vi.mock('../src/weather', async (orig) => ({ ...(await orig<object>()), weatherAt }))
import { processMemo, type MemoDeps } from '../src/handlers/memo'
import { addFunLine, resetFunLineCache } from '../src/handlers/funLine'
import { rotateMemo } from '../src/handlers/rotate'
import { runDailyNotices } from '../src/handlers/dailyNotice'
import { LlmGenerationError } from '../src/llm/ollama'
import { resetPlansCache } from '../src/plans'
import { resetHomeCache, setTravelGeocoder } from '../src/travel'
import type { PushMessage } from '../src/handlers/push'
import { db, clearFirestore, seedMembership } from './setup'

const PHOTO = 'https://example.test/photo.jpg?token=old'
const at = (s: string) => new Date(`${s}:00Z`)
const LA_HABRA = { lat: 33.93, lng: -117.94 }
const HOME = { lat: 33.87, lng: -117.87 }

interface Written { activity: string; memo: string; scene: string }
function family() {
  const asks: string[] = []
  const pushes: Array<{ uids: string[]; message: PushMessage }> = []
  const queue: Written[] = []
  const deps: MemoDeps = {
    loadPhoto: async () => ({ photoUrl: PHOTO, base64: async () => 'aGk=' }),
    geocode: async () => ({ place: 'La Habra, 미국', address: 'South Beach Boulevard, La Habra, CA' }),
    generate: async () => {
      const w = queue.shift() ?? { activity: '기타', memo: '사진을 찍으셨어요', scene: '장면이에요.' }
      return { ...w, model: 'fake', cost: { promptTokens: 1, outputTokens: 1, totalUSD: 0 } }
    },
    push: async (uids, message) => { pushes.push({ uids, message }); return uids.length },
    funLine: (args) => addFunLine(args, async (prompt) => { asks.push(prompt); return `농담${'가나다라'[asks.length - 1]}호` }),
  }
  return { asks, pushes, queue, deps }
}
const shoot = (id: string, when: string, extra: Record<string, unknown> = {}) => db.doc(`memos/${id}`).set({
  patientUid: 'p1', photoPath: `photos/p1/${id}.jpg`, photoUrl: '', takenAt: Timestamp.fromDate(at(when)), tzOffsetMin: 0,
  ...LA_HABRA, place: '', activity: '기타', memo: '', scene: '', status: 'pending', createdAt: Timestamp.now(), ...extra,
})
const noGps = { lat: null, lng: null }
const memo = async (id: string) => (await db.doc(`memos/${id}`).get()).data()!
const list = (on: string[] = ['p1']) => db.doc('admin_config/funLine').set({ allow: on })
const CHICK = { activity: '식사', memo: '칙필레 매장에 다녀오셨어요', scene: '맑은 화요일 오후예요.' }
const NOODLE = { activity: '식사', memo: '식당에서 일행과 함께 칼국수를 드셨어요', scene: '맑은 수요일 점심이에요.' }

beforeEach(async () => {
  await clearFirestore(); resetPlansCache(); resetFunLineCache(); resetHomeCache(); weatherAt.mockClear()
  setTravelGeocoder(async () => ({ place: '', address: '' }))
  await db.doc('users/p1').set({ patientName: '엄마', accountType: 'managed', home: HOME })
  await seedMembership('p1', 'cg1')
  await list()
})

describe('a photo through the whole path', () => {
  it('memo, weather, notice and the line, with the memo left as written', async () => {
    const f = family(); f.queue.push(CHICK)
    await shoot('a', '2026-10-20T15:00')
    expect(await processMemo('a', 1, f.deps)).toBe('done')
    const m = await memo('a')
    expect(m).toMatchObject({ status: 'ready', ...CHICK, place: 'La Habra, 미국', weather: { label: '맑음' }, funLine: '엄마의 첫 사진이에요. 농담가호' })
    expect(f.asks[0]).toContain('엄마의 첫 사진')
    expect(f.pushes.filter((p) => p.message.data?.type === 'photo.new')).toHaveLength(1)
  })

  it('a photo without a location: that day\'s weather and a comparison, no place written', async () => {
    const f = family(); f.queue.push(CHICK, NOODLE)
    await shoot('a', '2026-10-20T15:00')
    await processMemo('a', 1, f.deps)
    await shoot('b', '2026-10-20T18:00', noGps)
    await processMemo('b', 1, f.deps)
    expect(weatherAt).toHaveBeenLastCalledWith(LA_HABRA.lat, LA_HABRA.lng, at('2026-10-20T18:00'))
    const b = await memo('b')
    expect(b).toMatchObject({ weather: { label: '맑음' }, place: '', funLine: '칙필레 다음은 칼국수. 농담나호' })
    expect(b.lat).toBeNull()
    expect(b.address ?? '').toBe('')
    expect(f.asks[1]).toContain('칙필레 다음은 칼국수.')
  })

  it('the first photo of a day without a location has no weather yet, and still finishes', async () => {
    const f = family()
    await shoot('a', '2026-10-20T07:00', noGps)
    expect(await processMemo('a', 1, f.deps)).toBe('done')
    const a = await memo('a')
    expect(a.status).toBe('ready')
    expect(a.weather).toBeUndefined()
    expect(weatherAt).not.toHaveBeenCalled()
  })

  it('hospital photo: memo as usual, no line, and no joke about it later', async () => {
    const f = family(); f.queue.push({ activity: '병원', memo: '병원 접수처에 방문하셨어요', scene: '맑은 오후예요.' }, { activity: '이동', memo: '차로 이동하셨어요', scene: '병원에 다녀오신 뒤 귀가하셨어요.' })
    await shoot('h', '2026-10-20T13:00')
    await processMemo('h', 1, f.deps)
    await shoot('i', '2026-10-20T20:00')
    await processMemo('i', 1, f.deps)
    expect((await memo('h')).memo).toBe('병원 접수처에 방문하셨어요')
    expect((await memo('h')).funLine).toBeUndefined()
    expect((await memo('i')).funLine).toBeUndefined()
    expect(f.asks).toHaveLength(0)
  })

  it('a rewrite keeps the line and asks for no new one', async () => {
    const f = family(); f.queue.push(CHICK)
    await shoot('a', '2026-10-20T15:00')
    await processMemo('a', 1, f.deps)
    await db.doc('memos/a').update({ status: 'pending' })
    f.queue.push({ activity: '식사', memo: '다시 쓴 메모', scene: '다시 쓴 장면.' })
    expect(await processMemo('a', 1, f.deps)).toBe('done')
    const a = await memo('a')
    expect(a).toMatchObject({ memo: '다시 쓴 메모', funLine: '엄마의 첫 사진이에요. 농담가호' })
    expect(f.asks).toHaveLength(1)
  })

  it('a family member\'s own wording is respected: no line on it', async () => {
    const f = family()
    await shoot('a', '2026-10-20T15:00', { humanEdited: true, memo: '직접 쓴 메모', memoSource: 'human' })
    await processMemo('a', 1, f.deps)
    expect(await memo('a')).toMatchObject({ memo: '직접 쓴 메모', status: 'ready' })
    expect((await memo('a')).funLine).toBeUndefined()
  })

  it('a line that fails never touches the memo or its notice', async () => {
    const f = family(); f.queue.push(CHICK)
    const deps: MemoDeps = { ...f.deps, funLine: async () => { throw new Error('gemini down') } }
    await shoot('a', '2026-10-20T15:00')
    expect(await processMemo('a', 1, deps)).toBe('done')
    expect(await memo('a')).toMatchObject({ status: 'ready', ...CHICK })
    expect(f.pushes.filter((p) => p.message.data?.type === 'photo.new')).toHaveLength(1)
  })

  it('a memo the model could not write gets no line', async () => {
    const f = family()
    const deps: MemoDeps = { ...f.deps, generate: async () => { throw new LlmGenerationError('bad') } }
    await shoot('a', '2026-10-20T15:00')
    await processMemo('a', 99, deps)
    expect((await memo('a')).funLine).toBeUndefined()
    expect(f.asks).toHaveLength(0)
  })

  it('accounts off the list see no change', async () => {
    await list(['someone-else']); resetFunLineCache()
    const f = family(); f.queue.push(CHICK)
    await shoot('a', '2026-10-20T15:00')
    await processMemo('a', 1, f.deps)
    expect(await memo('a')).toMatchObject({ status: 'ready', ...CHICK })
    expect((await memo('a')).funLine).toBeUndefined()
  })

  it('no second ordinary line in a day, however many photos', async () => {
    const f = family()
    await shoot('a', '2026-10-20T08:00'); await processMemo('a', 1, f.deps)
    await shoot('b', '2026-10-20T09:00', { }); await processMemo('b', 1, f.deps)
    await shoot('c', '2026-10-20T10:00', { }); await processMemo('c', 1, f.deps)
    const lines = (await Promise.all(['a', 'b', 'c'].map(memo))).filter((m) => m.funLine)
    expect(lines).toHaveLength(1)
  })
})

describe('with rotation', () => {
  const rotateDeps = {
    load: async () => Buffer.from('jpeg'),
    turn: async (b: Buffer) => b,
    store: async () => 'https://example.test/photo.jpg?token=new',
    thumbOf: async () => 'https://example.test/thumb.jpg?token=new',
  }

  it('turning a photo keeps its memo and its line', async () => {
    const f = family(); f.queue.push(CHICK)
    await shoot('a', '2026-10-20T15:00')
    await processMemo('a', 1, f.deps)
    await db.doc('memos/a').update({ rotation: 90, turned: 90 })
    expect(await rotateMemo('a', rotateDeps)).toBe('done')
    expect(await memo('a')).toMatchObject({ ...CHICK, funLine: '엄마의 첫 사진이에요. 농담가호', turned: 90, photoUrl: 'https://example.test/photo.jpg?token=new' })
    expect((await memo('a')).rotation).toBeUndefined()
  })

  it('a photo turned while its memo was being written keeps the turn and the new link', async () => {
    const f = family(); f.queue.push(CHICK)
    await shoot('a', '2026-10-20T15:00')
    const deps: MemoDeps = { ...f.deps, generate: async (args) => {
      await db.doc('memos/a').update({ rotation: 90, photoUrl: 'https://example.test/turned' })
      return f.deps.generate(args)
    } }
    expect(await processMemo('a', 1, deps)).toBe('done')
    expect(await memo('a')).toMatchObject({ status: 'ready', rotation: 90, photoUrl: 'https://example.test/turned' })
  })
})

describe('the evening', () => {
  const EVENING = new Date('2026-10-20T20:30:00+09:00')
  const elderFake = () => {
    const elder: PushMessage[] = []
    return { elder, pushElder: async (_: string, m: PushMessage) => { elder.push(m); return 1 } }
  }
  it('an empty day: each side its own words, none of the other\'s', async () => {
    const f = family(); const e = elderFake()
    await runDailyNotices(EVENING, { push: f.deps.push!, pushElder: e.pushElder })
    expect(f.pushes[0].message.body).toContain('전화 한 통')
    expect(f.pushes[0].uids).toEqual(['cg1'])
    expect(e.elder[0].body).toContain('가족이 오늘 사진을 기다리고')
    expect(e.elder[0].body).not.toContain('전화')
    expect(f.pushes[0].message.body).not.toContain('기다리고')
  })
  it('a day with a photo through the pipeline: the count, and nothing to the parent', async () => {
    const f = family(); const e = elderFake(); f.queue.push(CHICK)
    await shoot('a', '2026-10-20T01:00')
    await processMemo('a', 1, f.deps)
    f.pushes.length = 0
    await runDailyNotices(EVENING, { push: f.deps.push!, pushElder: e.pushElder })
    expect(f.pushes[0].message.body).toContain('사진 1장')
    expect(e.elder).toHaveLength(0)
  })
})
