import { describe, it, expect } from 'vitest'
import { pendingRotation, quarter, rotateStyle, rotatedSize } from './photoRotate'

describe('photo rotation', () => {
  it('reads a pending rotation as a clockwise quarter turn', () => {
    expect(pendingRotation({})).toBe(0)
    expect(pendingRotation({ rotation: 90 })).toBe(90)
    expect(pendingRotation({ rotation: 450 })).toBe(90)
    expect(pendingRotation({ rotation: 360 })).toBe(0)
    expect(pendingRotation({ rotation: -90 })).toBe(270)
    expect(pendingRotation({ rotation: 'x' as unknown as number })).toBe(0)
    expect(quarter(NaN)).toBe(0)
  })

  it('swaps the sides on a quarter turn', () => {
    expect(rotatedSize(4, 3, 0)).toEqual({ w: 4, h: 3 })
    expect(rotatedSize(4, 3, 90)).toEqual({ w: 3, h: 4 })
    expect(rotatedSize(4, 3, 180)).toEqual({ w: 4, h: 3 })
    expect(rotatedSize(4, 3, 270)).toEqual({ w: 3, h: 4 })
  })

  it('turns with CSS only while something is pending', () => {
    expect(rotateStyle(0)).toBeUndefined()
    expect(rotateStyle(90)).toEqual({ transform: 'rotate(90deg)' })
    expect(rotateStyle(540)).toEqual({ transform: 'rotate(180deg)' })
  })
})
