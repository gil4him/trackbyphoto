// 설정 → 집 위치: one address box; what is looked up while typing.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../lib/worker', () => ({ callWorker: vi.fn(), isWorkerOffline: () => false, WorkerError: class extends Error {}, WORKER_OFFLINE_MESSAGE: '' }))
vi.mock('../components/Toast', () => ({ useToast: () => ({ show: () => {} }) }))

import { HomePicker } from './HomePicker'
import { autoSearchable } from '../lib/homePlaces'

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

describe('HomePicker', () => {
  const render = (props: Partial<Parameters<typeof HomePicker>[0]> = {}) => renderToString(
    <HomePicker home={null} patientUid="mom" onChange={() => {}} {...props} />,
  )
  it('is one address box: empty until a home is saved, then showing the saved address', () => {
    const empty = render()
    expect(empty).toContain('aria-label="주소나 건물 이름"')
    expect(empty).toContain('value=""')
    const saved = render({ home: { lat: 33.86, lng: -117.83, label: '3920 East Coronado Street, Anaheim' } })
    expect(saved).toContain('value="3920 East Coronado Street, Anaheim"')
  })
  it('has nothing else: no recent-place chips, no 찾기 button, no 지우기, no this-phone link, no guess line', () => {
    const out = render({ home: { lat: 33.86, lng: -117.83, label: 'Anaheim' } })
    for (const gone of ['주소로 찾기', '지우기', '지금 있는 곳을 집으로 설정', '자동으로 추정해요', '최근 사진을 찍은 곳']) expect(out).not.toContain(gone)
    expect(out.match(/<button/g) ?? []).toHaveLength(1) // only the ⓘ on the section label
  })
  it('has a section label with ⓘ, or a plain sub-label', () => {
    expect(render()).toContain('aria-label="설명 보기"')
    expect(render({ heading: 'sub' })).toContain('class="sub-lab">집 위치<')
  })
})
