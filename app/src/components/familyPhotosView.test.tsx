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
  it('opens on the newest unseen photo: the photo, the line, the sender, ❤️ 고마워요, a phrase reply and 다음', () => {
    const older = photo('1', { createdAtMs: Date.UTC(2026, 9, 5) })
    const newerSeen = photo('2', { caption: '', createdAtMs: Date.UTC(2026, 9, 6), seenAtMs: 1 })
    const out = renderToString(<FamilyPhotoViewer photos={[newerSeen, older]} onDone={() => {}} />)
    expect(out).toContain('src="https://x/1.jpg"')
    expect(out).not.toContain('src="https://x/2.jpg"')
    const t = text(out)
    expect(t).toContain('보고 싶어요')
    expect(t).toContain('민수가 보냈어요')
    expect(t).toContain('❤️ 고마워요')
    expect(t).toContain('글로 답장하기')
    expect(t).toContain('다음 사진 ›')
    // No list, no top link, nothing else to tap.
    expect(t).not.toContain('처음으로')
    expect(out).not.toContain('elder-back')
    expect(out).not.toContain('tl-item')
    expect(out).toContain('class="news-btn primary"')
  })

  it('on the last photo, the way on is the camera; with written replies off there is only ❤️ and the way on', () => {
    const t = text(renderToString(<FamilyPhotoViewer photos={[photo('1')]} textMode="off" onDone={() => {}} />))
    expect(t).not.toContain('글로 답장하기')
    expect(t).not.toContain('다음 사진 ›')
    expect(t).toContain('처음으로 ›')
    expect(t).toContain('❤️ 고마워요')
  })

  it('says what the parent already answered, and offers only the way on', () => {
    const answered = photo('1', { seenAtMs: 1, reply: { kind: 'comment', text: '고마워', atMs: 2 } })
    const t = text(renderToString(<FamilyPhotoViewer photos={[answered, photo('2', { seenAtMs: 1, createdAtMs: Date.UTC(2026, 9, 4) })]} onDone={() => {}} />))
    expect(t).toContain('“고마워”라고 답했어요')
    expect(t).not.toContain('❤️ 고마워요')
    expect(t).not.toContain('글로 답장하기')
    expect(t).toContain('다음 사진 ›')
  })

  it('says so when there is nothing to show, with one way out', () => {
    const t = text(renderToString(<FamilyPhotoViewer photos={[]} onDone={() => {}} />))
    expect(t).toContain('가족이 보낸 사진이 아직 없어요')
    expect(t).toContain('처음으로 ›')
  })
})
