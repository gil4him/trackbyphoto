// One shot from the parent's screen: what each outcome of the phone's camera
// and of the save turns into.
import { describe, it, expect, vi } from 'vitest'
import type { RestoredListenerEvent } from '@capacitor/app'
import { restoredPhoto, takeAndSend } from './elderShot'

const file = new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' })
const shot = async () => ({ file, path: 'file:///tmp/photo.jpg' })

describe('takeAndSend', () => {
  it('queues the photo and says who it went to', async () => {
    const save = vi.fn(async () => ({ photoId: 'p1' }))
    const out = await takeAndSend({ uid: 'mom', toName: '지은', take: shot, save })
    expect(save).toHaveBeenCalledWith({ uid: 'mom', file, nativePath: 'file:///tmp/photo.jpg' })
    expect(out).toEqual({ ok: true, text: '지은에게 보냈어요 ♥' })
  })

  it('treats closing the camera as nothing, not as a failure', async () => {
    const save = vi.fn(async () => ({ photoId: 'p1' }))
    const take = async () => { throw new Error('User cancelled photos app') }
    expect(await takeAndSend({ uid: 'mom', toName: '지은', take, save })).toBe('cancelled')
    expect(save).not.toHaveBeenCalled()
  })

  it('reports the phone refusing the camera on its own', async () => {
    const take = async () => { throw new Error('User denied access to camera') }
    expect(await takeAndSend({ uid: 'mom', toName: '지은', take, save: vi.fn() })).toBe('denied')
  })

  it('shows the fail overlay for any other camera or save error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fail = { ok: false, text: '사진을 저장하지 못했어요', sub: '다시 한 번 찍어 주세요' }
    const broken = async () => { throw new Error('camera returned no path') }
    expect(await takeAndSend({ uid: 'mom', toName: '지은', take: broken, save: vi.fn() })).toEqual(fail)
    const save = vi.fn(async () => { throw new Error('disk full') })
    expect(await takeAndSend({ uid: 'mom', toName: '지은', take: shot, save })).toEqual(fail)
    spy.mockRestore()
  })
})

describe('restoredPhoto', () => {
  const ev = (over: Partial<RestoredListenerEvent>): RestoredListenerEvent =>
    ({ pluginId: 'Camera', methodName: 'getPhoto', success: true, data: { webPath: 'file:///p.jpg', format: 'jpeg' }, ...over }) as RestoredListenerEvent

  it('accepts only a successful Camera.getPhoto with a path', () => {
    expect(restoredPhoto(ev({}))?.webPath).toBe('file:///p.jpg')
    expect(restoredPhoto(ev({ pluginId: 'Geolocation' }))).toBeNull()
    expect(restoredPhoto(ev({ methodName: 'pickImages' }))).toBeNull()
    expect(restoredPhoto(ev({ success: false, error: { message: 'User cancelled photos app' } }))).toBeNull()
    expect(restoredPhoto(ev({ data: { format: 'jpeg' } }))).toBeNull()
  })
})
