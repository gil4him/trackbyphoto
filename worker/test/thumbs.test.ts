import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { THUMB_EDGE, isThumbPath, makeThumb, thumbPathFor } from '../src/thumbs'

describe('thumbnails', () => {
  it('sit next to the photo under a name of their own', () => {
    expect(thumbPathFor('photos/u1/abc.jpg')).toBe('photos/u1/abc.thumb.jpg')
    expect(thumbPathFor('familyPhotos/p1/x.JPEG')).toBe('familyPhotos/p1/x.thumb.jpg')
    expect(thumbPathFor('photos/u1/noext')).toBe('photos/u1/noext.thumb.jpg')
    expect(isThumbPath('photos/u1/abc.thumb.jpg')).toBe(true)
    expect(isThumbPath('photos/u1/abc.jpg')).toBe(false)
  })

  it('are small, upright and keep the shape of the photo', async () => {
    // A 3000x4000 portrait, stored sideways with EXIF orientation 6 (as phones do).
    const sideways = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#88aacc' } })
      .jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer()
    const thumb = await makeThumb(sideways)
    const meta = await sharp(thumb).metadata()
    expect(meta.format).toBe('jpeg')
    expect([meta.width, meta.height]).toEqual([THUMB_EDGE * 3 / 4, THUMB_EDGE])
    expect(meta.orientation ?? 1).toBe(1)
    expect(thumb.length).toBeLessThan(sideways.length / 10)
  })

  it('never enlarge a small photo', async () => {
    const small = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#fff' } }).jpeg().toBuffer()
    const meta = await sharp(await makeThumb(small)).metadata()
    expect([meta.width, meta.height]).toEqual([200, 100])
  })
})
