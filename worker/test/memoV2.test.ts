// Memo v2: the see() prompt and its parser (no model, no Firestore).
import { describe, it, expect } from 'vitest'
import { buildSeePrompt, buildWritePrompt, parseSeeResponse, parseWriteResponse, STYLE_EXAMPLES, type Seen } from '../src/llm/promptV2'
import { generateMemoV2, WRITE_RETRY_TEMPERATURE, WRITE_TEMPERATURE, type V2Deps, type WriteArgs } from '../src/llm/memoV2'
import { LlmGenerationError, LlmUnavailableError } from '../src/llm/ollama'
import type { ContextData } from '../src/llm/context'

describe('see() prompt', () => {
  it('asks for facts only, with the category list, the sign rules and the situation hints', () => {
    const p = buildSeePrompt({ timeHint: '12:30', placeHint: '서초동, 서초구', homeHint: { km: 1, away: false }, textHint: ['Nagoya'] })
    expect(p).toContain('사실만')
    expect(p).toContain('- 식사: 음식, 식당, 식탁')
    expect(p).toContain('- 기타: 위 어느 것에도 맞지 않을 때만')
    expect(p).toContain('일본어나 한자로 된 글자는')
    expect(p).toContain('광고판')
    expect(p).toContain('- 시간: 12:30')
    expect(p).toContain('- 지역: 서초동, 서초구')
    expect(p).toContain('집 또는 집 근처예요')
    expect(p).toContain('"Nagoya"')
    expect(p).toContain('"peopleCount":0')
    expect(p).not.toContain('된장찌개로 점심 식사')
  })

  it('tells a far-away photo apart', () => {
    const p = buildSeePrompt({ homeHint: { km: 900, away: true, homeArea: '서초구' } })
    expect(p).toContain('집(서초구)에서 약 900km')
    expect(p).toContain('"출장"일 가능성')
  })
})

describe('parseSeeResponse', () => {
  it('reads the facts, snaps the category, trims lists, strips fences', () => {
    const seen = parseSeeResponse('```json\n{"activity":"점심","subjects":["된장찌개","반찬","식탁","숟가락"],"setting":" 집  식탁 ","signText":[],"peopleCount":"2"}\n```')
    expect(seen).toEqual({ activity: '기타', subjects: ['된장찌개', '반찬', '식탁'], setting: '집 식탁', signText: [], peopleCount: 2 })
  })

  it('keeps a known category and drops Japanese/Chinese sign text', () => {
    const seen = parseSeeResponse('{"activity":"이동","subjects":["여행 가방"],"setting":"공항","signText":["Nagoya","名古屋"],"peopleCount":0}')
    expect(seen?.activity).toBe('이동')
    expect(seen?.signText).toEqual(['Nagoya'])
  })

  it('is null for junk, for nothing seen, or for a setting in a foreign script', () => {
    expect(parseSeeResponse('not json')).toBeNull()
    expect(parseSeeResponse('{"activity":"기타","subjects":[],"setting":"","signText":[],"peopleCount":0}')).toBeNull()
    expect(parseSeeResponse('{"activity":"기타","subjects":["간판"],"setting":"名古屋駅","signText":[],"peopleCount":0}')).toBeNull()
  })
})

const SEEN: Seen = { activity: '산책', subjects: ['벚나무', '산책길'], setting: '공원 산책길', signText: ['진해 벚꽃 축제'], peopleCount: 1 }
const HOOKS = [{ id: 'nth', text: '오늘 3번째 사진이에요' }, { id: 'calendar', text: '오늘은 어버이날, 금요일이에요' }]

