import { describe, it, expect } from 'vitest'
import { followPhoto, isTurned, pendingRotation, pinnedTurn, quarter, rotateStyle, rotatedSize, startPin, toggleTurn } from './photoRotate'

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

  it('↻ toggles: as shot → 90° clockwise → back again', () => {
    expect(isTurned({})).toBe(false)
    expect(isTurned({ turned: 90 })).toBe(true)
    expect(toggleTurn(false)).toEqual({ deg: 90, turned: true })
    expect(toggleTurn(true)).toEqual({ deg: -90, turned: false })
    // The turn back is a pending 270° clockwise for the worker and the screen.
    expect(quarter(toggleTurn(true).deg)).toBe(270)
  })

  describe('the file kept on screen', () => {
    it('keeps the first file and the look through a save', () => {
      let pin = startPin('a', 0)
      pin = followPhoto(pin, 'a', 90) // tap
      expect(pinnedTurn(pin, 90)).toBe(90)
      pin = followPhoto(pin, 'b', 0) // saved: new file, nothing pending
      expect(pin.pinned).toBe('a')
      expect(pinnedTurn(pin, 0)).toBe(90)
    })

    it('turns back to the shot across two saves', () => {
      let pin = startPin('a', 0)
      pin = followPhoto(pin, 'a', 90)
      pin = followPhoto(pin, 'b', 0)
      pin = followPhoto(pin, 'b', 270) // the tap back
      expect(pinnedTurn(pin, 270)).toBe(0)
      pin = followPhoto(pin, 'c', 0)
      expect(pin.pinned).toBe('a')
      expect(pinnedTurn(pin, 0)).toBe(0)
    })

    it('holds a tap made while a save lands', () => {
      let pin = startPin('a', 0)
      pin = followPhoto(pin, 'a', 90)
      pin = followPhoto(pin, 'a', 0) // tapped back on screen, not yet sent: 90 + 270
      pin = followPhoto(pin, 'b', 270) // the first turn saved; the tap still on screen
      expect(pin.pinned).toBe('a')
      expect(pinnedTurn(pin, 270)).toBe(0)
    })

    it('adopts the first file when there was none, and changes nothing otherwise', () => {
      const empty = startPin('', 0)
      expect(followPhoto(empty, '', 0)).toBe(empty)
      expect(followPhoto(empty, 'a', 90)).toEqual(startPin('a', 90))
      const same = startPin('a', 90)
      expect(followPhoto(same, 'a', 90)).toBe(same)
    })

    it('stays on the first file when a thumbnail arrives, unturned', () => {
      const pin = followPhoto(startPin('full', 0), 'thumb', 0)
      expect(pin.pinned).toBe('full')
      expect(pinnedTurn(pin, 0)).toBe(0)
    })
  })
})
