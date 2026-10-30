// Small copies of photos for the lists (오늘, 내 사진, 가족 사진…), so a page
// loads tens of KB per photo instead of the camera's megabytes. The full
// photo is only fetched on its own page.
//
// Photos never change in place (a rotated photo is rewritten under a new
// link, handlers/rotate.ts), so the original and its thumbnail are both
// marked to be kept by the phone for a year (PHOTO_CACHE): after the first
// look the phone shows them from its own storage.

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
    await writeThumb(photoPath, bytes)
  }
  await markKept(photoPath)
  return downloadLink(thumb.name)
}

/** Write (or overwrite) a photo's thumbnail from its bytes, under a fresh download token. */
export async function writeThumb(photoPath: string, original: Buffer): Promise<void> {
  await getStorage().bucket().file(thumbPathFor(photoPath)).save(await makeThumb(original), {
    resumable: false,
    contentType: 'image/jpeg',
    metadata: { cacheControl: PHOTO_CACHE, metadata: { firebaseStorageDownloadTokens: randomUUID() } },
  })
}

/**
 * Remake a photo's thumbnail from new bytes (a rotated photo), always
 * overwriting. The fresh token makes a new link, so phones that kept the old
 * thumbnail for a year (PHOTO_CACHE) fetch the new one.
 */
export async function remakeThumb(photoPath: string, original: Buffer): Promise<string> {
  await writeThumb(photoPath, original)
  const link = await downloadLink(thumbPathFor(photoPath))
  if (!link) throw new Error(`thumbnail missing after write: ${photoPath}`)
  return link
}

/**
 * Turn a photo upright (its EXIF orientation), then `deg` more degrees
 * clockwise. The output is a plain JPEG with no orientation tag.
 */
export async function rotateJpeg(original: Buffer, deg: number): Promise<Buffer> {
  return sharp(original).rotate().rotate(deg).jpeg({ quality: 90 }).toBuffer()
}

/**
 * Replace a stored photo's bytes (a rotated photo). The new download token
 * kills the old link: the original is cached by phones for a year
 * (PHOTO_CACHE), so only a new link shows the new bytes. Returns the new link.
 */
export async function replacePhoto(photoPath: string, bytes: Buffer): Promise<string> {
  await getStorage().bucket().file(photoPath).save(bytes, {
    resumable: false,
    contentType: 'image/jpeg',
    metadata: { cacheControl: PHOTO_CACHE, metadata: { firebaseStorageDownloadTokens: randomUUID() } },
  })
  const link = await downloadLink(photoPath)
  if (!link) throw new Error(`photo missing after write: ${photoPath}`)
  return link
}

/** Delete a photo's thumbnail alongside it; a missing one is fine. */
export async function deleteThumb(photoPath: string): Promise<void> {
  if (isThumbPath(photoPath)) return
  await getStorage().bucket().file(thumbPathFor(photoPath)).delete({ ignoreNotFound: true })
}
