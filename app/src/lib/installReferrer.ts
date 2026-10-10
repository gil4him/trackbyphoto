import { Capacitor, registerPlugin } from '@capacitor/core'
import { pairCodeFromReferrer } from './pairing'

/** The app's own Android plugin (android/.../InstallReferrerPlugin.java). */
interface InstallReferrerPlugin {
  getReferrer(): Promise<{ referrer: string }>
}

const InstallReferrer = registerPlugin<InstallReferrerPlugin>('InstallReferrer')

/**
 * The pair code the Play link carried (the /pair page adds &referrer=c%3DCODE
 * to 앱 설치하기), or null — on iOS and the web, after a sideload, or when Play
 * can't say.
 */
export async function referrerPairCode(): Promise<string | null> {
  if (Capacitor.getPlatform() !== 'android') return null
  try {
    const { referrer } = await InstallReferrer.getReferrer()
    return pairCodeFromReferrer(referrer ?? '')
  } catch {
    return null
  }
}
