import { describe, it, expect } from 'vitest'
import { appTitle } from './edition'

describe('appTitle', () => {
  it('names each edition', () => {
    expect(appTitle(true)).toBe('Daylie')
    expect(appTitle(false)).toBe('Daylie · TrackByPhoto')
  })
})
