import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { TextSizeFab } from './TextSizeFab'
import { TEXT_LEVELS } from '../lib/textScale'

describe('TextSizeFab', () => {
  it('is a 가 button that says the current size', () => {
    const html = renderToString(<TextSizeFab level={TEXT_LEVELS[1]} onNext={() => {}} />)
    expect(html).toContain('가')
    expect(html).toContain('aria-label="글자 크기: 크게"')
  })
})
