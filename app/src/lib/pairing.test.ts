import { describe, it, expect, vi } from 'vitest'

vi.mock('./worker', () => ({ callWorker: vi.fn() }))

import { pairCodeFromText } from './pairing'
import { PUBLIC_ORIGIN } from './publicUrl'

describe('pairCodeFromText — only our /pair links count', () => {
  it('reads the code from ?c= and #c=', () => {
    expect(pairCodeFromText(`${PUBLIC_ORIGIN}/pair?c=ABCD2345`)).toBe('ABCD2345')
    expect(pairCodeFromText(`${PUBLIC_ORIGIN}/pair#c=ABCD2345`)).toBe('ABCD2345')
  })

  it('tolerates case, dashes, spaces around the text and a trailing slash', () => {
    expect(pairCodeFromText(`  ${PUBLIC_ORIGIN}/pair/?c=abcd-2345\n`)).toBe('ABCD2345')
  })

  it('rejects another site, another path, or a bare code', () => {
    expect(pairCodeFromText('https://evil.example/pair?c=ABCD2345')).toBeNull()
    expect(pairCodeFromText(`${PUBLIC_ORIGIN}/accept?c=ABCD2345`)).toBeNull()
    expect(pairCodeFromText('ABCD2345')).toBeNull()
  })

  it('rejects a missing, short or long code', () => {
    expect(pairCodeFromText(`${PUBLIC_ORIGIN}/pair`)).toBeNull()
    expect(pairCodeFromText(`${PUBLIC_ORIGIN}/pair?c=ABC`)).toBeNull()
    expect(pairCodeFromText(`${PUBLIC_ORIGIN}/pair?c=ABCD23456789`)).toBeNull()
  })

  it('ignores garbage', () => {
    expect(pairCodeFromText('')).toBeNull()
    expect(pairCodeFromText('안녕하세요')).toBeNull()
  })
})
