import { Capacitor } from '@capacitor/core'
import { Camera } from '@capacitor/camera'
import { Geolocation } from '@capacitor/geolocation'

/**
 * Where a permission stands before the parent is asked (ElderAsk). Only
 * 'prompt' gets the plain-sentence screen first; 'unknown' (a browser that
 * can't tell) goes straight on, so nothing is ever blocked by the check.
 */
export type PermissionState = 'prompt' | 'granted' | 'denied' | 'unknown'

/** The plain sentences before the phone's own questions (ElderAsk). */
export const ASK_CAMERA_TO_LINK = '가족과 연결하려면 카메라를 허용해 주세요'
export const ASK_CAMERA = '사진을 찍으려면 카메라를 허용해 주세요'
export const ASK_LOCATION = '사진에 장소를 남기려면 위치를 허용해 주세요'

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

export async function locationPermission(): Promise<PermissionState> {
  try {
    if (Capacitor.isNativePlatform()) return toPermissionState((await Geolocation.checkPermissions()).location)
    return toPermissionState((await navigator.permissions?.query({ name: 'geolocation' }))?.state)
  } catch {
    return 'unknown'
  }
}
