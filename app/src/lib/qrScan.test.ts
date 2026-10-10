import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./worker', () => ({ callWorker: vi.fn() }))

import { startQrScan } from './qrScan'
import { PUBLIC_ORIGIN } from './publicUrl'

const frame = new Blob(['jpeg'])
const LINK = `${PUBLIC_ORIGIN}/pair?c=ABCD2345`

describe('startQrScan', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('stops on the first frame with our pair link and reports the code once', async () => {
    const decode = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('https://example.com/menu')
      .mockResolvedValue(LINK)
    const onCode = vi.fn()
    const sample = vi.fn(async () => frame)
    startQrScan({ sample, decode, onCode, intervalMs: 100 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(onCode).toHaveBeenCalledTimes(1)
    expect(onCode).toHaveBeenCalledWith('ABCD2345')
    expect(decode).toHaveBeenCalledTimes(3)
  })

  it('never overlaps a slow decode', async () => {
    let release: (v: string | null) => void = () => {}
    const decode = vi.fn(() => new Promise<string | null>((r) => { release = r }))
    startQrScan({ sample: async () => frame, decode, onCode: vi.fn(), intervalMs: 100 })
    await vi.advanceTimersByTimeAsync(550)
    expect(decode).toHaveBeenCalledTimes(1)
    release(null)
    await vi.advanceTimersByTimeAsync(100)
    expect(decode).toHaveBeenCalledTimes(2)
  })

  it('shrugs off a failed frame and keeps scanning', async () => {
    const sample = vi.fn()
      .mockRejectedValueOnce(new Error('camera busy'))
      .mockResolvedValue(frame)
    const onCode = vi.fn()
    startQrScan({ sample, decode: async () => LINK, onCode, intervalMs: 100 })
    await vi.advanceTimersByTimeAsync(250)
    expect(onCode).toHaveBeenCalledWith('ABCD2345')
  })

  it('reports nothing once stopped, even mid-decode', async () => {
    let release: (v: string | null) => void = () => {}
    const onCode = vi.fn()
    const stop = startQrScan({
      sample: async () => frame,
      decode: () => new Promise((r) => { release = r }),
      onCode,
      intervalMs: 100,
    })
    await vi.advanceTimersByTimeAsync(150)
    stop()
    release(LINK)
    await vi.advanceTimersByTimeAsync(500)
    expect(onCode).not.toHaveBeenCalled()
  })
})

describe('jsQR reads the QR the family screen draws', () => {
  it('round-trips a pair link from the qrcode package', async () => {
    const { default: QRCode } = await import('qrcode')
    const { default: jsQR } = await import('jsqr')
    const qr = QRCode.create(LINK, { errorCorrectionLevel: 'M' })
    const n = qr.modules.size
    const cell = 6
    const quiet = 4
    const side = (n + quiet * 2) * cell
    const px = new Uint8ClampedArray(side * side * 4).fill(255)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!qr.modules.get(x, y)) continue
        for (let dy = 0; dy < cell; dy++) {
          for (let dx = 0; dx < cell; dx++) {
            const i = (((y + quiet) * cell + dy) * side + (x + quiet) * cell + dx) * 4
            px[i] = px[i + 1] = px[i + 2] = 0
          }
        }
      }
    }
    expect(jsQR(px, side, side)?.data).toBe(LINK)
  })
})
