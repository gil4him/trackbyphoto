import { describe, it, expect } from 'vitest'
import { listPhoto } from './listPhoto'

describe('listPhoto', () => {
  it('prefers the small copy and falls back to the full photo', () => {
    expect(listPhoto({ thumbUrl: 't', photoUrl: 'p' })).toBe('t')
    expect(listPhoto({ photoUrl: 'p' })).toBe('p')
    expect(listPhoto({ thumbUrl: '', photoUrl: 'p' })).toBe('p')
    expect(listPhoto({})).toBe('')
  })
})
