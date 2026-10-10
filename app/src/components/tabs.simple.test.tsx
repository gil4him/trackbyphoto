// The bottom tabs in the simple edition.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../lib/edition', () => ({ isSimple: () => true, EDITION: 'simple' }))

import { Tabs } from './Tabs'

describe('Tabs (simple)', () => {
  it('has no 물어보기', () => {
    const html = renderToString(<Tabs active="home" onChange={() => {}} showAlerts />)
    expect(html).toContain('사진')
    expect(html).toContain('알림')
    expect(html).toContain('설정')
    expect(html).not.toContain('물어보기')
  })
})
