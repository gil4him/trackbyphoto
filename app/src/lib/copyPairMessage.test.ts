// 링크 복사하기: the pairing message goes to the clipboard, native or web.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const native = vi.hoisted(() => ({ on: false }))
const write = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.on, getPlatform: () => (native.on ? 'ios' : 'web') } }))
vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write } }))
vi.mock('@capacitor/share', () => ({ Share: {} }))

import { copyPairMessage } from './share'

describe('copyPairMessage', () => {
  beforeEach(() => { write.mockClear() })

  it('in the app, writes through the native clipboard', async () => {
    native.on = true
    await copyPairMessage('[Daylie] link')
    expect(write).toHaveBeenCalledWith({ string: '[Daylie] link' })
  })

  it('on the web, uses the browser clipboard', async () => {
    native.on = false
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await copyPairMessage('[Daylie] link')
    expect(writeText).toHaveBeenCalledWith('[Daylie] link')
    expect(write).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
