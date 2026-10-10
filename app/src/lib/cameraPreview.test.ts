import { describe, it, expect, vi, beforeEach } from 'vitest'

const plugin = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  capture: vi.fn(async () => ({ value: btoa('jpeg-bytes') })),
  captureSample: vi.fn(async () => ({ value: 'c2FtcGxl' })),
  flip: vi.fn(async () => {}),
}))
vi.mock('@capacitor-community/camera-preview', () => ({ CameraPreview: plugin }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, convertFileSrc: (p: string) => p } }))

import { base64ToFile, capturePhoto, captureSampleBlob, flipCamera, isPreviewRunning, sampleToBlob, startPreview, stopPreview } from './cameraPreview'

describe('base64ToFile', () => {
  it('decodes plain and data: URL base64', async () => {
    const plain = base64ToFile(btoa('hello'), 'a.jpg', 'image/jpeg')
    const dataUrl = base64ToFile('data:image/jpeg;base64,' + btoa('hello'), 'a.jpg', 'image/jpeg')
    expect(await plain.text()).toBe('hello')
    expect(await dataUrl.text()).toBe('hello')
    expect(plain.type).toBe('image/jpeg')
    expect(plain.name).toBe('a.jpg')
  })
})

describe('the preview owner', () => {
  beforeEach(async () => {
    await stopPreview()
    vi.clearAllMocks()
  })

  it('starts once, even when asked twice at the same time', async () => {
    await Promise.all([startPreview('cam'), startPreview('cam')])
    await startPreview('cam')
    expect(plugin.start).toHaveBeenCalledTimes(1)
    expect(plugin.start).toHaveBeenCalledWith(expect.objectContaining({ parent: 'cam', position: 'rear', disableAudio: true }))
    expect(isPreviewRunning()).toBe(true)
  })

  it('stops only what is running', async () => {
    await stopPreview()
    expect(plugin.stop).not.toHaveBeenCalled()
    await startPreview('cam')
    await stopPreview()
    await stopPreview()
    expect(plugin.stop).toHaveBeenCalledTimes(1)
    expect(isPreviewRunning()).toBe(false)
  })

  it('can start again after a failed start', async () => {
    plugin.start.mockRejectedValueOnce(new Error('NotAllowedError'))
    await expect(startPreview('cam')).rejects.toThrow('NotAllowedError')
    expect(isPreviewRunning()).toBe(false)
    await startPreview('cam')
    expect(isPreviewRunning()).toBe(true)
  })

  it('turns a web capture into a JPEG file', async () => {
    const shot = await capturePhoto()
    expect(shot.nativePath).toBeUndefined()
    expect(await shot.file.text()).toBe('jpeg-bytes')
  })
})

describe('frame samples for QR scanning', () => {
  it('decodes a base64 sample (Android, web)', async () => {
    plugin.captureSample.mockResolvedValueOnce({ value: btoa('frame') })
    expect(await (await captureSampleBlob()).text()).toBe('frame')
  })

  it('reads a temp-file sample (iOS storing to file)', async () => {
    const fetchMock = vi.fn(async () => new Response('file-frame'))
    vi.stubGlobal('fetch', fetchMock)
    try {
      expect(await (await sampleToBlob('/tmp/sample.jpg')).text()).toBe('file-frame')
      expect(await (await sampleToBlob('file:///tmp/sample.jpg')).text()).toBe('file-frame')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('flipping the camera in a browser', () => {
  it('restarts the preview facing the other way, and back', async () => {
    await stopPreview()
    vi.clearAllMocks()
    await startPreview('cam')
    expect(await flipCamera()).toBe('front')
    expect(plugin.stop).toHaveBeenCalledTimes(1)
    expect(plugin.start).toHaveBeenLastCalledWith(expect.objectContaining({ parent: 'cam', position: 'front' }))
    expect(await flipCamera()).toBe('rear')
    expect(plugin.start).toHaveBeenLastCalledWith(expect.objectContaining({ position: 'rear' }))
    expect(plugin.flip).not.toHaveBeenCalled()
    await stopPreview()
  })
})