describe('write() prompt', () => {
  it('gives the facts, the hooks with their ids, the no-repeat rule and the chosen style', () => {
    const p = buildWritePrompt({ seen: SEEN, hooks: HOOKS, recentTitles: ['공원 길을 걸으셨어요', '시장 구경'], style: 'playful', hints: { timeHint: '12:30', placeHint: '서초동, 서초구' } })
    expect(p).toContain('- 활동: 산책')
    expect(p).toContain('- 보이는 것: 벚나무, 산책길')
    expect(p).toContain('- 읽히는 글자: "진해 벚꽃 축제"')
    expect(p).toContain('- 사람: 1명')
    expect(p).toContain('시간 12:30 · 지역 서초동, 서초구')
    expect(p).toContain('- [nth] 오늘 3번째 사진이에요')
    expect(p).toContain('- [calendar] 오늘은 어버이날, 금요일이에요')
    expect(p).toContain('최대 하나만')
    expect(p).toContain('없는 숫자, 지명')
    expect(p).toContain('같은 식으로 시작하지 마세요: "공원 길을 걸으셨어요", "시장 구경"')
    expect(p).toContain('12~24자')
    expect(p).toContain('말투 (재치있게)')
    for (const e of STYLE_EXAMPLES.playful.examples) expect(p).toContain(e)
    expect(p).not.toContain('로 점심 식사')
  })

  it('defaults to the warm style, says when there is nothing to add, and marks a trip', () => {
    const p = buildWritePrompt({ seen: { ...SEEN, subjects: [], signText: [] }, hooks: [], recentTitles: [], style: 'warm', hints: { homeHint: { km: 900, away: true } } })
    expect(p).toContain('말투 (다정하게)')
    expect(p).toContain('- 보이는 것: (없음)')
    expect(p).toContain('- (없음)')
    expect(p).toContain('집에서 약 900km 떨어진 곳')
    expect(p).not.toContain('같은 식으로 시작하지')
    expect(Object.keys(STYLE_EXAMPLES)).toEqual(['plain', 'warm', 'playful'])
  })
})

describe('parseWriteResponse', () => {
  it('reads the memo, trims the scene to three sentences, and the hook id in its variants', () => {
    expect(parseWriteResponse('{"memo":" \\"볕 좋은 날의 공원 산책이에요\\" ","scene":"벚나무가 늘어서 있어요. 공원 길이에요. 축제 현수막이 보여요. 넷째 문장.","hookId":"[nth]"}'))
      .toEqual({ memo: '볕 좋은 날의 공원 산책이에요', scene: '벚나무가 늘어서 있어요. 공원 길이에요. 축제 현수막이 보여요.', hookId: 'nth' })
    expect(parseWriteResponse('```json\n{"memo":"공원 산책","scene":"","hookId":""}\n```')).toEqual({ memo: '공원 산책', scene: '', hookId: null })
    expect(parseWriteResponse('{"memo":"공원 산책","scene":"","hookId":"null"}')?.hookId).toBeNull()
  })

  it('is null without a title, with a foreign script in it, or for junk', () => {
    expect(parseWriteResponse('{"memo":"","scene":"x","hookId":""}')).toBeNull()
    expect(parseWriteResponse('{"memo":"名古屋 산책","scene":"x","hookId":""}')).toBeNull()
    expect(parseWriteResponse('nope')).toBeNull()
  })
})

