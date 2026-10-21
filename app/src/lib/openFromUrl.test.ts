// What a tapped notification's link asks the app to open.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('./worker', () => ({ callWorker: vi.fn() }))
import { parseOpen } from './openFromUrl'

describe('parseOpen', () => {
  it('reads the worker\'s push links', () => {
    expect(parseOpen('/?open=memo&p=mom&m=m1')).toEqual({ kind: 'memo', patientUid: 'mom', memoId: 'm1' })
    expect(parseOpen('https://dayliesimple.web.app/?open=home&p=mom')).toEqual({ kind: 'home', patientUid: 'mom' })
    expect(parseOpen('/?open=today&p=mom')).toEqual({ kind: 'today', patientUid: 'mom' })
    expect(parseOpen('/digest/d_1')).toEqual({ kind: 'digest', digestId: 'd_1' })
  })

  it('falls back to the 사진 tab when the photo is missing, and ignores anything else', () => {
    expect(parseOpen('/?open=memo&p=mom')).toEqual({ kind: 'today', patientUid: 'mom' })
    expect(parseOpen('/?open=memo&m=m1')).toBeNull()
    expect(parseOpen('/?open=settings&p=mom')).toBeNull()
    expect(parseOpen('/')).toBeNull()
    expect(parseOpen('/?tab=settings')).toBeNull()
  })
})
