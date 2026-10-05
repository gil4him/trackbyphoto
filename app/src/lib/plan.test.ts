// What the plan sheet says. The plan contents below are made up for the tests.
import { describe, it, expect } from 'vitest'
import {
  albumMonths, daysUntilOldestGoes, fromTier, keptFor, offered, planLines, reasonLine, shortensKeeping, suggestedTier,
} from './plan'
import { PLANS } from './plan.fixture'
import type { Plans, Reaction } from '../types'

const DAY = 24 * 3600 * 1000

describe('plan cards', () => {
  it('say what each plan gives the family, from the plans table', () => {
    expect(planLines(PLANS.free, '어머니', PLANS.flags)).toEqual(['앱 알림 + 이메일 요약', '가족 1명', '9일 보관'])
    expect(planLines(PLANS.basic, '어머니', PLANS.flags)).toEqual(['매일 카카오톡 요약', '어머니 음성 답장 듣기', '가족 2명', '45일 보관'])
    expect(planLines(PLANS.family, '어머니', PLANS.flags)).toEqual([
      '매일 카카오톡 요약', '어머니 음성 답장 듣기', '주간 하이라이트', '“오늘 사진 없음” 안심 알림', '월간 AI 앨범', '목소리 앨범', '부모님 2분', '가족 6명', '평생 보관',
    ])
  })

  it('never turn a photo allowance into words', () => {
    for (const t of ['free', 'basic', 'plus', 'family'] as const) {
      const text = planLines(PLANS[t], '어머니', PLANS.flags).join(' ')
      expect(text).not.toMatch(/37|411|\d\s*장|AI 메모|하루에/)
    }
  })

  it('promise nothing that is not switched on yet', () => {
    const lines = planLines(PLANS.family, '어머니', {})
    expect(lines).toEqual(['앱 알림', '부모님 2분', '가족 6명', '평생 보관'])
  })

  it('name how long photos are kept', () => {
    expect([keptFor(7), keptFor(30), keptFor(365), keptFor(730), keptFor(400), keptFor(null)]).toEqual(['7일', '30일', '1년', '2년', '400일', '평생'])
  })
})

describe('why the sheet opened', () => {
  it('points at the plan with room for one more family member', () => {
    expect(suggestedTier(PLANS, 'free', { kind: 'family', limit: 1 })).toBe('basic')
    expect(suggestedTier(PLANS, 'basic', { kind: 'family', limit: 2 })).toBe('family')
    expect(suggestedTier(PLANS, 'family', { kind: 'family', limit: 6 })).toBeNull()
    // The worker's answer wins when it sent one.
    expect(suggestedTier(PLANS, 'free', { kind: 'family', limit: 1, nextTier: 'plus' })).toBe('plus')
    expect(reasonLine({ kind: 'family', limit: 1 }, '어머니', 'basic')).toBe('가족 1명까지 함께 볼 수 있어요. 더 초대하려면 Basic이 필요해요')
    expect(reasonLine({ kind: 'family', limit: 6 }, '어머니', null)).toBe('가족 6명까지 함께 볼 수 있어요.')
  })

  it('points at the first plan with voice replies, and says how many are waiting', () => {
    expect(suggestedTier(PLANS, 'free', { kind: 'voice', count: 3 })).toBe('basic')
    expect(reasonLine({ kind: 'voice', count: 3 }, '어머니', 'basic')).toBe('어머니가 남긴 답장 3개가 기다리고 있어요')
    expect(reasonLine({ kind: 'voice', count: 0 }, '어머니', 'basic')).toBe('어머니 목소리로 답장을 받아보세요')
  })

  it('points at the plan that keeps photos longer, with the notice\'s own words', () => {
    expect(suggestedTier(PLANS, 'free', { kind: 'retention', message: 'x' })).toBe('basic')
    expect(suggestedTier(PLANS, 'plus', { kind: 'retention', message: 'x' })).toBe('family')
    expect(suggestedTier(PLANS, 'family', { kind: 'retention', message: 'x' })).toBeNull()
    expect(reasonLine({ kind: 'retention', message: '이번 주에 사진 24장이 지워져요.' }, '어머니', 'basic')).toBe('이번 주에 사진 24장이 지워져요.')
  })

  it('points nowhere from 설정', () => {
    expect(suggestedTier(PLANS, 'free', { kind: 'settings' })).toBeNull()
    expect(reasonLine({ kind: 'settings' }, '어머니', null)).toBe('')
  })
})

