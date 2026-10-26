// One photo as a row (A14.1–A14.2).
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('./MemoThumb', () => ({ MemoThumb: () => <span className="tl-thumb" /> }))

import { MemoRow } from './MemoRow'
import type { Memo, Reaction } from '../types'

const memo = (o: Partial<Memo> = {}) => ({ id: 'm', patientUid: 'p', status: 'ready', memo: '호숫가 산책', activity: '산책', place: '석촌호수 · 잠실동, 송파구', takenAt: { toDate: () => new Date() }, ...o }) as unknown as Memo
const out = (props: Partial<Parameters<typeof MemoRow>[0]> = {}) => renderToString(<MemoRow memo={memo()} onOpen={() => {}} {...props} />).replace(/<!-- -->/g, '')

describe('MemoRow', () => {
  it('one meta line with the place\'s name only: no 동/구, no category', () => {
    const html = out()
    expect(html).toContain('<span class="memo-row-meta">석촌호수</span>')
    expect(html).not.toContain('잠실동')
    expect(html).not.toContain('· 산책')
  })
  it('hearts and words counted at the end of the line, hidden at 0', () => {
    expect(out()).not.toContain('memo-row-rx')
    const rx = [{ kind: 'heart', actorName: '지민' }, { kind: 'heart', actorName: '지민' }, { kind: 'comment', actorName: '민수' }] as Reaction[]
    expect(out({ reactions: rx })).toContain('<span class="memo-rx-heart">♥ 1</span><span>💬 1</span>')
    expect(out({ reactions: [{ kind: 'comment', actorName: '민수' }] as Reaction[] })).not.toContain('memo-rx-heart')
  })
  it('a generic 사진을 남겼어요 reads {place}에서', () => {
    expect(out({ memo: memo({ memo: '사진을 남겼어요' }) })).toContain('>석촌호수에서<')
    expect(out({ memo: memo({ memo: '사진을 남겼어요', place: '' }) })).toContain('>사진을 남겼어요<')
  })
  it('the time is a left column, no rail and no dot; the unread dot has its own column', () => {
    const html = out({ time: '08:55', fresh: true })
    expect(html).toContain('<span class="day-time">08:55</span>')
    expect(html).not.toContain('day-rail')
    expect(html).not.toContain('day-dot')
    expect(html).toContain('<span class="memo-row-side"><span class="memo-row-new" aria-label="새 소식"></span></span>')
  })
})
