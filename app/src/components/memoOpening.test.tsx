// A tapped notification's photo: the placeholder answers the tap at once.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'

const getDoc = vi.hoisted(() => vi.fn())
vi.mock('../firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, ...path: string[]) => path.join('/'), getDoc }))

import { MemoOpeningView } from './MemoOpening'
import { readMemo, type MemoByIdState } from '../hooks/useMemoById'

const none = () => {}
const view = (state: MemoByIdState, slow = false) =>
  renderToString(<MemoOpeningView state={state} slow={slow} onBack={none} onRetry={none} onPhotos={none} />)

describe('MemoOpeningView', () => {
  it('while loading: back button, the photo frame and 사진을 불러오는 중…', () => {
    const html = view('loading')
    expect(html).toContain('aria-label="뒤로가기"')
    expect(html).toContain('사진을 불러오는 중…')
    expect(html).not.toContain('다시 시도')
  })

  it('slow or failed: offers 다시 시도', () => {
    expect(view('loading', true)).toContain('다시 시도')
    expect(view('error')).toContain('사진을 불러오지 못했어요')
  })

  it('gone or not allowed: says so and leads to the photos', () => {
    const html = view('missing', true)
    expect(html).toContain('이 사진은 볼 수 없어요')
    expect(html).toContain('사진 보기')
    expect(html).not.toContain('다시 시도')
  })
})

describe('readMemo', () => {
  beforeEach(() => { getDoc.mockReset() })

  it('reads the one photo and hands it over', async () => {
    getDoc.mockResolvedValue({ exists: () => true, id: 'm1', data: () => ({ patientUid: 'mom', memo: '산책' }) })
    expect(await readMemo('m1')).toEqual({ memo: { id: 'm1', patientUid: 'mom', memo: '산책' }, state: 'ready' })
    expect(getDoc).toHaveBeenCalledWith('memos/m1')
  })

  it('a photo that is gone, or not allowed, reads as missing', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => false })
    expect((await readMemo('m2')).state).toBe('missing')
    getDoc.mockRejectedValueOnce({ code: 'permission-denied' })
    expect((await readMemo('m3')).state).toBe('missing')
  })

  it('a network failure reads as error (다시 시도)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    getDoc.mockRejectedValueOnce({ code: 'unavailable' })
    expect((await readMemo('m4')).state).toBe('error')
  })
})
