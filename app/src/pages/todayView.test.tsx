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
import type { FamilyPhoto, Memo, Reaction } from '../types'

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
  it('one memo row per photo in the day\'s card: time on the left, the place\'s name, hearts and words counted at the end; no badge, no rail, no delete button, no thread', () => {
    const out = render({ rx: rx({ a: [{ kind: 'heart', actorName: '지민' }, { kind: 'comment', actorName: '지민', text: '좋아요' }] }) })
    expect(out.split('class="memo-row"').length - 1).toBe(2)
    expect(out).toContain('a 산책')
    expect(out).toContain('<span class="memo-row-meta">석촌호수</span>')
    expect(out).toContain('<span class="memo-rx-heart">♥ 1</span><span>💬 1</span>')
    expect(out.match(/memo-row-rx/g)?.length).toBe(1)
    expect(out).toContain('class="day-time">15:05')
    expect(out).toContain('class="day-card"')
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
    expect(seen).toContain('♥ 1')
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

describe('photos the family sent, on the parent\'s 내 사진', () => {
  const sent = (id: string, offset: number, h: number, o: Partial<FamilyPhoto> = {}): FamilyPhoto => ({
    id, patientUid: 'p1', senderUid: 'me', senderName: '지민', photoPath: `familyPhotos/${id}.jpg`, photoUrl: `https://x/${id}.jpg`, caption: '엄마, 주말에 한강 같이 가요!', status: 'ready', createdAtMs: day(offset, h).getTime(), ...o,
  })

  it('slot into the same day by time as tinted rows: who sent it, the time and their words, a dot while unseen', () => {
    const out = render({ received: [sent('f1', 0, 12)], onOpenReceived: () => {} })
    const rows = [...out.matchAll(/class="memo-row( received)?"/g)].map((m) => m[1] ? 'received' : 'own')
    expect(rows).toEqual(['own', 'received', 'own']) // 15:05 own, 12:05 sent, yesterday 09:05 own
    expect(out).toContain('지민이 보냈어요')
    expect(out).toContain('<span class="memo-row-meta">오후 12:05 · 엄마, 주말에 한강 같이 가요!</span>')
    expect(out).toContain('aria-label="새 사진"')
    expect(out).toContain('aria-label="가족 사진 보기"')
  })

  it('show the parent\'s answer instead of the caption once there is one, and no dot once seen', () => {
    const out = render({ received: [sent('f1', 0, 12, { seenAtMs: 1, reply: { kind: 'heart', atMs: 2 } })] })
    expect(out).toContain('<span class="memo-row-meta">오후 12:05 · ❤️ 고마워요</span>')
    expect(out).not.toContain('aria-label="새 사진"')
  })

  it('a day with only a sent photo still gets its header; photos not ready stay out', () => {
    const out = render({ memos: [], received: [sent('f1', 3, 10), sent('f2', 0, 9, { status: 'pending', photoUrl: undefined })] })
    expect(out.split('class="memo-row received"').length - 1).toBe(1)
    expect(out).toContain('class="tl-day"')
    expect(out).not.toContain('아직 기록이 없어요')
  })
})

describe('지난 기록 (the family\'s, simple edition): only what came before today', () => {
  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
  const mine = (id: string, offset: number, h: number): FamilyPhoto => ({
    id, patientUid: 'p1', senderUid: 'me', senderName: '지민', photoPath: `familyPhotos/${id}.jpg`, photoUrl: `https://x/${id}.jpg`, caption: '', status: 'ready', createdAtMs: day(offset, h).getTime(),
  })

  it("leaves today's photos and today's sent photos to 오늘", () => {
    const out = render({
      before: startOfToday(),
      sent: [{ photo: mine('s0', 0, 11), to: '엄마', color: 'red' }, { photo: mine('s1', 1, 8), to: '엄마', color: 'red' }],
    })
    expect(out).not.toContain('a 산책')
    expect(out).toContain('b 산책')
    expect(out.split('에게 보냄').length - 1).toBe(1)
    expect(out).not.toContain('오늘 ·')
  })

  it('says where today went when nothing older exists yet', () => {
    const out = render({ before: startOfToday(), memos: [memo('a', 0, 15)] })
    expect(out).toContain('아직 지난 사진이 없어요.')
    expect(out).toContain('오늘 찍은 사진은 내일 여기로 와요.')
    expect(render({ memos: [] })).toContain('아직 기록이 없어요.')
  })
})

describe("one's own 지난 기록: the parents' photos woven in", () => {
  it('indented in the parent\'s colour with their name, by time among one\'s own (a past day, morning first)', () => {
    const momMemo = memo('m', 1, 12)
    const out = render({ parents: [{ memo: momMemo, name: '엄마', color: 'seagreen' }] })
    expect(out).toContain('style="--pc:seagreen"')
    expect(out).toContain('엄마</b> 석촌호수')
    expect(out.indexOf('b 산책')).toBeLessThan(out.indexOf('엄마</b> 석촌호수'))
  })
})


describe('day headings, order within a day, and the calendar', () => {
  it('오늘 · date and 어제 · date; a past day runs morning first, today newest first', () => {
    const out = render({ memos: [memo('t2', 0, 15), memo('t1', 0, 9), memo('y2', 1, 18), memo('y1', 1, 8)] })
    expect(out).toMatch(/오늘 · \d+월 \d+일 \(.\)/)
    expect(out).toMatch(/어제 · \d+월 \d+일 \(.\)/)
    expect(out.indexOf('t2 산책')).toBeLessThan(out.indexOf('t1 산책'))
    expect(out.indexOf('y1 산책')).toBeLessThan(out.indexOf('y2 산책'))
  })
  it('the calendar floats only where asked, and only with photos to jump to', () => {
    expect(render({ calendar: true })).toContain('aria-label="날짜로 찾기"')
    expect(render()).not.toContain('날짜로 찾기')
    expect(render({ calendar: true, memos: [] })).not.toContain('날짜로 찾기')
  })
})

describe('과거 bottom room (A14.4)', () => {
  it('a list with the floating calendar keeps the last row clear of the buttons', () => {
    expect(render({ calendar: true })).toContain('class="page page-past"')
    expect(render()).toContain('<section class="page">')
  })
})
