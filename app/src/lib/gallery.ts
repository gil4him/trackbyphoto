import { Capacitor } from '@capacitor/core'
import { Media } from '@capacitor-community/media'

/**
 * Keep a copy of a photo just taken in the phone's own photos (the 오늘하루
 * album on Android, the camera roll on an iPhone), so it can always be found
 * there. Phone app only: a browser can't put a photo in the gallery without
 * the share sheet. Never throws — a declined permission just skips the copy.
 * (Home's camera does this through @capacitor/camera's saveToGallery; this is
 * for mom's camera, which takes photos from the live preview.)
 */

export const ALBUM = '오늘하루'

/** A local path as a file:// URL, which both platforms' savePhoto read. */
export function fileUrl(path: string): string {
  return /^[a-z]+:/i.test(path) ? path : `file://${path}`
}

async function androidAlbum(): Promise<string> {
  const { path } = await Media.getAlbumsPath()
  await Media.createAlbum({ name: ALBUM }).catch(() => {}) // already there
  return `${path}/${ALBUM}`
}

export async function keepInPhotos(path: string | undefined): Promise<void> {
  if (!path || !Capacitor.isNativePlatform()) return
  try {
    const albumIdentifier = Capacitor.getPlatform() === 'android' ? await androidAlbum() : undefined
    await Media.savePhoto({ path: fileUrl(path), albumIdentifier })
  } catch (err) {
    console.warn('[gallery] not kept in photos', err)
  }
}
