import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('./MemoThumb', () => ({ MemoThumb: () => <span className="tl-thumb" /> }))

import { ParentGroupRow, ParentRow, SentDiaryRow } from './DiaryRows'
import type { FamilyPhoto, Memo } from '../types'

const photo = (o: Partial<FamilyPhoto> = {}): FamilyPhoto => ({
  id: 'f1', patientUid: 'p1', senderUid: 'me', senderName: '민수', photoPath: 'familyPhotos/p1/f1.jpg',
  photoUrl: 'https://x/full.jpg', thumbUrl: 'https://x/thumb.jpg', caption: '', status: 'ready', createdAtMs: Date.now(), ...o,
})
const memo = (id: string, place = '석촌호수 · 잠실동, 송파구') => ({ id, patientUid: 'mom', place, takenAt: { toDate: () => new Date() } }) as unknown as Memo

describe('rows in one\'s own diary (A14.3)', () => {
  it('a sent photo: one line, whom to, and where it stands at the end; edged in the parent\'s colour, not tinted', () => {
    const html = renderToString(<SentDiaryRow photo={photo()} to="엄마" color="steelblue" onOpen={() => {}} />)
    expect(html).toContain('엄마</b>에게 보냄')
    expect(html).toContain('--pc:steelblue')
    expect(html).toContain('https://x/thumb.jpg')
    expect(html).toContain('class="diary-status">보냈어요')
    expect(renderToString(<SentDiaryRow photo={photo({ seenAtMs: 1, reply: { kind: 'heart', atMs: 2 } })} to="아빠" color="x" onOpen={() => {}} />)).toContain('❤️ 고마워요')
  })
  it('a parent\'s photo: their name, then the place\'s name only', () => {
    const html = renderToString(<ParentRow item={{ memo: memo('m1'), name: '엄마', color: 'red' }} onOpen={() => {}} />).replace(/<!-- -->/g, '')
    expect(html).toContain('<b class="diary-who">엄마</b> 석촌호수')
    expect(html).not.toContain('잠실동')
  })
  it('a parent\'s run: one row, stacked thumbs (three at most), 펼치기', () => {
    const items = ['a', 'b', 'c', 'd'].map((id) => ({ memo: memo(id), name: '엄마', color: 'red' }))
    const html = renderToString(<ParentGroupRow items={items} onOpen={() => {}} />).replace(/<!-- -->/g, '')
    expect(html).toContain('엄마</b> · 사진 4장')
    expect(html.match(/diary-stack-thumb/g)?.length).toBe(3)
    expect(html).toContain('펼치기 ›')
    expect(html).toContain('aria-expanded="false"')
  })
})
