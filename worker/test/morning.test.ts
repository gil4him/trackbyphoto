// The CEO's 08:00 push (운영실 D13): the sentence, the clock, and once a day.

import { describe, it, expect, beforeEach } from 'vitest'
import { morningText, runMorning, type MorningDeps } from '../src/handlers/morning'
import type { AdminMetrics } from '../src/adminMetrics'
import type { PushMessage } from '../src/handlers/push'
import { db, clearFirestore } from './setup'

describe('morningText', () => {
  it('says yesterday, the queue and new reviews in one breath', () => {
    expect(morningText({ parents: 3, photos: 14, familyReactions: 5 }, 1, 2, 1)).toEqual({
      title: 'Daylie 아침 요약', path: '/admin',
      body: '좋은 아침이에요. 어제 부모님 3분이 사진 14장을 보냈고, 가족 답장은 5개였어요. 새 가족 1곳, 할 일 2건, 새 리뷰 1개.',
    })
    expect(morningText({ parents: 1, photos: 2, familyReactions: 0 }, 0, 0, 0).body).toBe('좋은 아침이에요. 어제 부모님 1분이 사진 2장을 보냈고, 가족 답장은 아직 없었어요. 새 가족 0곳, 할 일 0건.')
    expect(morningText({ parents: 0, photos: 0, familyReactions: 2 }, 0, 1, 0).body).toContain('어제는 사진이 없었고, 가족 답장은 2개였어요.')
    expect(morningText({ parents: 0, photos: 0, familyReactions: 0 }, 0, 0, 0).body).toContain('어제는 보낸 사진도, 가족 답장도 없었어요.')
  })
})

describe('runMorning', () => {
  const metrics = { yesterday: { parents: 2, photos: 6, familyReactions: 1 }, days: [{ signups: 3 }, { signups: 1 }, { signups: 0 }] } as unknown as AdminMetrics
  let sent: { uid: string; message: PushMessage }[]
  let flag = true
  const deps = (over: Partial<MorningDeps> = {}): MorningDeps => ({
    metrics: async () => metrics,
    todo: async () => 2,
    newReviews: async () => 0,
    adminUid: async () => 'admin1',
    push: async (uid, message) => { sent.push({ uid, message }); return 2 },
    flagOn: async () => flag,
    ...over,
  })
  // 2026-10-27 08:10 in Seoul (23:10 UTC the day before).
  const AT_8 = new Date('2026-10-26T23:10:00Z')
  beforeEach(async () => { await clearFirestore(); sent = []; flag = true })

  it('sends once at 8, remembers the day, and logs it', async () => {
    expect(await runMorning(new Date('2026-10-26T22:00:00Z'), deps())).toBe('not-time') // 07:00
    const r = await runMorning(AT_8, deps())
    expect(r).toEqual({ sent: 2, body: '좋은 아침이에요. 어제 부모님 2분이 사진 6장을 보냈고, 가족 답장은 1개였어요. 새 가족 1곳, 할 일 2건.' })
    expect(sent).toEqual([{ uid: 'admin1', message: { title: 'Daylie 아침 요약', body: (r as { body: string }).body, path: '/admin' } }])
    expect((await db.doc('admin_config/dashboard').get()).get('morning')).toMatchObject({ sentDate: '2026-10-27', devices: 2 })
    expect(await runMorning(new Date('2026-10-27T00:30:00Z'), deps())).toBe('sent-already') // 09:30 same day
    expect((await db.collection('admin_log').where('action', '==', 'push.morning').get()).size).toBe(1)
    // Noon and later is no morning; the next day sends again.
    expect(await runMorning(new Date('2026-10-27T03:00:00Z'), deps())).toBe('not-time') // 12:00
    expect(await runMorning(new Date('2026-10-28T04:00:00Z'), deps())).toBe('not-time') // 13:00 next day
    expect(await runMorning(new Date('2026-10-27T23:30:00Z'), deps())).toMatchObject({ sent: 2 }) // 08:30 next day
  })

  it('does nothing while the switch is off, or without an admin account', async () => {
    flag = false
    expect(await runMorning(AT_8, deps())).toBe('off')
    flag = true
    expect(await runMorning(AT_8, deps({ adminUid: async () => null }))).toBe('no-admin')
    expect(sent).toEqual([])
  })

  it('a failed review lookup never holds the push back', async () => {
    const r = await runMorning(AT_8, deps({ newReviews: async () => { throw new Error('store down') } }))
    expect(r).toMatchObject({ sent: 2 })
  })
})
