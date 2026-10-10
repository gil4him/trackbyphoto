// The simple edition's one consent screen on the parent's phone (§5).
import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { SimpleConsent } from './SimpleConsent'

const jieun = [{ status: 'active', caregiverName: '지은' }]

describe('SimpleConsent', () => {
  it('asks one question, names who will see the photos, details folded away', () => {
    const html = renderToString(<SimpleConsent caregivers={jieun} onAccept={() => {}} />)
    expect(html).toContain('가족에게 오늘 하루를 보여드릴까요?')
    expect(html).toContain('내가 찍은 사진과 찍은 곳을 지은에게 보여드려요.')
    expect(html).toContain('네, 지은에게 보여줄게요')
    expect(html).toContain('자세한 내용 보기')
    expect(html).not.toContain('연결된 가족만 볼 수 있어요.')
  })

  it('shows the details when asked', () => {
    const html = renderToString(<SimpleConsent caregivers={jieun} initialOpen onAccept={() => {}} />)
    expect(html).toContain('연결된 가족만 볼 수 있어요.')
    expect(html).toContain('가족 휴대폰에서 언제든 연결을 끊을 수 있어요.')
    expect(html).not.toContain('자세한 내용 보기')
  })

  it('says 가족 while the name is not known yet', () => {
    const html = renderToString(<SimpleConsent caregivers={[]} onAccept={() => {}} />)
    expect(html).toContain('내가 찍은 사진과 찍은 곳을 가족에게 보여드려요.')
    expect(html).toContain('네, 보여줄게요')
  })
})
