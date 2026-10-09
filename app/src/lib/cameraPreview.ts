import { Capacitor } from '@capacitor/core'
import { CameraPreview } from '@capacitor-community/camera-preview'

/**
 * The live viewfinder of the simple edition's parent screen (ElderCamera).
 *
 * One owner for the camera: start, stop and capture all go through here, so
 * nothing double-starts it (Android rejects a second start) and step 2's QR
 * pairing can sample frames from the same preview with captureSampleBase64.
 *
 * Native (iOS/Android): the plugin draws the camera BEHIND the web view
 * (toBack), so while it runs the page must be transparent — `camera-live` on
 * <html> does that (styles.css). Shots are written to a file, so the path can
 * go to Apple Vision through savePhoto just like the system camera's did.
 * Web: the plugin puts a getUserMedia <video> into the given parent element.
 */

const isNative = Capacitor.isNativePlatform()
const LIVE_CLASS = 'camera-live'
/** The <video> the web implementation creates; styled in styles.css. */
export const WEB_VIDEO_CLASS = 'elder-cam-video'

let running = false
let starting: Promise<void> | null = null

export async function startPreview(parentId: string): Promise<void> {
  if (running) return
  if (starting) return starting
  starting = (async () => {
    if (isNative) {
      document.documentElement.classList.add(LIVE_CLASS)
      try {
        await CameraPreview.start({
          position: 'rear',
          toBack: true,
          storeToFile: true,
          disableAudio: true,
          lockAndroidOrientation: true,
          enableHighResolution: true,
        })
      } catch (err) {
        document.documentElement.classList.remove(LIVE_CLASS)
        throw err
      }
    } else {
      await CameraPreview.start({ parent: parentId, className: WEB_VIDEO_CLASS, position: 'rear', disableAudio: true })
    }
    running = true
  })()
  try {
    await starting
  } finally {
    starting = null
  }
}

/** Safe to call any time: when it isn't running, or twice. */
export async function stopPreview(): Promise<void> {
  if (starting) await starting.catch(() => {})
  if (!running) return
  running = false
  if (isNative) document.documentElement.classList.remove(LIVE_CLASS)
  try {
    await CameraPreview.stop()
  } catch (err) {
    console.warn('[cameraPreview] stop failed', err)
  }
}

export function isPreviewRunning(): boolean {
  return running
}

/** Take a full-quality photo from the running preview. */
export async function capturePhoto(): Promise<{ file: File; nativePath?: string }> {
  const { value } = await CameraPreview.capture({ quality: 90 })
  if (isNative) {
    // storeToFile: `value` is the path of the JPEG the plugin wrote.
    const res = await fetch(Capacitor.convertFileSrc(value))
    const blob = await res.blob()
    return { file: new File([blob], 'photo.jpg', { type: 'image/jpeg' }), nativePath: value }
  }
  return { file: base64ToFile(value, 'photo.jpg', 'image/jpeg') }
}

/** A small, quick frame for scanning (step 2: QR pairing). Base64 JPEG. */
export async function captureSampleBase64(quality = 60): Promise<string> {
  const { value } = await CameraPreview.captureSample({ quality })
  return value
}

/** Base64 (with or without a data: prefix) to a File. */
export function base64ToFile(b64: string, name: string, type: string): File {
  const raw = atob(b64.replace(/^data:[^,]*,/, ''))
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return new File([bytes], name, { type })
}
