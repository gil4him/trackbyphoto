// The screens' language (lib/lang.ts) and the English string table.
import { describe, it, expect } from 'vitest'
import { deviceLang, lang, legalPath, tr } from './lang'
import { S_KO } from './strings'
import { EN, EN_FAMILY_PHOTO_CAPTIONS, EN_QUICK_REPLIES } from './strings.en'
import { FAMILY_PHOTO_CAPTIONS, QUICK_REPLIES } from './strings'

describe('the phone language', () => {
  it('Korean phones get Korean, every other phone English', () => {
    expect(deviceLang(['ko-KR', 'en-US'])).toBe('ko')
    expect(deviceLang(['ko'])).toBe('ko')
    expect(deviceLang(['en-US', 'ko-KR'])).toBe('en')
    expect(deviceLang(['es-MX'])).toBe('en')
  })
})

describe('unit tests run in Korean', () => {
  it('whatever the machine says', () => {
    expect(lang).toBe('ko')
    expect(tr('사진 찍기', 'Take a photo')).toBe('사진 찍기')
    expect(legalPath('privacy')).toBe('/privacy')
  })
})

describe('the English string table', () => {
  it('has every Korean key, each of the same kind and arity', () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(S_KO).sort())
    for (const k of Object.keys(S_KO) as (keyof typeof S_KO)[]) {
      const ko = S_KO[k] as unknown, en = EN[k] as unknown
      expect(typeof en, k).toBe(typeof ko)
      if (typeof ko === 'function') expect((en as (...a: unknown[]) => unknown).length, k).toBe((ko as (...a: unknown[]) => unknown).length)
    }
  })

  it('has no Korean left in it', () => {
    const hangul = /[가-힣]/
    for (const [k, v] of Object.entries(EN)) {
      const text = typeof v === 'function' ? String((v as (...a: unknown[]) => string)('Jamie', 2, 3)) : String(v)
      expect(text, k).not.toMatch(hangul)
    }
    for (const t of [...EN_FAMILY_PHOTO_CAPTIONS, ...EN_QUICK_REPLIES]) expect(t).not.toMatch(hangul)
  })

  it('offers as many captions and quick replies as Korean', () => {
    expect(EN_FAMILY_PHOTO_CAPTIONS).toHaveLength(FAMILY_PHOTO_CAPTIONS.length)
    expect(EN_QUICK_REPLIES).toHaveLength(QUICK_REPLIES.length)
  })

  it('counts in English', () => {
    expect(EN.familyPhotoCardNew('Jamie', 0, 1)).toBe('Jamie sent a photo')
    expect(EN.familyPhotoCardNew('Jamie', 1, 3)).toBe('Jamie and 1 other sent 3 photos')
    expect(EN.planVoiceWaiting('Mom', 1)).toBe('1 reply from Mom is waiting')
  })
})
