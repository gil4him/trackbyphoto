// The full edition's pairing message is unchanged.
import { describe, it, expect, vi } from 'vitest'

vi.mock('./edition', () => ({ isSimple: () => false, EDITION: 'full' }))

import { buildPairMessage } from './share'

describe('full pairing message', () => {
  it('asks for 연결하기, with no install step', () => {
    const text = buildPairMessage('엄마', 'https://trackbyphoto.web.app/pair?c=ABCD2345', 'ABCD2345', 1)
    expect(text).toBe([
      '[오늘하루] 엄마님 휴대폰을 연결해요.',
      "아래 링크를 누르고 '연결하기'를 눌러주세요. (1시간 유효)",
      'https://trackbyphoto.web.app/pair?c=ABCD2345',
      '앱에서는 코드 ABCD 2345 를 입력하세요.',
    ].join('\n'))
  })
})
