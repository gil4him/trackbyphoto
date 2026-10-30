// One shot from the parent's screen: the phone's camera, then savePhoto.
// Pure in the sense that the camera and the save are passed in, so the
// outcomes can be tested without a phone.

import type { RestoredListenerEvent } from '@capacitor/app'
import type { Photo } from '@capacitor/camera'
import type { savePhoto } from './capture'
import { isCameraCancel, isCameraDenied } from './phoneCamera'
import { tr } from './lang'

export type Overlay = { ok: true; text: string } | { ok: false; text: string; sub: string }

export interface ShotDeps {
  uid: string
  /** Who the photo goes to, for "지은에게 보냈어요 ♥". */
  toName: string
  take: () => Promise<{ file: File; path?: string }>
  save: typeof savePhoto
}

/**
 * Take a photo and queue it for the family. The parent closing the camera
 * is not an error; the phone refusing the camera is its own outcome (the
 * screen then asks to allow it in Settings); anything else is the fail overlay.
 */
export async function takeAndSend(d: ShotDeps): Promise<Overlay | 'cancelled' | 'denied'> {
  let shot: { file: File; path?: string }
  try {
    shot = await d.take()
  } catch (err) {
    if (isCameraCancel(err)) return 'cancelled'
    if (isCameraDenied(err)) return 'denied'
    console.error('[ElderCamera] camera failed', err)
    return failed()
  }
  try {
    await d.save({ uid: d.uid, file: shot.file, nativePath: shot.path })
    return { ok: true, text: tr(`${d.toName}에게 보냈어요 ♥`, `Sent to ${d.toName} ♥`) }
  } catch (err) {
    console.error('[ElderCamera] save failed', err)
    return failed()
  }
}

const failed = (): Overlay => ({ ok: false, text: tr('사진을 저장하지 못했어요', "Couldn't save the photo"), sub: tr('다시 한 번 찍어 주세요', 'Please take it once more') })

/**
 * Android may kill the app while its camera is open; the photo then comes
 * back as an App `appRestoredResult` once the app is up again. Only a
 * successful Camera.getPhoto with a path is one of ours.
 */
export function restoredPhoto(ev: RestoredListenerEvent): Photo | null {
  if (ev.pluginId !== 'Camera' || ev.methodName !== 'getPhoto' || !ev.success) return null
  const data = ev.data as Photo | undefined
  return data && typeof data.webPath === 'string' && data.webPath ? data : null
}
