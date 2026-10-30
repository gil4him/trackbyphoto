import { Capacitor } from '@capacitor/core'
import { CameraPreview } from '@capacitor-community/camera-preview'

/**
 * The live viewfinder that looks for the family's QR on a phone that isn't
 * linked yet (pages/ElderPairStart.tsx). Photos are no longer taken here:
 * the parent's screen opens the phone's own camera (lib/capture.ts,
 * owner decision 2026-10-30).
 *
 * One owner for the camera: start and stop go through here, so nothing
 * double-starts it (Android rejects a second start); the pairing screen
 * samples frames from the running preview with captureSampleBlob.
 *
 * Native (iOS/Android): the plugin draws the camera BEHIND the web view
 * (toBack), so while it runs the page must be transparent — `camera-live` on
 * <html> does that (styles.css).
 * Web: the plugin puts a getUserMedia <video> into the given parent element.
 */

const isNative = Capacitor.isNativePlatform()
const LIVE_CLASS = 'camera-live'
/** The <video> the web implementation creates; styled in styles.css. */
export const WEB_VIDEO_CLASS = 'elder-cam-video'

let running = false
let starting: Promise<void> | null = null

export interface PreviewOptions {
  /** Native only. false (the pairing screen): iOS hands frame samples back
   *  as base64 instead of temp files. Defaults to true. */
  storeToFile?: boolean
}

export async function startPreview(parentId: string, opts: PreviewOptions = {}): Promise<void> {
  if (running) return
  if (starting) return starting
  starting = (async () => {
    if (isNative) {
      document.documentElement.classList.add(LIVE_CLASS)
      try {
        await CameraPreview.start({
          position: 'rear',
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