describe('generateMemoV2', () => {
  const KST = 9 * 60
  const takenAt = new Date('2026-04-05T10:00:00+09:00')
  const cost = { promptTokens: 100, outputTokens: 20, totalUSD: 0 }
  const ctx: ContextData = {
    past: [
      { id: 'a', takenAtMs: takenAt.getTime() - 3600_000, activity: '산책', memo: '아침 공원 한 바퀴', lat: 37.5, lng: 127.0, labels: [] },
      { id: 'b', takenAtMs: takenAt.getTime() - 86_400_000, activity: '산책', memo: '동네 산책길', lat: 37.5, lng: 127.0, labels: [] },
    ],
    style: 'playful',
  }
  const args = { imageBase64: 'aGk=', patientUid: 'p1', coords: { lat: 37.5, lng: 127.0 }, placeHint: '서초동, 서초구', timeHint: '10:00', takenAt, tzOffsetMin: KST, tags: { labels: [{ name: 'Cherry Blossom', confidence: 0.9 }], text: [], faceCount: 0 } }

  function fakes(writes: Array<{ memo: string; scene?: string; hookId?: string | null } | Error>) {
    const calls: { see: number; write: WriteArgs[]; v1: number } = { see: 0, write: [], v1: 0 }
    const deps: V2Deps = {
      see: async () => { calls.see++; return { seen: SEEN, model: 'gemma4:e4b', cost } },
      write: async (a) => {
        calls.write.push(a)
        const next = writes.shift()
        if (!next) throw new Error('no more answers')
        if (next instanceof Error) throw next
        return { memo: next.memo, scene: next.scene ?? '벚나무가 늘어서 있어요. 공원 길이에요.', hookId: next.hookId ?? null, model: 'gemma4:e4b', cost }
      },
      loadContext: async () => ctx,
      offsetMin: async () => KST,
      weather: async () => null,
      v1: async () => { calls.v1++; return { activity: '산책', memo: '공원 산책길', scene: 'v1', model: 'gemma4:e4b', cost } },
    }
    return { deps, calls }
  }

  it('sees, builds the hooks, writes in the family\'s style, and keeps the hook and the facts', async () => {
    const { deps, calls } = fakes([{ memo: '오늘 2번째, 벚꽃 아래 산책', hookId: 'nth' }])
    const r = await generateMemoV2(args, deps)
    expect(r).toMatchObject({ activity: '산책', memo: '오늘 2번째, 벚꽃 아래 산책', source: 'local-llm-v2', memoVersion: 2, hookId: 'nth', seen: SEEN, model: 'gemma4:e4b' })
    expect(r.cost).toEqual({ promptTokens: 200, outputTokens: 40, totalUSD: 0 })
    expect(calls).toMatchObject({ see: 1, v1: 0 })
    const w = calls.write[0]
    expect(w.style).toBe('playful')
    expect(w.temperature).toBe(WRITE_TEMPERATURE)
    expect(w.recentTitles).toEqual(['아침 공원 한 바퀴', '동네 산책길'])
    // Yesterday's walk was at the same spot, so the revisit hook is offered too.
    expect(w.hooks.map((h) => h.id)).toEqual(['nth', 'today', 'streak', 'revisit', 'calendar'])
    expect(w.hints).toEqual({ timeHint: '10:00', placeHint: '서초동, 서초구', homeHint: undefined })
  })

  it('tries once more, looser, when a guard rejects the title', async () => {
    // The head count is a fact the title may use; a place it was not given is not.
    expect((await generateMemoV2(args, fakes([{ memo: '벚꽃길을 걷는 1명' }]).deps)).memo).toBe('벚꽃길을 걷는 1명')
    const { deps, calls } = fakes([{ memo: '잠실동 벚꽃 산책' }, { memo: '벚꽃 아래 공원 산책' }])
    const r = await generateMemoV2(args, deps)
    expect(r.memo).toBe('벚꽃 아래 공원 산책')
    expect(calls.write.map((w) => w.temperature)).toEqual([WRITE_TEMPERATURE, WRITE_RETRY_TEMPERATURE])
    expect(calls.v1).toBe(0)
  })

  it('falls back to v1 when the guards reject both tries, or the writer breaks', async () => {
    const { deps, calls } = fakes([{ memo: '동네 산책길!' }, { memo: '공원에서 벚꽃 12그루' }])
    const r = await generateMemoV2(args, deps)
    expect(r).toMatchObject({ memo: '공원 산책길', source: 'local-llm' })
    expect(r.memoVersion).toBeUndefined()
    expect(calls.v1).toBe(1)
    const broken = fakes([new LlmGenerationError('bad json')])
    expect((await generateMemoV2(args, broken.deps)).source).toBe('local-llm')
  })

  it('passes an unreachable Ollama up, so the photo waits', async () => {
    const { deps } = fakes([])
    deps.see = async () => { throw new LlmUnavailableError('down') }
    await expect(generateMemoV2(args, deps)).rejects.toBeInstanceOf(LlmUnavailableError)
  })
})
