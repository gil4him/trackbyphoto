import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { SentRow } from './SentRow'
import type { FamilyPhoto } from '../types'

const photo = (o: Partial<FamilyPhoto> = {}): FamilyPhoto => ({
  id: 'f1', patientUid: 'p1', senderUid: 'me', senderName: '민수', photoPath: 'familyPhotos/p1/f1.jpg',
  photoUrl: 'https://x/full.jpg', thumbUrl: 'https://x/thumb.jpg', caption: '', status: 'ready', createdAtMs: Date.now(), ...o,
})

describe('a sent photo in the family member\'s own 사진', () => {
  it('says whom it went to, in that parent\'s colour, with the small copy', () => {
    const html = renderToString(<SentRow photo={photo()} to="엄마" color="#4A90D9" onOpen={() => {}} />)
    expect(html).toContain('엄마</span>에게 보냄')
    expect(html).toContain('--pc:#4A90D9')
    expect(html).toContain('https://x/thumb.jpg')
    expect(html).toContain('보냈어요')
  })
  it('follows the parent\'s answer', () => {
    expect(renderToString(<SentRow photo={photo({ seenAtMs: 1 })} to="아빠" color="x" onOpen={() => {}} />)).toContain('봤어요')
    expect(renderToString(<SentRow photo={photo({ seenAtMs: 1, reply: { kind: 'heart', atMs: 2 } })} to="아빠" color="x" onOpen={() => {}} />)).toContain('❤️ 고마워요')
  })
})
