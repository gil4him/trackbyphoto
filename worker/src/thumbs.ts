// Small copies of photos for the lists (오늘, 내 사진, 가족 사진…), so a page
// loads tens of KB per photo instead of the camera's megabytes. The full
// photo is only fetched on its own page.
//
// Photos never change, so the original and its thumbnail are both marked to
// be kept by the phone for a year (PHOTO_CACHE): after the first look the
// phone shows them from its own storage.

import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { getStorage } from 'firebase-admin/storage'
import { downloadLink } from './storageLinks.js'

/** Longest side of a thumbnail, in pixels (a list tile is ~120 css px, 3x screens). */
export const THUMB_EDGE = 480
/** Private: each link carries its own token, so shared caches must not keep it. */
export const PHOTO_CACHE = 'private, max-age=31536000, immutable'

/** photos/u/abc.jpg → photos/u/abc.thumb.jpg (same folder, so the same rules and clean-ups apply). */
export function thumbPathFor(photoPath: string): string {
  return `${photoPath.replace(/\.(jpe?g|png|webp|heic)$/i, '')}.thumb.jpg`
}

export function isThumbPath(path: string): boolean {
  return path.endsWith('.thumb.jpg')
}

/** Upright, at most THUMB_EDGE on its longest side, JPEG. */
export async function makeThumb(original: Buffer): Promise<Buffer> {
  return sharp(original)
    .rotate()
    .resize(THUMB_EDGE, THUMB_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70, mozjpeg: true })
    .toBuffer()
}

/** Mark a stored photo to be kept by the phone; no-op when it already is or isn't there. */
export async function markKept(path: string): Promise<void> {
  const file = getStorage().bucket().file(path)
  const [meta] = await file.getMetadata().catch(() => [null])
  if (meta && meta.cacheControl !== PHOTO_CACHE) await file.setMetadata({ cacheControl: PHOTO_CACHE })
}

/**
 * The thumbnail's link, making the thumbnail first when it isn't there yet,
 * and marking the original as kept. Null when the original is missing.
 * `original` saves a second download when the caller already has the bytes.
 */
export async function ensureThumb(photoPath: string, original?: Buffer): Promise<string | null> {
  const bucket = getStorage().bucket()
  const source = bucket.file(photoPath)
  const thumb = bucket.file(thumbPathFor(photoPath))
  const [exists] = await thumb.exists()
  if (!exists) {
    const [has] = await source.exists()
    if (!has) return null
    const bytes = original ?? (await source.download())[0]
    await thumb.save(await makeThumb(bytes), {
      resumable: false,
      contentType: 'image/jpeg',
      metadata: { cacheControl: PHOTO_CACHE, metadata: { firebaseStorageDownloadTokens: randomUUID() } },
    })
  }
  await markKept(photoPath)
  return downloadLink(thumb.name)
}

/** Delete a photo's thumbnail alongside it; a missing one is fine. */
export async function deleteThumb(photoPath: string): Promise<void> {
  if (isThumbPath(photoPath)) return
  await getStorage().bucket().file(thumbPathFor(photoPath)).delete({ ignoreNotFound: true })
}
