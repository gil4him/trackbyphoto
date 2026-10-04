// Shrink a photo before upload. A phone photo is 2–5 MB; at 1600 px on the
// long side it is a few hundred KB, which matters on a weak connection and
// is still more detail than the memo model or the app's screens use. The
// full-size original stays in the phone's Photos app.

const MAX_SIDE = 1600
const QUALITY = 0.82

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
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
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
