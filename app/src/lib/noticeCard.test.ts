import { describe, it, expect, vi } from 'vitest'
vi.mock('../firebase', () => ({ db: {}, auth: {} }))
import { groupNotices, noticeLine, staleNotices, swipedAway } from './noticeCard'
import type { AppNotification } from '../types'

const at = (ms: number) => ({ toMillis: () => ms })
const n = (id: string, type: string, over: Partial<AppNotification> = {}) =>
  ({ id, type, patientUid: 'mom', recipientUid: 'me', actorUid: '', message: 'm', read: false, ...over }) as AppNotification

describe('the notice card', () => {
  it('merges identical notices, newest first, and keeps different ones apart', () => {
    const g = groupNotices([
      n('a', 'photo.new', { memoId: 'm2', message: '엄마님이 새 사진을 올렸어요' }),
      n('b', 'device.pair', { message: '연결' }),
      n('c', 'photo.new', { memoId: 'm1', message: '엄마님이 새 사진을 올렸어요' }),
      n('d', 'photo.new', { patientUid: 'dad', memoId: 'm3', message: '아버지님이 새 사진을 올렸어요' }),
    ])
    expect(g.map((x) => x.ids)).toEqual([['a', 'c'], ['b'], ['d']])
    expect(g[0].count).toBe(2)
  })

  it('a merged notice stops pointing at one photo unless all point there', () => {
    expect(groupNotices([n('a', 'photo.new', { memoId: 'm2' }), n('b', 'photo.new', { memoId: 'm1' })])[0].notice.memoId).toBeUndefined()
    expect(groupNotices([n('a', 'reaction.comment', { memoId: 'm1' }), n('b', 'reaction.comment', { memoId: 'm1' })])[0].notice.memoId).toBe('m1')
    expect(groupNotices([n('a', 'photo.new', { memoId: 'm2' })])[0].notice.memoId).toBe('m2')
  })

  it('says how many photos, and addresses the parent the app\'s way', () => {
    const two = groupNotices([n('a', 'photo.new'), n('b', 'photo.new')])[0]
    expect(noticeLine(two, '엄마')).toBe('새 사진 2장')
    const one = groupNotices([n('a', 'photo.new', { message: '엄마님이 새 사진을 올렸어요' })])[0]
    expect(noticeLine(one, '엄마')).toBe('엄마가 새 사진을 올렸어요')
    expect(noticeLine(one)).toBe('엄마님이 새 사진을 올렸어요')
  })

  it('a swipe has to go far enough, either way', () => {
    expect(swipedAway(79)).toBe(false)
    expect(swipedAway(80)).toBe(true)
    expect(swipedAway(-120)).toBe(true)
  })
})

describe('a "no photo yet" that stopped being true', () => {
  const now = new Date(2026, 9, 30, 20, 0)
  const today = new Date(2026, 9, 30).getTime()
  const none = () => 0

  it('goes when its day has ended', () => {
    const list = [n('old', 'daily.no_photo', { createdAt: at(today - 1000) as never }), n('new', 'checkin.no_photo', { createdAt: at(today + 1000) as never })]
    expect(staleNotices(list, now, none)).toEqual(['old'])
  })
  it('goes when a photo came today, for that parent only', () => {
    const list = [n('mom', 'daily.no_photo', { createdAt: at(today + 1000) as never }), n('dad', 'daily.no_photo', { patientUid: 'dad', createdAt: at(today + 1000) as never })]
    expect(staleNotices(list, now, (uid) => uid === 'mom' ? today + 5000 : today - 5000)).toEqual(['mom'])
  })
  it('leaves everything else, and a notice still on its way to the server', () => {
    const list = [n('p', 'photo.new', { createdAt: at(0) as never }), n('w', 'daily.no_photo'), n('r', 'daily.no_photo', { read: true, createdAt: at(0) as never })]
    expect(staleNotices(list, now, none)).toEqual([])
  })
})
