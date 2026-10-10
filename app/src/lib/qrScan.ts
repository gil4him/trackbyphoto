import { pairCodeFromText } from './pairing'

/**
 * Looks for the family's pairing QR in frames of the running viewfinder
 * (ElderPairStart). Every `intervalMs` it takes one sample and decodes it;
 * a slow decode is never overlapped by the next one. Stops by itself on the
 * first frame that holds one of our /pair links (pairCodeFromText) — other
 * QR codes are ignored — and calls onCode once.
 */
export function startQrScan(opts: {
  sample: () => Promise<Blob>
  onCode: (code: string) => void
  decode?: (frame: Blob) => Promise<string | null>
  intervalMs?: number
}): () => void {
  const decode = opts.decode ?? decodeQrFrame
  let stopped = false
  let busy = false

  const stop = () => {
    stopped = true
    clearInterval(timer)
  }

  const tick = async () => {
    if (stopped || busy) return
    busy = true
    try {
      const text = await decode(await opts.sample())
      const code = text ? pairCodeFromText(text) : null
      if (code && !stopped) {
        stop()
        opts.onCode(code)
      }
    } catch {
      // A dropped frame (camera busy, decode error) — try the next one.
    } finally {
      busy = false
    }
  }

  const timer = setInterval(() => { void tick() }, opts.intervalMs ?? 500)
  return stop
}

/** Frames are scaled down to this longest side before decoding: a QR held
 *  up to the phone stays readable and jsQR stays fast. */
const MAX_SIDE = 800

/** The text of the QR code in a JPEG frame, or null. Browser-only. */
export async function decodeQrFrame(frame: Blob): Promise<string | null> {
  const [{ default: jsQR }, bitmap] = await Promise.all([import('jsqr'), createImageBitmap(frame)])
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, w, h)
    const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })
    return found?.data ?? null
  } finally {
    bitmap.close()
  }
}
