// The phone's camera answer as a File, and telling a closed camera from a
// refused one.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@capacitor/camera', () => ({
  Camera: { getPhoto: vi.fn() },
  CameraDirection: { Rear: 'REAR', Front: 'FRONT' },
  CameraResultType: { Uri: 'uri' },
  CameraSource: { Camera: 'CAMERA' },
}))

import { Camera } from '@capacitor/camera'
import { PARENT_CAMERA, captureNativePhoto, isCameraCancel, isCameraDenied, photoFromResult } from './phoneCamera'

describe('photoFromResult', () => {
  it('turns the plugin answer into a JPEG file and keeps the file:// path for Vision', async () => {
    const fetchMock = vi.fn(async () => new Response('jpeg-bytes', { headers: { 'content-type': 'image/jpeg' } }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const out = await photoFromResult({ webPath: 'capacitor://localhost/_capacitor_file_/tmp/p.jpg', path: 'file:///tmp/p.jpg', format: 'jpeg', saved: true })
      expect(fetchMock).toHaveBeenCalledWith('capacitor://localhost/_capacitor_file_/tmp/p.jpg')
      expect(out.file.name).toBe('photo.jpeg')
      expect(out.file.type).toBe('image/jpeg')
      expect(await out.file.text()).toBe('jpeg-bytes')
      expect(out.path).toBe('file:///tmp/p.jpg')
      // No file:// path: the web path is what Vision gets.
      expect((await photoFromResult({ webPath: 'blob:x', format: 'jpeg', saved: false })).path).toBe('blob:x')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('refuses an answer without a path', async () => {
    await expect(photoFromResult({ format: 'jpeg', saved: false })).rejects.toThrow('no path')
  })
})

describe('captureNativePhoto', () => {
  it("opens the phone's camera with the parent's options on top of the defaults", async () => {
    vi.mocked(Camera.getPhoto).mockResolvedValueOnce({ webPath: 'blob:p', format: 'jpeg', saved: true })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x')))
    try {
      await captureNativePhoto(PARENT_CAMERA)
      expect(Camera.getPhoto).toHaveBeenCalledWith(expect.objectContaining({ quality: 92, correctOrientation: true, saveToGallery: true, direction: 'REAR', source: 'CAMERA', resultType: 'uri' }))
      expect(Camera.getPhoto).not.toHaveBeenCalledWith(expect.objectContaining({ width: expect.anything() }))
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('what the camera said', () => {
  it('knows a closed camera from a refused one', () => {
    expect(isCameraCancel(new Error('User cancelled photos app'))).toBe(true)
    expect(isCameraDenied(new Error('User cancelled photos app'))).toBe(false)
    expect(isCameraDenied(new Error('User denied access to camera'))).toBe(true)
    expect(isCameraCancel('User cancelled photos app')).toBe(true)
    expect(isCameraCancel(new Error('camera returned no path'))).toBe(false)
    expect(isCameraDenied(undefined)).toBe(false)
  })
})
