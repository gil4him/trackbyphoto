import { describe, it, expect } from 'vitest'
import { clampPan, clampScale, doubleTapTarget, fitBox, isDoubleTap, pinch, touchAction, zoomAbout } from './photoZoom'

describe('photo zoom', () => {
  it('fits the photo inside its box, keeping its shape', () => {
    expect(fitBox({ w: 400, h: 300 }, { w: 4000, h: 3000 })).toEqual({ w: 400, h: 300 })
    expect(fitBox({ w: 400, h: 600 }, { w: 3000, h: 4000 })).toEqual({ w: 400, h: 400 * 4 / 3 })
    expect(fitBox({ w: 400, h: 300 }, { w: 3000, h: 4000 })).toEqual({ w: 225, h: 300 })
    expect(fitBox({ w: 400, h: 300 }, { w: 200, h: 100 })).toEqual({ w: 400, h: 200 })
    expect(fitBox({ w: 400, h: 300 }, { w: 0, h: 0 })).toEqual({ w: 0, h: 0 })
  })

  it('zooms between 1x and 4x', () => {
    expect(clampScale(0.5)).toBe(1)
    expect(clampScale(2)).toBe(2)
    expect(clampScale(9)).toBe(4)
    expect(clampScale(NaN)).toBe(1)
  })

  it('never pans at 1x, and never past the photo\'s edge when zoomed', () => {
    const box = { w: 400, h: 300 }
    const c = { w: 400, h: 300 }
    expect(clampPan({ x: 50, y: -20 }, 1, box, c)).toEqual({ x: 0, y: 0 })
    expect(clampPan({ x: 500, y: -500 }, 2, box, c)).toEqual({ x: 200, y: -150 })
    expect(clampPan({ x: 30, y: 10 }, 2, box, c)).toEqual({ x: 30, y: 10 })
    // A tall photo in a wide box: no side-to-side room until it outgrows the box.
    expect(clampPan({ x: 100, y: 0 }, 1.5, { w: 200, h: 300 }, c)).toEqual({ x: 0, y: 0 })
  })

  it('keeps the point under the finger in place', () => {
    const anchor = { x: 100, y: 50 }
    const pan = zoomAbout(1, { x: 0, y: 0 }, 2, anchor)
    expect(pan).toEqual({ x: -100, y: -50 })
    // The picture point under the anchor: (anchor - pan) / scale, the same before and after.
    expect((anchor.x - pan.x) / 2).toBe(anchor.x)
    expect(zoomAbout(2, pan, 2, anchor)).toEqual(pan)
  })

  it('scales with the fingers\' spread, within limits', () => {
    expect(pinch(1, 100, 200)).toBe(2)
    expect(pinch(2, 100, 50)).toBe(1)
    expect(pinch(3, 100, 300)).toBe(4)
    expect(pinch(2, 0, 50)).toBe(2)
  })

  it('double tap goes to 2.5x and back', () => {
    expect(doubleTapTarget(1)).toBe(2.5)
    expect(doubleTapTarget(1.6)).toBe(1)
    expect(doubleTapTarget(4)).toBe(1)
    expect(isDoubleTap(null, 1000, 0)).toBe(false)
    expect(isDoubleTap(1000, 1200, 10)).toBe(true)
    expect(isDoubleTap(1000, 1400, 10)).toBe(false)
    expect(isDoubleTap(1000, 1200, 80)).toBe(false)
  })

  it('lets the page scroll at 1x and keeps every touch when zoomed', () => {
    expect(touchAction(1)).toBe('pan-y')
    expect(touchAction(2)).toBe('none')
  })
})
