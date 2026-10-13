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

  it('stays, quiet, once everything was seen, even days later', () => {
    const seenDaysAgo = photo('1', { seenAtMs: 1, createdAtMs: Date.now() - 2 * 24 * 3600 * 1000 })
    const out = renderToString(<FamilyPhotosCard photos={[seenDaysAgo]} onOpen={() => {}} />)
    expect(out).toContain('가족 사진 다시 보기')
    expect(out).not.toContain('fp-card on')
  })
})

describe('FamilyPhotoViewer', () => {
  const yesterday = Date.now() - 24 * 3600 * 1000
  const seenAnswered = photo('2', { createdAtMs: yesterday, seenAtMs: 1, reply: { kind: 'heart', atMs: 2 } })

  it('opens on the album laid out like 내 사진: a day heading, a row per photo, newest first', () => {
    const out = renderToString(<FamilyPhotoViewer photos={[seenAnswered, photo('1', { createdAtMs: Date.now() })]} onDone={() => {}} />)
    expect(out).toContain('class="page fp-list"')
    expect(out.match(/class="tl-day"/g)).toHaveLength(2)
    expect(out.match(/class="tl-item"/g)).toHaveLength(2)
    expect(out.indexOf('src="https://x/1.jpg"')).toBeLessThan(out.indexOf('src="https://x/2.jpg"'))
    const t = text(out)
    expect(t).toContain('가족이 보낸 사진')
    expect(t).toContain('‹ 처음으로')
    expect(t).toContain('오늘')
    expect(t).toContain('어제')
    expect(t).toContain('보고 싶어요')
    expect(t.some((l) => l.startsWith('민수 · 오'))).toBe(true)
    // The new one carries 새 사진 and a dot; the answered one its ❤️; nothing is answered from the album.
    expect(out.match(/class="tl-rx fresh"/g)).toHaveLength(1)
    expect(out.match(/class="tl-rx-dot"/g)).toHaveLength(1)
    expect(t).toContain('새 사진')
    expect(t).toContain('❤️')
    expect(t).not.toContain('❤️ 고마워요')
    expect(t).not.toContain('글로 답장하기')
    expect(t).not.toContain('다음 사진 ›')
  })

  it('carries the floating buttons 내 사진 has on the album, never over a photo', () => {
    const fabs = <button className="cam-fab">카메라</button>
    expect(renderToString(<FamilyPhotoViewer photos={[photo('1')]} fabs={fabs} onDone={() => {}} />)).toContain('cam-fab')
    expect(renderToString(<FamilyPhotoViewer photos={[photo('1')]} fabs={fabs} startAt="1" onDone={() => {}} />)).not.toContain('cam-fab')
  })

  it('is the album even for a single photo, and says so when there is none', () => {
    expect(renderToString(<FamilyPhotoViewer photos={[photo('1')]} onDone={() => {}} />)).toContain('class="page fp-list"')
    expect(text(renderToString(<FamilyPhotoViewer photos={[]} onDone={() => {}} />))).toContain('가족이 보낸 사진이 아직 없어요')
  })

  it('shows one photo with the line and the sender, the big replies, 다음 when there are more, and the way back to the album', () => {
    const out = renderToString(<FamilyPhotoViewer photos={[photo('1'), photo('2', { caption: '', createdAtMs: Date.UTC(2026, 9, 4) })]} startAt="1" onDone={() => {}} />)
    expect(out).toContain('src="https://x/1.jpg"')
    expect(out).not.toContain('class="page fp-list"')
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
