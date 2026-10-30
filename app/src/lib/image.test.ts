// How far a photo is shrunk before upload.
import { describe, it, expect } from 'vitest'
import { MAX_SIDE, fitWithin } from './image'

describe('fitWithin', () => {
  it("brings a phone camera's 12 MP photo down to 2048 on the long side", () => {
    expect(MAX_SIDE).toBe(2048)
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1536, height: 2048 })
  })

  it('never enlarges a small photo', () => {
    expect(fitWithin(1200, 900)).toEqual({ width: 1200, height: 900 })
    expect(fitWithin(2048, 100)).toEqual({ width: 2048, height: 100 })
  })

  it('rounds to whole pixels', () => {
    expect(fitWithin(4000, 3001)).toEqual({ width: 2048, height: 1537 })
  })
})
