// The parent's 내 사진 (A14.7): big cards, sentences, 새 소식, the bottom bar.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('./MemoThumb', () => ({ MemoThumb: () => <span className="tl-thumb" /> }))
vi.mock('../hooks/useCapture', () => ({ useCapture: () => ({}) }))

import { ElderRecords } from './ElderRecords'
import type { FamilyPhoto, Memo, Reaction } from '../types'

const at = (dayOffset: number, h: number, m = 0) => { const d = new Date(); d.setDate(d.getDate() - dayOffset); d.setHours(h, m, 0, 0); return d }
const memo = (id: string, when: Date) => ({ id, patientUid: 'mom', status: 'ready', memo: 'AI 제목', activity: '산책', place: '석촌호수 · 잠실동, 송파구', takenAt: { toDate: () => when } }) as unknown as Memo
const sent = (id: string, when: Date, o: Partial<FamilyPhoto> = {}): FamilyPhoto => ({ id, patientUid: 'mom', senderUid: 'me', senderName: '지민', photoPath: 'x', photoUrl: 'https://x/p.jpg', caption: '', status: 'ready', createdAtMs: when.getTime(), ...o })
const render = (o: Partial<Parameters<typeof ElderRecords>[0]> = {}) => renderToString(
  <ElderRecords memos={[]} received={[]} patientUid="mom" onOpen={() => {}} onOpenReceived={() => {}} onCamera={() => {}} {...o} />,
).replace(/<!-- -->/g, '')

describe('ElderRecords', () => {
  it('a card per photo: the photo, then one line `time · place` — no AI title, no 동/구, no category', () => {
    const out = render({ memos: [memo('a', at(0, 8, 55))] })
    expect(out).toContain('class="elder-card-line">오전 8:55 · 석촌호수<')
    expect(out).not.toContain('AI 제목')
    expect(out).not.toContain('잠실동')
  })
  it('the family\'s response as a sentence, with 새 소식 first while unread', () => {
    const byMemo = new Map<string, Reaction[]>([['a', [{ kind: 'heart', actorName: '지민', actorUid: 'kid', status: 'ready' }, { kind: 'comment', actorName: '지민', actorUid: 'kid', status: 'ready' }] as Reaction[]]])
    const out = render({ memos: [memo('a', at(0, 9))], byMemo })
    expect(out).toContain('<span class="elder-new-pill">새 소식</span>지민이 ❤️ 하고 글을 남겼어요')
  })
  it('a photo from the family: who sent it, their line, and what the parent answered', () => {
    const out = render({ received: [sent('f', at(1, 20, 40), { caption: '보고 싶어요', seenAtMs: 1, reply: { kind: 'heart', atMs: 2 } })] })
    expect(out).toContain('elder-card elder-card-received')
    expect(out).toContain('지민이 보냈어요')
    expect(out).toContain('“보고 싶어요”')
    expect(out).toContain('오후 8:40 · ❤️ 고마워요 보냄')
  })
  it('the bottom bar: 날짜로 찾기 (the date picker, bounded by the days that have photos) and 카메라', () => {
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
    expect(out.indexOf('오후 3:00')).toBeLessThan(out.indexOf('오전 9:00'))
    expect(out.indexOf('오전 8:00')).toBeLessThan(out.indexOf('오후 6:00'))
  })
})
