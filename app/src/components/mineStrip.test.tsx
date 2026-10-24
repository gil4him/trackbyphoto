// One's own photos of today, floating by the camera button on the family's 오늘.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('./MemoThumb', () => ({ MemoThumb: ({ memo }: { memo: { id: string } }) => <span className="tl-thumb" data-id={memo.id} /> }))
vi.mock('../hooks/useCapture', () => ({ useCapture: () => ({}) }))

import { CameraFab } from './CameraFab'
import { MineStrip } from './MineStrip'
import type { Memo } from '../types'

const m = (id: string) => ({ id }) as unknown as Memo

describe('MineStrip', () => {
  it('nothing until there is a photo today', () => {
    expect(renderToString(<MineStrip memos={[]} onOpen={() => {}} />)).toBe('')
  })
  it("one button per photo, newest first (next to the camera), on the button's line", () => {
    const strip = <MineStrip memos={[m('new'), m('old')]} onOpen={() => {}} />
    const html = renderToString(<CameraFab onClick={() => {}} strip={strip} />)
    expect(html.match(/class="mine-float-thumb"/g)?.length).toBe(2)
    expect(html.indexOf('data-id="new"')).toBeLessThan(html.indexOf('data-id="old"'))
    expect(html).toContain('aria-label="내 오늘 사진 2장"')
    // Same wrapper as the button: the strip comes first, the camera last.
    expect(html.indexOf('mine-float')).toBeLessThan(html.indexOf('class="cam-fab"'))
  })
})
