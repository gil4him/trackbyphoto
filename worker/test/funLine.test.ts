// 따뜻한 한 줄: every memo gets a line from the approved library, by category,
// without repeating lately, and the memo is left alone. Firestore is the emulator.
import { describe, it, expect, beforeEach } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'
import { addFunLine, chooseLine, resetFunLineCache, type FunMemo } from '../src/handlers/funLine'
import { WARM_LINES, type LineGroup } from '../src/handlers/warmLines'
import { resetPlansCache } from '../src/plans'
import { db, clearFirestore } from './setup'

const m = (over: Partial<FunMemo> = {}): FunMemo => ({ activity: '기타', memo: '사진을 찍으셨어요', scene: '', ...over })
const choose = (current: FunMemo, extra: { memoId?: string; lang?: string; recent?: string[] } = {}) =>
  chooseLine({ memoId: extra.memoId ?? 'a', current, lang: extra.lang, recent: extra.recent ?? [] })
const ids = Array.from({ length: 60 }, (_, i) => `photo${i}`)
const GROUPS = Object.keys(WARM_LINES.ko) as LineGroup[]

describe('the library', () => {
  it('both languages have the same groups and sizes, about 100 lines each', () => {
    for (const g of GROUPS) expect(WARM_LINES.en[g].length).toBe(WARM_LINES.ko[g].length)
    const total = GROUPS.reduce((n, g) => n + WARM_LINES.ko[g].length, 0)
    expect(total).toBeGreaterThanOrEqual(95)
  })

  it('short, no numbers, no repeats inside a group', () => {
    for (const lang of ['ko', 'en'] as const) {
      for (const g of GROUPS) {
        const lines = WARM_LINES[lang][g]
        expect(new Set(lines).size).toBe(lines.length)
        for (const l of lines) {
          expect([...l].length).toBeLessThanOrEqual(lang === 'ko' ? 26 : 60)
          expect(l).not.toMatch(/[0-9]/)
        }
      }
    }
  })

  it('no health, age or looks anywhere', () => {
    const all = (['ko', 'en'] as const).flatMap((lang) => GROUPS.flatMap((g) => [...WARM_LINES[lang][g]]))
    for (const l of all) expect(l).not.toMatch(/건강|회복|아프|나이|연세|외모|얼굴|예쁘|health|recover|illness|sick|\bage\b|pretty|handsome/i)
  })
})

describe('chooseLine', () => {
  it('every ordinary category gets a line from its group or the general ones', () => {
    for (const [activity, group] of [['식사', 'meal'], ['카페', 'cafe'], ['산책', 'outdoors'], ['운동', 'outdoors'], ['자연', 'outdoors'], ['여행', 'going'], ['출장', 'going'], ['이동', 'going'], ['쇼핑', 'shopping'], ['휴식', 'rest'], ['모임', 'together']] as [string, LineGroup][]) {
      const lines = ids.map((memoId) => choose(m({ activity }), { memoId }))
      for (const l of lines) expect([...WARM_LINES.ko[group], ...WARM_LINES.ko.any]).toContain(l)
      expect(lines.some((l) => WARM_LINES.ko[group].includes(l!))).toBe(true)
    }
  })

  it('기타 and an unknown old category use the general lines', () => {
    for (const activity of ['기타', '가족', '']) expect(WARM_LINES.ko.any).toContain(choose(m({ activity })))
  })

  it('hospital and pharmacy photos get only quiet lines, even when only the scene says so', () => {
    for (const memoId of ids) {
      expect(WARM_LINES.ko.quiet).toContain(choose(m({ activity: '병원' }), { memoId }))
      expect(WARM_LINES.ko.quiet).toContain(choose(m({ activity: '이동', scene: '병원에 다녀오신 뒤 귀가하셨어요.' }), { memoId }))
      expect(WARM_LINES.en.quiet).toContain(choose(m({ activity: '기타', memo: 'At the pharmacy counter' }), { memoId, lang: 'en' }))
    }
  })

  it('funeral photos get no line, in either language', () => {
    expect(choose(m({ memo: '장례식장에 다녀오셨어요' }))).toBeNull()
    expect(choose(m({ scene: '빈소에 국화가 놓여 있어요.' }))).toBeNull()
    expect(choose(m({ memo: 'At a funeral service' }), { lang: 'en' })).toBeNull()
  })

  it('English accounts get English lines', () => {
    for (const memoId of ids) expect([...WARM_LINES.en.meal, ...WARM_LINES.en.any]).toContain(choose(m({ activity: '식사' }), { memoId, lang: 'en' }))
  })

  it('a line seen lately is not picked again while others are left', () => {
    const recent = WARM_LINES.ko.any.slice(0, -1)
    for (const memoId of ids) expect(choose(m(), { memoId, recent })).toBe(WARM_LINES.ko.any.at(-1))
  })

  it('still gives a line when every line has been seen', () => {
    expect(WARM_LINES.ko.quiet).toContain(choose(m({ activity: '병원' }), { recent: [...WARM_LINES.ko.quiet] }))
    expect(WARM_LINES.ko.any).toContain(choose(m(), { recent: [...WARM_LINES.ko.any] }))
  })
})

describe('addFunLine', () => {
  const shoot = (id: string, minute: number, extra: Record<string, unknown> = {}) => db.doc(`memos/${id}`).set({
    patientUid: 'p1', takenAt: Timestamp.fromDate(new Date(2026, 9, 20, 12, minute)), memo: '메모', ...extra,
  })
  const args = (memoId = 'a', over: Partial<FunMemo> = {}, lang?: string) => ({ memoId, patientUid: 'p1', current: m(over), lang })
  const line = async (id: string) => (await db.doc(`memos/${id}`).get()).data()?.funLine

  beforeEach(async () => {
    await clearFirestore(); resetPlansCache(); resetFunLineCache()
    await db.doc('admin_config/funLine').set({ allow: ['p1'] })
  })

  it('writes a line on every photo, not once a day', async () => {
    for (const [i, id] of ['a', 'b', 'c', 'd', 'e'].entries()) {
      await shoot(id, i)
      await addFunLine(args(id))
      expect(WARM_LINES.ko.any).toContain(await line(id))
    }
  })

  it('does not repeat among an account\'s last photos', async () => {
    const seen: string[] = []
    for (let i = 0; i < 20; i++) {
      await shoot(`p${i}`, i)
      await addFunLine(args(`p${i}`))
      seen.push(await line(`p${i}`))
    }
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('leaves the memo text alone', async () => {
    await shoot('a', 0)
    await addFunLine(args())
    expect((await db.doc('memos/a').get()).data()?.memo).toBe('메모')
  })

  it('a funeral photo stays without a line', async () => {
    await shoot('a', 0)
    await addFunLine(args('a', { memo: '장례식장에 다녀오셨어요' }))
    expect(await line('a')).toBeUndefined()
  })

  it('off the list and with the flag off, nothing is written', async () => {
    await db.doc('admin_config/funLine').set({ allow: ['someone-else'] }); resetFunLineCache()
    await shoot('a', 0)
    await addFunLine(args())
    expect(await line('a')).toBeUndefined()
  })

  it('with the flag on, everyone gets it', async () => {
    await db.doc('admin_config/funLine').set({ allow: [] }); resetFunLineCache()
    await db.doc('admin_config/plans').set({ flags: { memoFunLine: true } }); resetPlansCache()
    await shoot('a', 0)
    await addFunLine(args())
    expect(WARM_LINES.ko.any).toContain(await line('a'))
  })
})
