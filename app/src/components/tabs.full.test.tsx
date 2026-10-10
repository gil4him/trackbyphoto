// The bottom tabs in the full edition.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../lib/edition', () => ({ isSimple: () => false, EDITION: 'full' }))

import { Tabs } from './Tabs'

describe('Tabs (full)', () => {
  it('keeps 물어보기', () => {
    const html = renderToString(<Tabs active="home" onChange={() => {}} showAlerts />)
    expect(html).toContain('사진')
    expect(html).toContain('알림')
    expect(html).toContain('설정')
    expect(html).toContain('물어보기')
  })
})
