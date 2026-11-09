// One shot from the parent's screen: the phone's camera, then savePhoto.
// Pure in the sense that the camera and the save are passed in, so the
// outcomes can be tested without a phone.

import type { RestoredListenerEvent } from '@capacitor/app'
import type { Photo } from '@capacitor/camera'
import type { savePhoto } from './capture'
import { isCameraCancel, isCameraDenied } from './phoneCamera'
import { tr } from './lang'

/** ok: sent ("보냈어요 ♥"), or saved on the phone and going later (with `sub`). `sending`: still trying. */
export type Overlay = { ok: true; text: string; sub?: string; sending?: boolean } | { ok: false; text: string; sub: string }

/** How long the screen waits for the photo to reach the family before saying it will go later.
 *  Covers the outbox's 10-second wait for a location. */
export const SENT_WAIT_MS = 12_000

export interface ShotDeps {
  uid: string
  /** Who the photo goes to, for "지은에게 보냈어요 ♥". */
  toName: string
  take: () => Promise<{ file: File; path?: string }>
  save: typeof savePhoto
  /** True once the photo has reached the server (Outbox.whenSent). */
  sent: (photoId: string, withinMs: number) => Promise<boolean>
  /** Shown while waiting for `sent`. */
  onSending?: (o: Overlay) => void
}

/**
 * Take a photo and send it to the family. "보냈어요 ♥" only once it has
 * reached the server; if it is still on the phone after SENT_WAIT_MS, the
 * parent is told it goes soon, or the next time Daylie is opened (owner,
 * 2026-11-09: a photo once waited six days behind "보냈어요"). The parent
 * closing the camera is not an error; the phone refusing the camera is its
 * own outcome (the screen then asks to allow it in Settings); anything else
 * is the fail overlay.
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
  let photoId: string
  try {
    photoId = (await d.save({ uid: d.uid, file: shot.file, nativePath: shot.path })).photoId
  } catch (err) {
    console.error('[ElderCamera] save failed', err)
    return failed()
  }
  d.onSending?.(sending())
  const sent = await d.sent(photoId, SENT_WAIT_MS).catch(() => false)
  return sent ? sentTo(d.toName) : savedForLater(d.toName)
}

export const sending = (): Overlay => ({ ok: true, sending: true, text: tr('보내는 중…', 'Sending…') })
export const sentTo = (name: string): Overlay => ({ ok: true, text: tr(`${name}에게 보냈어요 ♥`, `Sent to ${name} ♥`) })
export const savedForLater = (name: string): Overlay => ({
  ok: true,
  text: tr('사진을 저장했어요', 'Photo saved'),
  sub: tr(`곧 ${name}에게 보내요. 앱을 닫으면 다음에 열 때 보내요.`, `It goes to ${name} soon. If you close the app, it goes the next time you open it.`),
})

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
