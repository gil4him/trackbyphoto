// The native start options: the parent camera stores shots to a file; the
// pairing screen asks it not to.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const plugin = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  flip: vi.fn(async () => {}),
}))
vi.mock('@capacitor-community/camera-preview', () => ({ CameraPreview: plugin }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, convertFileSrc: (p: string) => p } }))

const classes = new Set<string>()
vi.stubGlobal('document', {
  documentElement: { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } },
})

import { flipCamera, startPreview, stopPreview } from './cameraPreview'

describe('native preview options', () => {
  beforeEach(async () => {
    await stopPreview()
    vi.clearAllMocks()
  })

  it('stores to file by default and makes the page see-through', async () => {
    await startPreview('cam')
    expect(plugin.start).toHaveBeenCalledWith(expect.objectContaining({ toBack: true, storeToFile: true }))
    expect(classes.has('camera-live')).toBe(true)
    await stopPreview()
    expect(classes.has('camera-live')).toBe(false)
  })

  it('can start without storing to file (pairing)', async () => {
    await startPreview('cam', { storeToFile: false })
    expect(plugin.start).toHaveBeenCalledWith(expect.objectContaining({ storeToFile: false }))
  })

  it('flips the running camera in place', async () => {
    await startPreview('cam')
    expect(await flipCamera()).toBe('front')
    expect(plugin.flip).toHaveBeenCalledTimes(1)
    expect(plugin.stop).not.toHaveBeenCalled()
    await flipCamera()
  })
})
