// The tab bar: five tabs with a numbered badge in the full edition, four
// (no 물어보기) with a dot in the simple edition (docs/DAYLIE_V3_UI_FIX.md A2).
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

const edition = { simple: false }
vi.mock('../lib/edition', () => ({ isSimple: () => edition.simple }))

import { Tabs } from './Tabs'

const labels = (html: string) => [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]).filter((l) => !l.startsWith('알림 '))

describe('Tabs', () => {
  it('full edition: 홈 · 사진 · 물어보기 · 알림 · 설정, unread as a number', () => {
    edition.simple = false
    const html = renderToString(<Tabs active="home" onChange={() => {}} showAlerts unreadCount={3} />)
    expect(labels(html)).toEqual(['주 메뉴', '홈', '사진', '물어보기', '알림', '설정'])
    expect(html).toContain('class="tab-badge"')
    expect(html).toContain('>3<')
    expect(html).not.toContain('tab-dot')
  })

  it('simple edition: 홈 · 사진 · 알림 · 설정, unread as a dot', () => {
    edition.simple = true
    const html = renderToString(<Tabs active="today" onChange={() => {}} showAlerts unreadCount={3} />)
    expect(labels(html)).toEqual(['주 메뉴', '홈', '사진', '알림', '설정'])
    expect(html).not.toContain('물어보기')
    expect(html).toContain('class="tab-dot"')
    expect(html).toContain('aria-label="알림 3건"')
    expect(html).not.toContain('tab-badge')
    expect(html).toContain('class="tab on"')
  })

  it('the label is its own span, so the active tab can tint the icon and not the word', () => {
    edition.simple = true
    const html = renderToString(<Tabs active="home" onChange={() => {}} />)
    expect(html).toContain('<span class="tab-label">홈</span>')
    expect(html).not.toContain('tab-dot')
  })
})
