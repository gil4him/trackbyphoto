// One shot from the parent's screen: what each outcome of the phone's camera
// and of the save turns into.
import { describe, it, expect, vi } from 'vitest'
import type { RestoredListenerEvent } from '@capacitor/app'
import { restoredPhoto, SENT_WAIT_MS, takeAndSend } from './elderShot'

const file = new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' })
const shot = async () => ({ file, path: 'file:///tmp/photo.jpg' })
const sent = async () => true

describe('takeAndSend', () => {
  it('says 보냈어요 only once the photo has reached the family', async () => {
    const save = vi.fn(async () => ({ photoId: 'p1' }))
    const waitSent = vi.fn(async () => true)
    const onSending = vi.fn()
    const out = await takeAndSend({ uid: 'mom', toName: '지은', take: shot, save, sent: waitSent, onSending })
    expect(save).toHaveBeenCalledWith({ uid: 'mom', file, nativePath: 'file:///tmp/photo.jpg' })
    expect(waitSent).toHaveBeenCalledWith('p1', SENT_WAIT_MS)
    expect(onSending).toHaveBeenCalledWith({ ok: true, sending: true, text: '보내는 중…' })
    expect(out).toEqual({ ok: true, text: '지은에게 보냈어요 ♥' })
  })

  it('a photo still on the phone is saved, and goes soon or the next time Daylie opens', async () => {
    const save = vi.fn(async () => ({ photoId: 'p1' }))
    for (const waitSent of [async () => false, async () => { throw new Error('store') }]) {
      expect(await takeAndSend({ uid: 'mom', toName: '지은', take: shot, save, sent: waitSent })).toEqual({
        ok: true, text: '사진을 저장했어요', sub: '곧 지은에게 보내요. 앱을 닫으면 다음에 열 때 보내요.',
      })
    }
  })

  it('treats closing the camera as nothing, not as a failure', async () => {
    const save = vi.fn(async () => ({ photoId: 'p1' }))
    const take = async () => { throw new Error('User cancelled photos app') }
    expect(await takeAndSend({ uid: 'mom', toName: '지은', take, save, sent })).toBe('cancelled')
    expect(save).not.toHaveBeenCalled()
  })

  it('reports the phone refusing the camera on its own', async () => {
    const take = async () => { throw new Error('User denied access to camera') }
    expect(await takeAndSend({ uid: 'mom', toName: '지은', take, save: vi.fn(), sent })).toBe('denied')
  })

  it('shows the fail overlay for any other camera or save error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fail = { ok: false, text: '사진을 저장하지 못했어요', sub: '다시 한 번 찍어 주세요' }
    const broken = async () => { throw new Error('camera returned no path') }
    expect(await takeAndSend({ uid: 'mom', toName: '지은', take: broken, save: vi.fn(), sent })).toEqual(fail)
    const save = vi.fn(async () => { throw new Error('disk full') })
    expect(await takeAndSend({ uid: 'mom', toName: '지은', take: shot, save, sent })).toEqual(fail)
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
