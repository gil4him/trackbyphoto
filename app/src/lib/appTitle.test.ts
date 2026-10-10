import { describe, it, expect } from 'vitest'
import { appTitle } from './edition'

describe('appTitle', () => {
  it('names each edition', () => {
    expect(appTitle(true)).toBe('오늘하루')
    expect(appTitle(false)).toBe('오늘하루 · TrackByPhoto')
  })
})
