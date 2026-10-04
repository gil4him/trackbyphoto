// Hold-to-talk recording for the parent's voice reply.
//
// The microphone is opened once per screen (the phone asks permission the
// first time) and kept open so each hold starts recording at once. A reply is
// at most MAX_MS long; a press shorter than MIN_MS is a slip, not a reply.

export const MAX_MS = 15_000
export const MIN_MS = 500

export interface Clip {
  blob: Blob
  ext: string
}

// Android and desktop record webm/opus; iPhones record mp4/aac.
const FORMATS = [
  { mime: 'audio/webm;codecs=opus', ext: 'webm' },
  { mime: 'audio/webm', ext: 'webm' },
  { mime: 'audio/mp4', ext: 'm4a' },
]

function pickFormat() {
  if (typeof MediaRecorder === 'undefined') return null
  return FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime)) ?? null
}

export function canRecord(): boolean {
  return !!navigator.mediaDevices?.getUserMedia && pickFormat() !== null
}

export class Mic {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private startedAt = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  get ready(): boolean { return this.stream !== null }
  get recording(): boolean { return this.recorder !== null }

  /** Open the microphone (may show the phone's permission prompt). */
  async open(): Promise<void> {
    if (this.stream) return
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  }

  /** Start a reply; `onLimit` fires if it reaches MAX_MS while still held. */
  start(onLimit: () => void): void {
    const format = pickFormat()
    if (!this.stream || !format || this.recorder) return
    this.chunks = []
    const rec = new MediaRecorder(this.stream, { mimeType: format.mime, audioBitsPerSecond: 32_000 })
    rec.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data) }
    rec.start()
    this.recorder = rec
    this.startedAt = Date.now()
    this.timer = setTimeout(onLimit, MAX_MS)
  }

  /** Finish the reply. Null when it was too short to be meant. */
  stop(): Promise<Clip | null> {
    const rec = this.recorder
    const format = pickFormat()
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (!rec || !format) return Promise.resolve(null)
    this.recorder = null
    const heldMs = Date.now() - this.startedAt
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: format.mime.split(';')[0] })
        this.chunks = []
        resolve(heldMs < MIN_MS || blob.size === 0 ? null : { blob, ext: format.ext })
      }
      rec.stop()
    })
  }

  /** Release the microphone (leaving the screen). */
  close(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (this.recorder) { this.recorder.onstop = null; this.recorder.stop(); this.recorder = null }
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }
}
