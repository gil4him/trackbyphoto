// The parent's side of family photos, rendered without a browser.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../lib/familyPhotos', () => ({ markFamilyPhotoSeen: vi.fn(async () => {}), replyToFamilyPhoto: vi.fn(async () => {}) }))

import { FamilyPhotosCard } from './FamilyPhotosCard'
import { FamilyPhotoViewer } from '../pages/FamilyPhotoViewer'
import { viewerOrder } from '../lib/familyPhotosModel'
import type { FamilyPhoto } from '../types'

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/\u00a0/g, ' ').replace(/<[^>]+>/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean)
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
    expect(t).toContain('글로 답하기')
    expect(t).toContain('다음 사진 ›')
    // No list, no top link, nothing else to tap.
    expect(t).not.toContain('처음으로')
    expect(out).not.toContain('elder-back')
    expect(out).not.toContain('tl-item')
    expect(out).toContain('class="fp-heart"')
  })

  it('shows where we are in the run: one dot a photo, the current one lit, and `n / N` under the photo (A12)', () => {
    const three = [photo('1'), photo('2', { createdAtMs: Date.UTC(2026, 9, 4) }), photo('3', { createdAtMs: Date.UTC(2026, 9, 3) })]
    const out = renderToString(<FamilyPhotoViewer photos={three} onDone={() => {}} />).replace(/<!-- -->/g, '')
    expect(out.match(/class="fp-dot( on)?"/g)).toHaveLength(3)
    expect(out.match(/class="fp-dot on"/g)).toHaveLength(1)
    expect(out).toContain('aria-label="1 / 3"')
    expect(out).toMatch(/class="fp-caption">오[전후] \d{1,2}:\d{2} · 1 \/ 3</)
    expect(out).not.toContain('fp-count')
    // The top row names the sender; the two outline buttons share one row under the heart.
    expect(out).toContain('<div class="fp-from">민수가 보냈어요</div>')
    const row = out.slice(out.indexOf('class="fp-row2"'))
    expect(row.match(/class="fp-btn"/g)).toHaveLength(2)
  })

  it('past nine photos the dots give way to `1 / 12`', () => {
    const many = Array.from({ length: 12 }, (_, i) => photo(String(i), { createdAtMs: Date.UTC(2026, 9, 12 - i) }))
    const out = renderToString(<FamilyPhotoViewer photos={many} onDone={() => {}} />)
    expect(out).not.toContain('fp-dot')
    expect(out).toContain('<div class="fp-count">1 / 12</div>')
  })

  it('gives the photo its own shape once known, a 4:3 box before', () => {
    const out = renderToString(<FamilyPhotoViewer photos={[photo('1')]} onDone={() => {}} />)
    expect(out).toContain('class="fp-photo" style="aspect-ratio:4 / 3"')
    expect(out).toContain('class="fp-message">보고 싶어요<')
  })

  it('on the last photo, the way on is the camera; with written replies off there is only ❤️ and the way on', () => {
    const t = text(renderToString(<FamilyPhotoViewer photos={[photo('1')]} textMode="off" onDone={() => {}} />))
    expect(t).not.toContain('글로 답하기')
    expect(t).not.toContain('다음 사진 ›')
    expect(t).toContain('처음으로 ›')
    expect(t).toContain('❤️ 고마워요')
  })

  it('says what the parent already answered, and offers only the way on', () => {
    const answered = photo('1', { seenAtMs: 1, reply: { kind: 'comment', text: '고마워', atMs: 2 } })
    const t = text(renderToString(<FamilyPhotoViewer photos={[answered, photo('2', { seenAtMs: 1, createdAtMs: Date.UTC(2026, 9, 4) })]} onDone={() => {}} />))
    expect(t).toContain('“고마워”라고 답했어요')
    expect(t).not.toContain('❤️ 고마워요')
    expect(t).not.toContain('글로 답하기')
    expect(t).toContain('다음 사진 ›')
  })

  it('says so when there is nothing to show, with one way out', () => {
    const t = text(renderToString(<FamilyPhotoViewer photos={[]} onDone={() => {}} />))
    expect(t).toContain('가족이 보낸 사진이 아직 없어요')
    expect(t).toContain('처음으로 ›')
  })
})

describe('viewerOrder with a photo tapped in 내 사진', () => {
  it('starts on that photo and keeps the usual order for the rest', () => {
    const a = photo('a', { createdAtMs: 3, seenAtMs: 9 }), b = photo('b', { createdAtMs: 2 }), c = photo('c', { createdAtMs: 1, seenAtMs: 9 })
    expect(viewerOrder([a, b, c]).map((p) => p.id)).toEqual(['b', 'a', 'c'])
    expect(viewerOrder([a, b, c], 'c').map((p) => p.id)).toEqual(['c', 'b', 'a'])
    expect(viewerOrder([a, b, c], 'nope').map((p) => p.id)).toEqual(['b', 'a', 'c'])
  })
})
