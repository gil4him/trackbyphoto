import { Capacitor } from '@capacitor/core'
import { Camera } from '@capacitor/camera'
import { Geolocation } from '@capacitor/geolocation'
import { FirebaseMessaging } from '@capacitor-firebase/messaging'
import { tr } from './lang'

/**
 * Where a permission stands before the parent is asked (ElderAsk). Only
 * 'prompt' gets the plain-sentence screen first; 'unknown' (a browser that
 * can't tell) goes straight on, so nothing is ever blocked by the check.
 */
export type PermissionState = 'prompt' | 'granted' | 'denied' | 'unknown'

/** The plain sentences before the phone's own questions (ElderAsk). */
export const ASK_CAMERA_TO_LINK = tr('자녀와 연결하려면 카메라를 허용해 주세요', 'To connect with your family, please allow the camera')
export const ASK_CAMERA = tr('사진을 찍으려면 카메라를 허용해 주세요', 'To take photos, please allow the camera')
export const ASK_LOCATION = tr('사진에 장소를 남기려면 위치를 허용해 주세요', 'To note where each photo was taken, please allow location')
export const ASK_NOTIFY = tr('가족이 보낸 사진과 소식을 알려드리려면 알림을 허용해 주세요', 'To tell you about photos and news from your family, please allow notifications')

export function toPermissionState(s: string | undefined): PermissionState {
  if (s === 'granted' || s === 'limited') return 'granted'
  if (s === 'denied') return 'denied'
  if (s === 'prompt' || s === 'prompt-with-rationale') return 'prompt'
  return 'unknown'
}

export async function cameraPermission(): Promise<PermissionState> {
  try {
    return toPermissionState((await Camera.checkPermissions()).camera)
  } catch {
    return 'unknown'
  }
}

/** The phone app only; a browser answers 'unknown' and nothing is asked. */
export async function notificationPermission(): Promise<PermissionState> {
  try {
    if (!Capacitor.isNativePlatform()) return 'unknown'
    return toPermissionState((await FirebaseMessaging.checkPermissions()).receive)
  } catch {
    return 'unknown'
  }
}

export async function locationPermission(): Promise<PermissionState> {
  try {
    if (Capacitor.isNativePlatform()) return toPermissionState((await Geolocation.checkPermissions()).location)
    return toPermissionState((await navigator.permissions?.query({ name: 'geolocation' }))?.state)
  } catch {
    return 'unknown'
  }
}
