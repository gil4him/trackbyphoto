import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { THUMB_EDGE, isThumbPath, makeThumb, rotateJpeg, thumbPathFor } from '../src/thumbs'

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

  it('a turned photo is upright plus the turn, with no orientation tag', async () => {
    // Stored 4000x3000 with EXIF 6: upright it is a 3000x4000 portrait.
    const sideways = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#88aacc' } })
      .jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer()
    const quarter = await sharp(await rotateJpeg(sideways, 90)).metadata()
    expect([quarter.format, quarter.width, quarter.height]).toEqual(['jpeg', 4000, 3000])
    expect(quarter.orientation ?? 1).toBe(1)
    const half = await sharp(await rotateJpeg(sideways, 180)).metadata()
    expect([half.width, half.height]).toEqual([3000, 4000])
    expect(half.orientation ?? 1).toBe(1)
  })

  it('turns the pixels clockwise, not just the size', async () => {
    // Stored 40x30 with EXIF 6, left half red: upright, the top half is red.
    const red = await sharp({ create: { width: 20, height: 30, channels: 3, background: '#ff0000' } }).png().toBuffer()
    const stored = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#0000ff' } })
      .composite([{ input: red, left: 0, top: 0 }]).jpeg({ quality: 100 }).withMetadata({ orientation: 6 }).toBuffer()
    const px = async (buf: Buffer, x: number, y: number) => {
      const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
      const i = (y * info.width + x) * info.channels
      return data[0 + i] > 200 && data[2 + i] < 80 ? 'red' : 'blue'
    }
    const upright = await rotateJpeg(stored, 0)
    expect([await px(upright, 15, 2), await px(upright, 15, 37)]).toEqual(['red', 'blue'])
    const half = await rotateJpeg(stored, 180)
    expect([await px(half, 15, 2), await px(half, 15, 37)]).toEqual(['blue', 'red'])
    // A quarter turn clockwise: the red top ends up on the right.
    const quarter = await rotateJpeg(stored, 90)
    expect([await px(quarter, 2, 15), await px(quarter, 37, 15)]).toEqual(['blue', 'red'])
  })
})
