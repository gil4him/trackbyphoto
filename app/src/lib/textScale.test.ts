import { describe, it, expect } from 'vitest'
import { loadTextLevel, nextTextLevel, saveTextLevel, TEXT_LEVELS } from './textScale'

const store = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
}

describe('parent text size', () => {
  it('steps 보통 → 크게 → 아주 크게 → 보통', () => {
    const [normal, big, huge] = TEXT_LEVELS
    expect(nextTextLevel(normal)).toBe(big)
    expect(nextTextLevel(big)).toBe(huge)
    expect(nextTextLevel(huge)).toBe(normal)
    expect([normal.scale, big.scale, huge.scale]).toEqual([1, 1.25, 1.5])
  })

  it('is remembered on the phone, and starts at 보통', () => {
    const s = store()
    expect(loadTextLevel(s).key).toBe('normal')
    saveTextLevel(TEXT_LEVELS[2], s)
    expect(loadTextLevel(s).key).toBe('huge')
    s.setItem('tbp.elderTextScale', 'nonsense')
    expect(loadTextLevel(s).key).toBe('normal')
  })
})
