// The parent's side of family photos, rendered without a browser.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../lib/familyPhotos', () => ({ markFamilyPhotoSeen: vi.fn(async () => {}), replyToFamilyPhoto: vi.fn(async () => {}) }))

import { FamilyPhotosCard } from './FamilyPhotosCard'
import { FamilyPhotoViewer } from '../pages/FamilyPhotoViewer'
import type { FamilyPhoto } from '../types'

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean)
const photo = (id: string, o: Partial<FamilyPhoto> = {}): FamilyPhoto => ({
  id, patientUid: 'p1', senderUid: 'cg1', senderName: '민수', photoPath: `familyPhotos/p1/${id}.jpg`, photoUrl: `https://x/${id}.jpg`,
  caption: '보고 싶어요', status: 'ready', createdAtMs: Date.UTC(2026, 9, 5), ...o,
})

describe('FamilyPhotosCard', () => {
  it('lights up with who sent something new, and is absent with nothing to show', () => {
    expect(renderToString(<FamilyPhotosCard photos={[]} onOpen={() => {}} />)).toBe('')
    const out = renderToString(<FamilyPhotosCard photos={[photo('1')]} onOpen={() => {}} />)
    expect(out).toContain('민수가 사진을 보냈어요')
    expect(out).toContain('fp-card on')
  })

  it('is gone the day after everything was seen', () => {
    const seenYesterday = photo('1', { seenAtMs: 1, createdAtMs: Date.now() - 2 * 24 * 3600 * 1000 })
    expect(renderToString(<FamilyPhotosCard photos={[seenYesterday]} onOpen={() => {}} />)).toBe('')
    const seenToday = photo('2', { seenAtMs: 1, createdAtMs: Date.now() })
    expect(renderToString(<FamilyPhotosCard photos={[seenToday]} onOpen={() => {}} />)).toContain('가족 사진 다시 보기')
  })
})

describe('FamilyPhotoViewer', () => {
  it('shows the photo, the line and the sender, with the big replies and 다음 when there are more', () => {
    const out = renderToString(<FamilyPhotoViewer photos={[photo('1'), photo('2', { caption: '', createdAtMs: Date.UTC(2026, 9, 4) })]} onDone={() => {}} />)
    expect(out).toContain('src="https://x/1.jpg"')
    const t = text(out)
    expect(t).toContain('보고 싶어요')
    expect(t).toContain('민수가 보냈어요')
    expect(t.some((l) => l.includes('1/2'))).toBe(false)
    expect(t).toContain('❤️ 고마워요')
    expect(t).toContain('글로 답장하기')
    expect(t).toContain('다음 사진 ›')
  })

  it('offers no written reply when written replies are off, and no 다음 for a single photo', () => {
    const t = text(renderToString(<FamilyPhotoViewer photos={[photo('1')]} textMode="off" onDone={() => {}} />))
    expect(t).not.toContain('글로 답장하기')
    expect(t).not.toContain('다음 사진 ›')
  })

  it('says what the parent already answered, and offers only the way on', () => {
    const answered = photo('1', { seenAtMs: 1, reply: { kind: 'comment', text: '고마워', atMs: 2 } })
    const t = text(renderToString(<FamilyPhotoViewer photos={[answered, photo('2', { seenAtMs: 1 })]} onDone={() => {}} />))
    expect(t).toContain('“고마워”라고 답했어요')
    expect(t).not.toContain('❤️ 고마워요')
    expect(t).not.toContain('글로 답장하기')
    expect(t).toContain('다음 사진 ›')
  })
})
