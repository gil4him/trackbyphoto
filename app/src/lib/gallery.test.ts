import { describe, expect, it, vi } from 'vitest'

const { savePhoto } = vi.hoisted(() => ({ savePhoto: vi.fn() }))
vi.mock('@capacitor-community/media', () => ({ Media: { savePhoto, getAlbumsPath: vi.fn(), createAlbum: vi.fn() } }))

import { fileUrl, keepInPhotos } from './gallery'

describe('fileUrl', () => {
  it('turns a bare path into a file:// URL', () => {
    expect(fileUrl('/var/mobile/tmp/a.jpg')).toBe('file:///var/mobile/tmp/a.jpg')
  })
  it('leaves URLs as they are', () => {
    expect(fileUrl('file:///a.jpg')).toBe('file:///a.jpg')
    expect(fileUrl('content://media/1')).toBe('content://media/1')
  })
})

describe('keepInPhotos', () => {
  it('does nothing in a browser', async () => {
    await keepInPhotos('/a.jpg')
    expect(savePhoto).not.toHaveBeenCalled()
  })
})
