// The parent's 내 사진 (A14.7): a photo grid, tiles with chips, 새 소식, received cards, the bottom bar.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('./MemoThumb', () => ({ MemoThumb: () => <span className="tl-thumb" /> }))
vi.mock('../hooks/useCapture', () => ({ useCapture: () => ({}) }))

import { ElderRecords, ElderRecordTile } from './ElderRecords'
import type { FamilyPhoto, Memo, Reaction } from '../types'

const at = (dayOffset: number, h: number, m = 0) => { const d = new Date(); d.setDate(d.getDate() - dayOffset); d.setHours(h, m, 0, 0); return d }
const memo = (id: string, when: Date) => ({ id, patientUid: 'mom', status: 'ready', memo: 'AI 제목', activity: '산책', place: '석촌호수 · 잠실동, 송파구', takenAt: { toDate: () => when } }) as unknown as Memo
const sent = (id: string, when: Date, o: Partial<FamilyPhoto> = {}): FamilyPhoto => ({ id, patientUid: 'mom', senderUid: 'me', senderName: '지민', photoPath: 'x', photoUrl: 'https://x/p.jpg', caption: '', status: 'ready', createdAtMs: when.getTime(), ...o })
const rx = (kind: Reaction['kind'], name = '지민', o: Partial<Reaction> = {}) => ({ kind, actorName: name, actorUid: 'kid', status: 'ready', ...o }) as Reaction
const render = (o: Partial<Parameters<typeof ElderRecords>[0]> = {}) => renderToString(
  <ElderRecords memos={[]} received={[]} patientUid="mom" onOpen={() => {}} onOpenReceived={() => {}} onCamera={() => {}} {...o} />,
).replace(/<!-- -->/g, '')
const tile = (reactions: Reaction[] | undefined, wide = false) => renderToString(<ElderRecordTile memo={memo('a', at(0, 8, 55))} reactions={reactions} patientUid="mom" wide={wide} onOpen={() => {}} />).replace(/<!-- -->/g, '')

describe('ElderRecordTile', () => {
  it('only the time under the photo: 8:55 in the 3-column grid, 오전 8:55 in the 2-column one; no title, place or category', () => {
    expect(tile(undefined)).toContain('<span class="elder-tile-time">8:55</span>')
    expect(tile(undefined, true)).toContain('<span class="elder-tile-time">오전 8:55</span>')
    expect(tile(undefined)).not.toMatch(/AI 제목|석촌호수|산책/)
  })
  it('the chip says what the family did: icons in 3 columns, the first name too in 2', () => {
    expect(tile([rx('heart')])).toContain('class="elder-tile-chip" aria-hidden="true">❤️<')
    expect(tile([rx('comment')])).toContain('>💬<')
    expect(tile([rx('heart'), rx('comment')])).toContain('>❤️💬<')
    expect(tile([rx('heart'), rx('comment', '민수')], true)).toContain('>❤️💬 지민<')
    expect(tile(undefined)).not.toContain('elder-tile-chip')
  })
  it('a full sentence for a screen reader, and a 새 소식 chip while unread', () => {
    const fresh = tile([rx('heart'), rx('comment')])
    expect(fresh).toContain('aria-label="오전 8:55 사진, 지민이 하트와 글을 남겼어요, 새 소식"')
    expect(fresh).toContain('data-unseen=""')
    expect(fresh).toContain('class="elder-tile-new" aria-hidden="true">새 소식<')
    const seen = tile([rx('heart', '지민', { readByElderAt: {} as never })])
    expect(seen).toContain('aria-label="오전 8:55 사진, 지민이 하트를 보냈어요"')
    expect(seen).not.toContain('새 소식')
    expect(tile([rx('comment'), rx('comment', '민수')])).toContain('지민 외 1명이 글을 남겼어요')
  })
})

describe('ElderRecords', () => {
  it('a 3-column grid per day with the count on the heading row; 큰 글자 makes it 2 columns', () => {
    const memos = [memo('a', at(0, 9)), memo('b', at(0, 10)), memo('c', at(0, 11))]
    const out = render({ memos })
    expect(out).toContain('class="page elder-records"')
    expect(out.match(/class="elder-tile"/g)?.length).toBe(3)
    expect(out).toContain('<span class="elder-day-count">3장</span>')
    expect(out).toMatch(/elder-day-head">오늘 · /)
    expect(render({ memos, bigText: true })).toContain('class="page elder-records big"')
  })
  it('새 소식 n › above a day with something unread, counting tiles and received photos', () => {
    const byMemo = new Map<string, Reaction[]>([['a', [rx('heart')]]])
    const out = render({ memos: [memo('a', at(0, 9)), memo('b', at(0, 10))], received: [sent('f', at(0, 9, 30))], byMemo })
    expect(out).toContain('class="elder-day-news">새 소식 2 ›')
    expect(render({ memos: [memo('b', at(0, 10))] })).not.toContain('elder-day-news')
  })
  it('a received photo is one horizontal card that breaks the grid, in time order', () => {
    const out = render({ memos: [memo('a', at(0, 9)), memo('b', at(0, 11))], received: [sent('f', at(0, 10), { caption: '보고 싶어요', seenAtMs: 1 })] })
    expect(out.match(/class="elder-grid"/g)?.length).toBe(2)
    expect(out).toContain('지민이 보냈어요')
    expect(out).toContain('“보고 싶어요”')
    const [b, f, a] = ['aria-label="오전 11:00 사진"', 'elder-received', 'aria-label="오전 9:00 사진"'].map((t) => out.indexOf(t))
    expect(b).toBeLessThan(f); expect(f).toBeLessThan(a)
    expect(render({ received: [sent('g', at(1, 20, 40), { seenAtMs: 1, reply: { kind: 'heart', atMs: 2 } })] })).toContain('오후 8:40 · ❤️ 고마워요 보냄')
  })
  it('the bottom bar: 날짜로 찾기 (the date picker, bounded by the days that have photos) and 카메라; no floating icons', () => {
    const out = render({ memos: [memo('a', at(0, 9)), memo('b', at(3, 9))] })
    expect(out).toContain('class="elder-bar"')
    expect(out).toContain('날짜로 찾기')
    expect(out).toContain('elder-bar-btn elder-bar-camera')
    expect(out).toMatch(/type="date"[^>]*min="\d{4}-\d{2}-\d{2}"[^>]*max="\d{4}-\d{2}-\d{2}"/)
    expect(out).not.toContain('cal-fab-wrap')
    expect(out).not.toContain('cam-fab-wrap')
  })
  it('days: today newest first, a past day morning first', () => {
    const out = render({ memos: [memo('t2', at(0, 15)), memo('t1', at(0, 9)), memo('y2', at(1, 18)), memo('y1', at(1, 8))] })
    expect(out.indexOf('>15:00<')).toBeLessThan(out.indexOf('>9:00<'))
    expect(out.indexOf('>8:00<')).toBeLessThan(out.indexOf('>18:00<'))
  })
})
