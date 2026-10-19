// 설정 → 집 위치: what is looked up while typing, and the recent-place chips.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../lib/worker', () => ({ callWorker: vi.fn(), isWorkerOffline: () => false, WorkerError: class extends Error {}, WORKER_OFFLINE_MESSAGE: '' }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ show: () => {} }) }))

import { HomePicker } from './HomePicker'
import { autoSearchable, recentPlacesOf } from '../lib/homePlaces'
import type { Memo } from '../types'

describe('autoSearchable', () => {
  it('waits for two Korean letters or three of anything else', () => {
    expect(autoSearchable('서')).toBe(false)
    expect(autoSearchable(' 서초 ')).toBe(true)
    expect(autoSearchable('An')).toBe(false)
    expect(autoSearchable('Ana')).toBe(true)
    expect(autoSearchable('39')).toBe(false)
    expect(autoSearchable('   ')).toBe(false)
  })
})

describe('recentPlacesOf', () => {
  it('keeps located photos, one per place, at most four', () => {
    const m = (place: string, lat: number | null = 1) => ({ place, lat, lng: 2 }) as unknown as Memo
    expect(recentPlacesOf([m('A'), m('A'), m('B', null), m('C'), m('D'), m('E'), m('F')]).map((p) => p.label)).toEqual(['A', 'C', 'D', 'E'])
  })
})

describe('HomePicker', () => {
  const render = (props: Partial<Parameters<typeof HomePicker>[0]> = {}) => renderToString(
    <HomePicker home={null} memos={[]} patientUid="mom" onChange={() => {}} {...props} />,
  )
  it('shows the saved home with 지우기, or that it is guessed', () => {
    expect(render()).toContain('자동으로 추정해요')
    expect(render()).not.toContain('지우기')
    const saved = render({ home: { lat: 33.86, lng: -117.83, label: '3920 East Coronado Street, Anaheim' } })
    expect(saved).toContain('3920 East Coronado Street, Anaheim')
    expect(saved).toContain('지우기')
  })
  it('offers this phone\'s location only when asked to', () => {
    expect(render()).not.toContain('지금 있는 곳을 집으로 설정')
    expect(render({ allowCurrentLocation: true })).toContain('지금 있는 곳을 집으로 설정')
  })
  it('has a section label with ⓘ, or a plain sub-label', () => {
    expect(render()).toContain('aria-label="설명 보기"')
    expect(render({ heading: 'sub' })).toContain('class="sub-lab">집 위치<')
  })
})
