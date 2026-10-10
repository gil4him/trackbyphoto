import { Capacitor } from '@capacitor/core'
import { CameraPreview } from '@capacitor-community/camera-preview'

/**
 * The live viewfinder of the simple edition's parent screen (ElderCamera).
 *
 * One owner for the camera: start, stop and capture all go through here, so
 * nothing double-starts it (Android rejects a second start) and step 2's QR
 * pairing (ElderPairStart) samples frames from the same preview with
 * captureSampleBlob.
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
/** Which camera shows: the back one first; flipCamera switches. */
let facing: 'rear' | 'front' = 'rear'
let lastStart: { parentId: string; opts: PreviewOptions } | null = null

export interface PreviewOptions {
  /** Native only. true (default): shots are written to a file for savePhoto.
   *  The pairing screen never takes photos, so it passes false — then iOS
   *  also hands frame samples back as base64 instead of temp files. */
  storeToFile?: boolean
}

export async function startPreview(parentId: string, opts: PreviewOptions = {}): Promise<void> {
  if (running) return
  if (starting) return starting
  lastStart = { parentId, opts }
  starting = (async () => {
    if (isNative) {
      document.documentElement.classList.add(LIVE_CLASS)
      try {
        await CameraPreview.start({
          position: facing,
          toBack: true,
          storeToFile: opts.storeToFile ?? true,
          disableAudio: true,
          lockAndroidOrientation: true,
          enableHighResolution: true,
        })
      } catch (err) {
        document.documentElement.classList.remove(LIVE_CLASS)
        throw err
      }
    } else {
      await CameraPreview.start({ parent: parentId, className: WEB_VIDEO_CLASS, position: facing, disableAudio: true })
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

/**
 * Switch between the back and front camera. The phone app flips the running
 * preview; a browser can't, so the preview restarts facing the other way.
 */
export async function flipCamera(): Promise<'rear' | 'front'> {
  facing = facing === 'rear' ? 'front' : 'rear'
  if (isNative && running) {
    await CameraPreview.flip()
  } else if (lastStart) {
    const { parentId, opts } = lastStart
    await stopPreview()
    await startPreview(parentId, opts)
  }
  return facing
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

/** A small, quick frame of the running preview, for QR scanning. */
export async function captureSampleBlob(quality = 60): Promise<Blob> {
  const { value } = await CameraPreview.captureSample({ quality })
  return sampleToBlob(value)
}

/**
 * captureSample answers with base64 JPEG on Android and the web, but with the
 * path of a temp JPEG on iOS when the preview stores to file — accept both.
 */
export async function sampleToBlob(value: string): Promise<Blob> {
  if (value.startsWith('/') || value.startsWith('file:')) {
    const res = await fetch(Capacitor.convertFileSrc(value))
    return res.blob()
  }
  return base64ToFile(value, 'sample.jpg', 'image/jpeg')
}

/** Base64 (with or without a data: prefix) to a File. */
export function base64ToFile(b64: string, name: string, type: string): File {
  const raw = atob(b64.replace(/^data:[^,]*,/, ''))
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return new File([bytes], name, { type })
}
