// Shrink a photo before upload. The phone's camera gives 3–5 MB; at 2048 px
// on the long side it is well under 1 MB, which matters on a weak connection
// and is still more detail than the memo model or the app's screens use
// (thumbnails are 480 px). The full-size original stays in the phone's
// Photos app (the camera saves it there). The canvas keeps no EXIF: no GPS
// or device data rides along; the pixels come upright from the camera.

export const MAX_SIDE = 2048
const QUALITY = 0.85

/** The size that fits inside `max` on the long side, never enlarged. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** Returns a JPEG no larger than MAX_SIDE; the original if shrinking fails
 *  or wouldn't make it smaller. */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    // An <img> applies the EXIF rotation, so the canvas gets upright pixels.
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image decode failed'))
      el.src = url
    })
    const size = fitWithin(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
    return out && out.size < file.size ? out : file
  } catch (err) {
    console.warn('[image] could not shrink; uploading the original', err)
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}
