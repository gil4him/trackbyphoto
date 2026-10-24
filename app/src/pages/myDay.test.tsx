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
  it("one timeline, newest first: one's own photos, a parent's (indented, their name), and what one sent", () => {
    const out = render({
      memos: [memo('mine2', at(15)), memo('mine1', at(9)), memo('yday', at(9, 0, 1))],
      parents: [{ memo: memo('mom1', at(12), { patientUid: 'mom' }), name: '엄마', color: '#4A90D9' }],
      sent: [{ photo: sentPhoto('s1', at(10)), to: '엄마', color: '#4A90D9' }],
    })
    expect(out).toContain('내 하루')
    expect(out).toContain('사진 2장')
    expect(out).not.toContain('yday 제목')
    const order = ['mine2 제목', 'mom1 제목', '엄마</span>에게 보냄', 'mine1 제목'].map((t) => out.indexOf(t))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(out).toContain('class="parent-memo" style="--pc:#4A90D9"')
    expect(out).toContain('엄마 · 석촌호수')
    expect(out.match(/class="day-time"/g)?.length).toBe(4)
  })

  it('an empty day says so, with 어제 보기', () => {
    const out = render()
    expect(out).toContain('오늘 아직 사진이 없어요')
    expect(out).toContain('어제 보기')
    expect(out).toContain('사진 0장')
  })

  it('diaryEntries leaves out a sent photo that is not ready yet', () => {
    const pending = { ...sentPhoto('p', at(11)), photoUrl: undefined }
    expect(diaryEntries([], [], [{ photo: pending, to: '엄마', color: 'x' }])).toEqual([])
  })
})
