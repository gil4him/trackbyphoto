// A settings label whose explanation is folded behind ⓘ.
import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { SectLab } from './SectLab'

describe('SectLab', () => {
  it('shows the label and an ⓘ, with the explanation closed', () => {
    const html = renderToString(<SectLab info="끄면 보내기 전에 가족이 한 번 확인할 수 있어요.">자동 기록</SectLab>)
    expect(html).toContain('자동 기록')
    expect(html).toContain('aria-label="설명 보기"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('끄면 보내기 전에')
  })

  it('has no ⓘ when there is nothing to explain', () => {
    const html = renderToString(<SectLab>글자 크기</SectLab>)
    expect(html).toContain('글자 크기')
    expect(html).not.toContain('info-btn')
  })
})
