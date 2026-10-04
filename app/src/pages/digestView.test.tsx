// The digest page's content and its link, rendered without a browser.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../firebase', () => ({ db: {}, auth: {} }))

import { DigestView } from './DigestPage'
import { digestIdFromPath, placesVisited, repliesSummary } from '../lib/digest'
import type { Digest, Memo } from '../types'

const memo = (id: string, place: string): Memo =>
  ({ id, patientUid: 'p1', photoUrl: `https://example.test/${id}.jpg`, memo: '공원 산책길', place, status: 'ready' }) as unknown as Memo

const digest: Digest = {
  id: 'p1_daily_20261003',
  patientUid: 'p1',
  patientName: '어머니',
  kind: 'daily',
  label: '10월 3일 토요일',
  summary: '오전에 공원을 산책하고 시장에 다녀오셨어요. 점심은 집에서 된장찌개를 드셨어요.',
  memoIds: ['m1', 'm2', 'm3'],
  photoCount: 12,
  replies: { hearts: 1, voices: 1, transcripts: ['괜찮아, 오늘 많이 걸었어'] },
}
const render = (el: Parameters<typeof renderToString>[0]) => renderToString(el).replace(/<!-- -->/g, '')
const memos = [memo('m1', '서초동, 서초구'), memo('m2', '리김밥 · 서초동, 서초구'), memo('m3', '방배동, 서초구')]

describe('DigestView', () => {
  it('shows the date, the summary, the photos, the replies and the footer', () => {
    const out = render(<DigestView digest={digest} memos={memos} onOpenMemo={() => {}} onMore={() => {}} />)
    expect(out).toContain('10월 3일 토요일')
    expect(out).toContain('어머니님의 오늘 하루')
    expect(out).toContain('오전에 공원을 산책하고 시장에 다녀오셨어요.')
    expect(out.match(/class="dg-tile"/g)?.length).toBe(3)
    expect(out).toContain('9장 더 보기')
    expect(out).toContain('어머니님의 답장')
    expect(out).toContain('하트 1개 · 음성 답장 1개')
    expect(out).toContain('괜찮아, 오늘 많이 걸었어')
    expect(out).toContain('서초동 → 방배동')
    expect(out).toContain('오늘하루 · Daylie AI')
  })

  it('leaves out what a quiet day does not have', () => {
    const quiet: Digest = { ...digest, photoCount: 3, replies: { hearts: 0, voices: 0, transcripts: [] } }
    const out = render(<DigestView digest={quiet} memos={memos} onOpenMemo={() => {}} onMore={() => {}} />)
    expect(out).not.toContain('더 보기')
    expect(out).not.toContain('답장')
  })

  it('titles a weekly highlight and a monthly album', () => {
    expect(render(<DigestView digest={{ ...digest, kind: 'weekly' }} memos={[]} onOpenMemo={() => {}} onMore={() => {}} />)).toContain('이번 주 하이라이트')
    expect(render(<DigestView digest={{ ...digest, kind: 'monthly' }} memos={[]} onOpenMemo={() => {}} onMore={() => {}} />)).toContain('지난달 앨범')
  })
})

describe('digest helpers', () => {
  it('reads the digest id from a link, and nothing else', () => {
    expect(digestIdFromPath('/digest/p1_daily_20261003')).toBe('p1_daily_20261003')
    expect(digestIdFromPath('/digest/p1_daily_20261003/')).toBe('p1_daily_20261003')
    expect(digestIdFromPath('/')).toBeNull()
    expect(digestIdFromPath('/digest/')).toBeNull()
    expect(digestIdFromPath('/digest/a/b')).toBeNull()
    expect(digestIdFromPath('/pair')).toBeNull()
  })

  it('lists places in order without repeating a stay', () => {
    expect(placesVisited(memos)).toEqual(['서초동', '방배동'])
    expect(placesVisited([memo('a', ''), memo('b', '서초동'), memo('c', '방배동'), memo('d', '서초동')])).toEqual(['서초동', '방배동', '서초동'])
  })

  it('words the replies', () => {
    expect(repliesSummary({ hearts: 2, voices: 0, transcripts: [] })).toBe('하트 2개')
    expect(repliesSummary({ hearts: 0, voices: 0, transcripts: [] })).toBe('')
  })
})
