// A family member's own 오늘 (내 하루): their photos by time, like the
// parent's day page, with their parents' photos of today and what they sent
// them woven in, indented in each parent's colour.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../hooks/useWorkerStatus', () => ({ useWorkerStatus: () => 'up' }))
vi.mock('../components/MemoThumb', () => ({ MemoThumb: () => <span className="tl-thumb" /> }))

import { MyDay } from './MyDay'
import { diaryEntries } from '../lib/diary'
import type { FamilyPhoto, Memo } from '../types'

const NOW = new Date(2026, 9, 24, 18, 0)
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 9, 24 - dayOffset, h, m)
const memo = (id: string, when: Date, extra: Partial<Memo> = {}) => ({
  id, patientUid: 'me', photoPath: `photos/me/${id}.jpg`, status: 'ready', memo: `${id} 제목`, activity: '산책', place: '석촌호수',
  takenAt: { toDate: () => when }, ...extra,
}) as unknown as Memo
const sentPhoto = (id: string, when: Date): FamilyPhoto => ({
  id, patientUid: 'mom', senderUid: 'me', senderName: '지민', photoPath: `familyPhotos/mom/${id}.jpg`, photoUrl: 'https://x/p.jpg', caption: '', status: 'ready', createdAtMs: when.getTime(),
})

const render = (o: Partial<Parameters<typeof MyDay>[0]> = {}) => renderToString(
  <MyDay memos={[]} parents={[]} sent={[]} onOpen={() => {}} onOpenParentMemo={() => {}} onOpenSent={() => {}} onYesterday={() => {}} now={NOW} {...o} />,
).replace(/<!-- -->/g, '')

describe('내 하루', () => {
  it("one card, newest first: one's own photos, a parent's (indented, their name), and what one sent; one line each", () => {
    const out = render({
      memos: [memo('mine2', at(15)), memo('mine1', at(9)), memo('yday', at(9, 0, 1))],
      parents: [{ memo: memo('mom1', at(12), { patientUid: 'mom' }), name: '엄마', color: 'steelblue' }],
      sent: [{ photo: sentPhoto('s1', at(10)), to: '엄마', color: 'steelblue' }],
    })
    expect(out).toContain('내 하루')
    expect(out).toContain('내 사진 2장 · 엄마 1장')
    expect(out).not.toContain('yday 제목')
    const order = ['mine2 제목', '엄마</b> 석촌호수', '엄마</b>에게 보냄', 'mine1 제목'].map((t) => out.indexOf(t))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(out.match(/class="day-card"/g)?.length).toBe(1)
    expect(out).toContain('style="--pc:steelblue"')
    expect(out.match(/class="day-time"/g)?.length).toBe(4)
    expect(out).not.toContain('day-rail')
    expect(out).not.toContain('day-dot')
  })

  it("a parent's photos that aren't new fold into one row, even with one's own between them; a new one stays out", () => {
    const mom = (id: string, h: number) => ({ memo: memo(id, at(h), { patientUid: 'mom' }), name: '엄마', color: 'red' })
    const folded = render({ parents: [mom('a', 12), mom('b', 11)] })
    expect(folded).toContain('엄마</b> · 사진 2장')
    const between = render({ memos: [memo('mine', at(11, 30))], parents: [mom('a', 12), mom('b', 11)] })
    expect(between).toContain('엄마</b> · 사진 2장')
    const arrivedNow = { createdAt: { toMillis: () => Date.now() + 60_000 } } as unknown as Partial<Memo>
    const fresh = { memo: memo('c', at(13), { patientUid: 'mom', ...arrivedNow }), name: '엄마', color: 'red' }
    const withNew = render({ parents: [fresh, mom('a', 12), mom('b', 11)] })
    expect(withNew).toContain('엄마</b> · 사진 2장')
    expect(withNew).toContain('diary-thumb')
  })

  it('an empty day says so, with 어제 보기', () => {
    const out = render()
    expect(out).toContain('오늘 아직 사진이 없어요')
    expect(out).toContain('어제 보기')
    expect(out).toContain('내 사진 0장')
    expect(out).toContain('찍은 사진은 ⋯ 에서 부모님께 보낼 수 있어요')
  })

  it('diaryEntries leaves out a sent photo that is not ready yet', () => {
    const pending = { ...sentPhoto('p', at(11)), photoUrl: undefined }
    expect(diaryEntries([], [], [{ photo: pending, to: '엄마', color: 'x' }])).toEqual([])
  })

  it('sending lives in ⋯ only: no 사진 보내기 link on the day', () => {
    expect(render({ memos: [memo('mine', at(9))] })).not.toContain('사진 보내기')
  })

  it('puts the card it is given above the day, and the other below', () => {
    const out = render({ topCard: <i>top</i>, afterDay: <i>after</i> })
    expect(out.indexOf('top')).toBeLessThan(out.indexOf('오늘 아직 사진이 없어요'))
    expect(out.indexOf('after')).toBeGreaterThan(out.indexOf('오늘 아직 사진이 없어요'))
  })
})
