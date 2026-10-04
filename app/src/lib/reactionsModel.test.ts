import { describe, it, expect } from 'vitest'
import { byMemo, elderNews, myHeart, replyTarget } from './reactionsModel'
import { subject } from './strings'
import type { Reaction } from '../types'

const NOW = new Date(2026, 9, 4, 15, 0).getTime()
const HOUR = 3_600_000

function r(id: string, over: Partial<Reaction> = {}): Reaction {
  return {
    id, memoId: 'm1', patientUid: 'p1', actorUid: 'cg1', actorName: '민수', kind: 'heart',
    status: 'ready', createdAtMs: NOW - HOUR, ...over,
  }
}
const read = { readByElderAt: {} as Reaction['readByElderAt'] }

describe('elderNews', () => {
  it('is none when family has not reacted today', () => {
    expect(elderNews([], 'p1', NOW).state).toBe('none')
    expect(elderNews([r('old', { ...read, createdAtMs: NOW - 30 * HOUR })], 'p1', NOW).state).toBe('none')
  })

  it('shows the newest unread comment ahead of hearts', () => {
    const news = elderNews([
      r('h', { createdAtMs: NOW - 60_000 }),
      r('c1', { kind: 'comment', text: '먼저', createdAtMs: NOW - 3 * HOUR }),
      r('c2', { kind: 'comment', text: '나중', createdAtMs: NOW - 2 * HOUR }),
    ], 'p1', NOW)
    expect(news).toMatchObject({ state: 'new', item: { id: 'c2' } })
    expect(news.state === 'new' && news.unreadIds.sort()).toEqual(['c1', 'c2', 'h'])
  })

  it('still shows unread news from an earlier day', () => {
    expect(elderNews([r('h', { createdAtMs: NOW - 40 * HOUR })], 'p1', NOW)).toMatchObject({ state: 'new', item: { id: 'h' } })
  })

  it('keeps showing today\'s news after it was read', () => {
    expect(elderNews([r('h', read)], 'p1', NOW)).toMatchObject({ state: 'seen', item: { id: 'h' }, unreadIds: [] })
  })

  it('ignores the parent\'s own replies', () => {
    expect(elderNews([r('mine', { actorUid: 'p1' }), r('v', { actorUid: 'p1', kind: 'voice' })], 'p1', NOW).state).toBe('none')
  })
})

describe('byMemo / myHeart', () => {
  it('groups by memo, oldest first', () => {
    const map = byMemo([r('b', { createdAtMs: 2 }), r('a', { createdAtMs: 1 }), r('x', { memoId: 'm2' })])
    expect(map.get('m1')!.map((i) => i.id)).toEqual(['a', 'b'])
    expect(map.get('m2')!.length).toBe(1)
  })
  it('finds my own heart only', () => {
    const items = [r('h1'), r('h2', { actorUid: 'cg2' }), r('c', { kind: 'comment' })]
    expect(myHeart(items, 'cg2')?.id).toBe('h2')
    expect(myHeart(items, 'cg3')).toBeUndefined()
  })
})

describe('replyTarget', () => {
  it('is null until family reacts to the photo', () => {
    expect(replyTarget([], 'p1')).toBeNull()
    expect(replyTarget([r('mine', { actorUid: 'p1' })], 'p1')).toBeNull()
  })
  it('answers the newest comment, else the newest heart, and lists what is unread', () => {
    const items = [
      r('h', { createdAtMs: NOW }),
      r('c1', { kind: 'comment', createdAtMs: NOW - 2 * HOUR, ...read }),
      r('c2', { kind: 'comment', createdAtMs: NOW - HOUR }),
    ]
    expect(replyTarget(items, 'p1')).toMatchObject({ item: { id: 'c2' }, unreadIds: ['h', 'c2'] })
    expect(replyTarget([r('h1', { createdAtMs: 1 }), r('h2', { createdAtMs: 2 })], 'p1')?.item.id).toBe('h2')
  })
})

describe('subject particle', () => {
  it('picks 이 or 가 from the last syllable', () => {
    expect(subject('민수')).toBe('민수가')
    expect(subject('지은')).toBe('지은이')
    expect(subject('Shawn')).toBe('Shawn가')
  })
})