describe('what is kept', () => {
  const now = Date.UTC(2026, 9, 5)
  const memory = { count: 312, oldestMs: now - 3 * DAY }
  const base = { memory, retentionDays: 9, retentionOn: true, planSinceMs: now - 100 * DAY, nowMs: now }

  it('counts the days until the oldest photo goes', () => {
    expect(daysUntilOldestGoes(base)).toBe(6)
    expect(daysUntilOldestGoes({ ...base, memory: { count: 1, oldestMs: now - 20 * DAY } })).toBe(0)
  })

  it('gives a changed plan its week first', () => {
    expect(daysUntilOldestGoes({ ...base, memory: { count: 1, oldestMs: now - 20 * DAY }, planSinceMs: now - 2 * DAY })).toBe(5)
  })

  it('says nothing about deleting when nothing will be deleted', () => {
    expect(daysUntilOldestGoes({ ...base, retentionOn: false })).toBeNull()
    expect(daysUntilOldestGoes({ ...base, retentionDays: null })).toBeNull()
    // Nobody has put this parent on a plan: such an account keeps everything.
    expect(daysUntilOldestGoes({ ...base, planSinceMs: undefined })).toBeNull()
    expect(daysUntilOldestGoes({ ...base, memory: { count: 0, oldestMs: null } })).toBeNull()
  })

  it('knows when a change of plan would let kept photos go', () => {
    expect(shortensKeeping(PLANS, true, 'plus', 'basic')).toBe(true)
    expect(shortensKeeping(PLANS, true, 'family', 'plus')).toBe(true)
    expect(shortensKeeping(PLANS, true, 'basic', 'plus')).toBe(false)
    expect(shortensKeeping(PLANS, true, 'basic', 'family')).toBe(false)
    // An account nobody put on a plan keeps everything, so any plan with a period shortens it.
    expect(shortensKeeping(PLANS, false, 'free', 'basic')).toBe(true)
    expect(shortensKeeping(PLANS, false, 'free', 'family')).toBe(false)
    expect(shortensKeeping({ ...PLANS, flags: { ...PLANS.flags, retentionJob: false } }, true, 'plus', 'basic')).toBe(false)
  })
})

describe('목소리 앨범', () => {
  const v = (id: string, at: Date, over: Partial<Reaction> = {}): Reaction => ({
    id, memoId: `m-${id}`, patientUid: 'p1', actorUid: 'p1', actorName: '어머니', kind: 'voice', status: 'ready',
    audioUrl: `https://example.test/${id}.webm`, createdAtMs: at.getTime(), ...over,
  })

  it('groups the parent\'s playable replies by month, newest first', () => {
    const months = albumMonths([
      v('a', new Date(2026, 8, 3, 9)),
      v('b', new Date(2026, 9, 4, 15, 41)),
      v('c', new Date(2026, 9, 1, 8)),
      v('pending', new Date(2026, 9, 2), { status: 'pending', audioUrl: undefined }),
      v('heart', new Date(2026, 9, 2), { kind: 'heart' }),
      v('family', new Date(2026, 9, 2), { actorUid: 'cg1' }),
    ], 'p1')
    expect(months.map((m) => [m.label, m.items.map((r) => r.id)])).toEqual([
      ['2026년 10월', ['b', 'c']],
      ['2026년 9월', ['a']],
    ])
  })
})

describe('a table that offers three plans', () => {
  // Basic left out, and nobody includes messenger delivery.
  const { basic: _gone, ...rest } = PLANS
  void _gone
  const THREE: Plans = {
    ...rest,
    plus: { ...PLANS.plus, familyMembers: 3, messenger: false },
    family: { ...PLANS.family, messenger: false },
  }

  it('offers only the plans in the table, lowest first', () => {
    expect(offered(PLANS)).toEqual(['free', 'basic', 'plus', 'family'])
    expect(offered(THREE)).toEqual(['free', 'plus', 'family'])
  })

  it('points each upgrade moment at the next plan there is', () => {
    expect(suggestedTier(THREE, 'free', { kind: 'family', limit: 1 })).toBe('plus')
    expect(suggestedTier(THREE, 'free', { kind: 'retention', message: 'x' })).toBe('plus')
    expect(suggestedTier(THREE, 'plus', { kind: 'retention', message: 'x' })).toBe('family')
    // Someone still on the plan that is gone is pointed upwards as well.
    expect(suggestedTier(THREE, 'basic', { kind: 'family', limit: 2 })).toBe('plus')
  })

  it('names the lowest plan that includes a feature, or none', () => {
    expect(fromTier(PLANS, 'messenger')).toBe('Basic')
    expect(fromTier(PLANS, 'weekly')).toBe('Plus')
    expect(fromTier(THREE, 'weekly')).toBe('Plus')
    expect(fromTier(THREE, 'recap')).toBe('Family')
    expect(fromTier(THREE, 'messenger')).toBeNull()
    expect(fromTier(null, 'weekly')).toBeNull()
  })

  it('promises e-mail only while e-mail delivery is switched on', () => {
    expect(planLines(THREE.free!, '어머니', { digest: true, emailDigest: true })[0]).toBe('앱 알림 + 이메일 요약')
    expect(planLines(THREE.free!, '어머니', { digest: true })[0]).toBe('매일 하루 요약')
    expect(planLines(THREE.free!, '어머니', {})[0]).toBe('앱 알림')
  })

  it('never promises KakaoTalk when no plan includes it', () => {
    const flags = { ...PLANS.flags, digest: true }
    for (const t of offered(THREE)) expect(planLines(THREE[t]!, '어머니', flags).join(' ')).not.toContain('카카오톡')
  })
})
