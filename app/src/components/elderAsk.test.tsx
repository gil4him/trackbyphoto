// The plain sentence before the phone's own permission question.
import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { ElderAsk } from './ElderAsk'
import { ASK_CAMERA, ASK_CAMERA_TO_LINK, ASK_LOCATION, toPermissionState } from '../lib/permissions'

describe('ElderAsk', () => {
  it('is one sentence and one 다음', () => {
    const html = renderToString(<ElderAsk text={ASK_CAMERA} onNext={() => {}} />)
    expect(html).toContain('사진을 찍으려면 카메라를 허용해 주세요')
    expect(html).toContain('다음')
    expect(ASK_CAMERA_TO_LINK).toBe('가족과 연결하려면 카메라를 허용해 주세요')
    expect(ASK_LOCATION).toBe('사진에 장소를 남기려면 위치를 허용해 주세요')
  })
})

describe('toPermissionState', () => {
  it('asks first only while the phone has not asked yet', () => {
    expect(toPermissionState('prompt')).toBe('prompt')
    expect(toPermissionState('prompt-with-rationale')).toBe('prompt')
    expect(toPermissionState('granted')).toBe('granted')
    expect(toPermissionState('limited')).toBe('granted')
    expect(toPermissionState('denied')).toBe('denied')
    expect(toPermissionState(undefined)).toBe('unknown')
  })
})
