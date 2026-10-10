import { describe, it, expect, vi } from 'vitest'

vi.mock('@capacitor/filesystem', () => ({ Filesystem: {}, Directory: { Cache: 'CACHE' } }))

import { photoFileName, photoShareText } from './photoShare'
import type { Memo } from '../types'

const memo = (extra: Partial<Memo> = {}) => ({
  takenAt: { toDate: () => new Date(2026, 9, 9, 14, 5) },
  place: '서초동, 서초구',
  memo: '공원 산책길',
  ...extra,
}) as unknown as Memo

describe('photo share', () => {
  it('names the file by when it was taken', () => {
    expect(photoFileName(memo())).toBe('오늘하루_20261009_1405.jpg')
  })

  it('sends the time, place and memo along', () => {
    expect(photoShareText(memo())).toBe('[오늘하루] 10월 9일 (금) 오후 2:05 · 서초동, 서초구\n공원 산책길')
    expect(photoShareText(memo({ place: '', memo: '' }))).toBe('[오늘하루] 10월 9일 (금) 오후 2:05')
  })
})
