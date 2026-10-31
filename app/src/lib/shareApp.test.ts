// 가족·친구에게 알리기: the owner's exact message, the count, the fallback.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  canShare: vi.fn(),
  share: vi.fn(),
  callWorker: vi.fn(),
  copy: vi.fn(),
}))
vi.mock('@capacitor/share', () => ({ Share: { canShare: h.canShare, share: h.share } }))
vi.mock('./share', () => ({ copyPairMessage: h.copy }))
vi.mock('./worker', () => ({ callWorker: h.callWorker }))

import { markShareCardDone, shareApp, shareCardDone, shareCardSubject, SHARE_APP_TEXT } from './shareApp'

describe('shareApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.callWorker.mockResolvedValue({ ok: true })
  })

  it('is word for word what the owner wrote', () => {
    expect(SHARE_APP_TEXT).toBe('요즘 엄마 안부 이걸로 해.\n엄마는 카메라만 누르면 되고, 난 엄마가 오늘 어디 갔는지 사진으로 봐.\n무료야 → https://www.daylieai.com')
  })

  it('opens the share sheet and counts the tap', async () => {
    h.canShare.mockResolvedValue({ value: true })
    expect(await shareApp()).toBe('shared')
    expect(h.share).toHaveBeenCalledWith(expect.objectContaining({ text: SHARE_APP_TEXT }))
    expect(h.callWorker).toHaveBeenCalledWith('logGrowthEvent', { event: 'share_tapped' })
  })

  it('copies the message where there is no share sheet', async () => {
    h.canShare.mockResolvedValue({ value: false })
    expect(await shareApp()).toBe('copied')
    expect(h.copy).toHaveBeenCalledWith(SHARE_APP_TEXT)
  })

  it('a closed sheet or a failed count is no error', async () => {
    h.canShare.mockResolvedValue({ value: true })
    h.share.mockRejectedValue(new Error('cancelled'))
    h.callWorker.mockRejectedValue(new Error('offline'))
    await expect(shareApp()).resolves.toBe('shared')
  })
})

describe('the Today card', () => {
  it('stays gone per account once done', () => {
    const stored = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v) })
    expect(shareCardDone('a')).toBe(false)
    markShareCardDone('a')
    expect(shareCardDone('a')).toBe(true)
    expect(shareCardDone('b')).toBe(false)
  })
})

describe('shareCardSubject', () => {
  it('names the parent with the most photos today', () => {
    expect(shareCardSubject([{ name: '엄마' }, { name: '아빠' }, { name: '엄마' }])).toEqual({ name: '엄마', count: 2 })
  })
  it('is null on a day with no photos', () => {
    expect(shareCardSubject([])).toBeNull()
  })
})
