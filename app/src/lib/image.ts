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

/** A photo turned deg clockwise (0/90/180/270), upright first, as a JPEG:
 *  what a share or a re-send carries while a rotation is still being saved
 *  (lib/photoRotate.ts). The photo itself when deg is 0 or turning fails. */
export async function rotateBlob(blob: Blob, deg: number): Promise<Blob> {
  const q = ((Math.round(deg / 90) * 90) % 360 + 360) % 360
  if (!q) return blob
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image decode failed'))
      el.src = url
    })
    const w = img.naturalWidth
    const h = img.naturalHeight
    const side = q === 90 || q === 270
    const canvas = document.createElement('canvas')
    canvas.width = side ? h : w
    canvas.height = side ? w : h
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((q * Math.PI) / 180)
    ctx.drawImage(img, -w / 2, -h / 2)
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    return out ?? blob
  } catch (err) {
    console.warn('[image] could not turn the photo; sending it as stored', err)
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}
