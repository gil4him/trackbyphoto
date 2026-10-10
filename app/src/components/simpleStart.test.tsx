// The simple edition's Home before a parent is linked.
import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { SimpleStart } from './SimpleStart'

describe('SimpleStart', () => {
  it('shows how to start and one button, no camera', () => {
    const html = renderToString(<SimpleStart name="지은" onConnect={() => {}} />).replace(/<!-- -->/g, '')
    expect(html).toContain('지은님, 안녕하세요')
    expect(html).toContain('카카오톡으로 엄마에게 링크를 보내요')
    expect(html).toContain('엄마가 찍은 사진이 여기에 와요')
    expect(html).toContain('엄마 연결하기')
    expect(html).not.toContain('사진 찍기')
  })
})
