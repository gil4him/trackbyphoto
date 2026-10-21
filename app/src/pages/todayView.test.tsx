// The 사진 list, rendered without a browser: one memo row per photo with the
// time and what family left on it, no delete button, quiet day headers
// (docs/DAYLIE_V3_UI_FIX.md A3, A13).
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

const edition = { simple: false }
vi.mock('../lib/edition', () => ({ isSimple: () => edition.simple }))
vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../hooks/useOutbox', () => ({ useOutbox: () => [] }))
vi.mock('../hooks/useWorkerStatus', () => ({ useWorkerStatus: () => 'up' }))
vi.mock('../components/MemoThumb', () => ({ MemoThumb: () => <span className="tl-thumb" /> }))

import { Today } from './Today'
import { rowCounts } from '../lib/memoViews'
import { ToastProvider } from '../components/Toast'
import type { ReactionsContext } from '../components/Reactions'
import type { Memo, Reaction } from '../types'

const day = (offset: number, h: number) => { const d = new Date(); d.setDate(d.getDate() - offset); d.setHours(h, 5, 0, 0); return d }
const memo = (id: string, offset: number, h: number, extra: Record<string, unknown> = {}) => ({
  id, patientUid: 'p1', photoPath: `photos/p1/${id}.jpg`, status: 'ready', memo: `${id} 산책`, activity: '산책', place: '석촌호수', lat: 37.5, lng: 127, takenAt: { toDate: () => day(offset, h) }, ...extra,
}) as unknown as Memo
const rx = (items: Record<string, Partial<Reaction>[]>) => ({
  byMemo: new Map(Object.entries(items).map(([k, v]) => [k, v as Reaction[]])), me: { uid: 'me', name: '지민' }, patientUid: 'p1', patientName: '엄마', canReact: true, voiceOn: false, voiceAllowed: false,
}) as unknown as ReactionsContext
const render = (props: Partial<Parameters<typeof Today>[0]> = {}) => renderToString(
  <ToastProvider><Today memos={[memo('a', 0, 15), memo('b', 1, 9)]} onOpen={() => {}} {...props} /></ToastProvider>,
).replace(/<!-- -->/g, '')

describe('rowCounts', () => {
  it('hearts and words, only what exists', () => {
    expect(rowCounts([{ kind: 'heart', actorName: '지민' }, { kind: 'heart', actorName: '민수' }, { kind: 'comment', actorName: '지민' }] as Reaction[])).toBe('♥ 2 · 💬 1')
    expect(rowCounts([{ kind: 'comment', actorName: '지민' }] as Reaction[])).toBe('💬 1')
    expect(rowCounts(undefined)).toBe('')
  })
})

describe('Today', () => {
  it('one memo row per photo: title, then time · place · category · who left what; no badge, no rail, no delete button, no thread', () => {
    const out = render({ rx: rx({ a: [{ kind: 'heart', actorName: '지민' }, { kind: 'comment', actorName: '지민', text: '좋아요' }] }) })
    expect(out.split('class="memo-row"').length - 1).toBe(2)
    expect(out).toContain('a 산책')
    expect(out).toContain('<span class="memo-row-meta">오후 3:05 · 석촌호수 · 산책 · ♥ 지민 · 💬 1</span>')
    expect(out).toContain('<span class="memo-row-meta">오전 9:05 · 석촌호수 · 산책</span>')
    expect(out).not.toContain('memo-row-badge')
    expect(out).not.toContain('day-rail')
    expect(out).not.toContain('tl-item')
    expect(out).not.toContain('del-btn')
    expect(out).not.toContain('사진 삭제')
    expect(out).not.toContain('class="rx"')
    expect(out).not.toContain('좋아요')
  })

  it("on the parent's own phone, a heart or word they have not seen marks the card", () => {
    const own = (items: Record<string, Partial<Reaction>[]>) => ({ ...rx(items), canReact: false, me: { uid: 'p1', name: '엄마' } }) as ReactionsContext
    const fresh = render({ rx: own({ a: [{ kind: 'heart', actorName: '지민', actorUid: 'me', status: 'ready' }] }) })
    expect(fresh).toContain('<span class="memo-row-new" aria-label="새 소식"></span>')
    const seen = render({ rx: own({ a: [{ kind: 'heart', actorName: '지민', actorUid: 'me', status: 'ready', readByElderAt: {} as never }] }) })
    expect(seen).toContain('♥ 지민')
    expect(seen).not.toContain('새 소식')
    // The family's own list never carries the mark.
    expect(render({ rx: rx({ a: [{ kind: 'heart', actorName: '지민', actorUid: 'me', status: 'ready' }] }) })).not.toContain('memo-row-new')
  })

  it('day headers are quiet captions; 다녀온 곳 › on a day with a located photo, in both editions', () => {
    edition.simple = false
    const full = render({ onOpenTrail: () => {} })
    expect(full).toContain('<div class="tl-day">오늘')
    expect(full).toContain('다녀온 곳 ›')
    edition.simple = true
    const simple = render({ onOpenTrail: () => {} })
    expect(simple).toContain('<div class="tl-day">어제')
    expect(simple).toContain('다녀온 곳 ›')
    // Not without the trail map, and not on a day whose photos have no location.
    expect(render()).not.toContain('다녀온 곳')
    expect(render({ memos: [memo('a', 0, 15, { lat: null, lng: null })], onOpenTrail: () => {} })).not.toContain('다녀온 곳')
  })
})
