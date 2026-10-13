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
  const yesterday = Date.now() - 24 * 3600 * 1000
  const seenAnswered = photo('2', { createdAtMs: yesterday, seenAtMs: 1, reply: { kind: 'heart', atMs: 2 } })

  it('opens on the album: every photo, newest first, a dot on the new one and a mark on the answered one', () => {
    const out = renderToString(<FamilyPhotoViewer photos={[seenAnswered, photo('1', { createdAtMs: Date.now() })]} onDone={() => {}} />)
    expect(out).toContain('class="fp-grid"')
    expect(out.indexOf('src="https://x/1.jpg"')).toBeLessThan(out.indexOf('src="https://x/2.jpg"'))
    expect(out.match(/class="fp-cell new"/g)).toHaveLength(1)
    expect(out.match(/class="fp-cell-dot"/g)).toHaveLength(1)
    expect(out).toContain('aria-label="새 사진"')
    expect(out.match(/class="fp-cell-mark"/g)).toHaveLength(1)
    const t = text(out)
    expect(t).toContain('가족이 보낸 사진')
    expect(t).toContain('‹ 처음으로')
    expect(t).toContain('민수')
    expect(t).toContain('오늘')
    expect(t).toContain('어제')
    expect(t).toContain('❤️')
    // Nothing is answered from the album.
    expect(t).not.toContain('❤️ 고마워요')
    expect(t).not.toContain('글로 답장하기')
    expect(t).not.toContain('다음 사진 ›')
  })

  it('is the album even for a single photo, and says so when there is none', () => {
    expect(renderToString(<FamilyPhotoViewer photos={[photo('1')]} onDone={() => {}} />)).toContain('class="fp-grid"')
    expect(text(renderToString(<FamilyPhotoViewer photos={[]} onDone={() => {}} />))).toContain('가족이 보낸 사진이 아직 없어요')
  })

  it('shows one photo with the line and the sender, the big replies, 다음 when there are more, and the way back to the album', () => {
    const out = renderToString(<FamilyPhotoViewer photos={[photo('1'), photo('2', { caption: '', createdAtMs: Date.UTC(2026, 9, 4) })]} startAt="1" onDone={() => {}} />)
    expect(out).toContain('src="https://x/1.jpg"')
    expect(out).not.toContain('class="fp-grid"')
    const t = text(out)
    expect(t).toContain('보고 싶어요')
    expect(t).toContain('민수가 보냈어요')
    expect(t.some((l) => l.includes('1/2'))).toBe(false)
    expect(t).toContain('❤️ 고마워요')
    expect(t).toContain('글로 답장하기')
    expect(t).toContain('다음 사진 ›')
    expect(t).toContain('‹ 사진 목록')
    expect(t).not.toContain('‹ 처음으로')
  })

  it('offers no written reply when written replies are off, and no 다음 on the last photo', () => {
    const t = text(renderToString(<FamilyPhotoViewer photos={[photo('1')]} startAt="1" textMode="off" onDone={() => {}} />))
    expect(t).not.toContain('글로 답장하기')
    expect(t).not.toContain('다음 사진 ›')
  })

  it('says what the parent already answered, and offers only the way on', () => {
    const answered = photo('1', { seenAtMs: 1, reply: { kind: 'comment', text: '고마워', atMs: 2 } })
    const t = text(renderToString(<FamilyPhotoViewer photos={[answered, photo('2', { seenAtMs: 1 })]} startAt="1" onDone={() => {}} />))
    expect(t).toContain('“고마워”라고 답했어요')
    expect(t).not.toContain('❤️ 고마워요')
    expect(t).not.toContain('글로 답장하기')
    expect(t).toContain('다음 사진 ›')
  })
})
