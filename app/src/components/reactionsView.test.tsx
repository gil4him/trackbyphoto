// What the reaction components show, rendered without a browser.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../lib/reactions', () => ({
  COMMENT_MAX: 60,
  familyActor: vi.fn(), removeReaction: vi.fn(), sendComment: vi.fn(), sendFamilyHeart: vi.fn(),
}))

import { FamilyNewsCard } from './FamilyNewsCard'
import { Reactions, type ReactionsContext } from './Reactions'
import { ToastProvider } from './Toast'
import type { Reaction } from '../types'

function r(id: string, over: Partial<Reaction> = {}): Reaction {
  return { id, memoId: 'm1', patientUid: 'p1', actorUid: 'cg1', actorName: '민수', kind: 'heart', status: 'ready', createdAtMs: 1_800_000_000_000, ...over }
}
const voice = r('v1', { actorUid: 'p1', actorName: '어머니', kind: 'voice', audioUrl: 'https://example.test/v.webm', transcript: '괜찮아, 오늘 많이 걸었어' })

function ctx(items: Reaction[], over: Partial<ReactionsContext> = {}): ReactionsContext {
  return {
    byMemo: new Map([['m1', items]]), me: { uid: 'cg1', name: '민수' }, patientUid: 'p1', patientName: '어머니',
    canReact: true, voiceOn: true, voiceAllowed: true, ...over,
  }
}
const html = (c: ReactionsContext) => renderToString(<ToastProvider><Reactions memoId="m1" ctx={c} /></ToastProvider>)

describe('FamilyNewsCard', () => {
  it('is a dim line when there is no news', () => {
    const out = renderToString(<FamilyNewsCard news={{ state: 'none' }} onOpen={() => {}} />)
    expect(out).toContain('오늘 가족 소식이 아직 없어요')
    expect(out).not.toContain('<button')
  })
  it('lights up with who sent a heart, without counts', () => {
    const out = renderToString(<FamilyNewsCard news={{ state: 'new', item: r('h'), unreadIds: ['h', 'x', 'y'] }} onOpen={() => {}} />)
    expect(out).toContain('민수가 하트를 보냈어요')
    expect(out).toContain('news-card tappable on')
    expect(out).not.toMatch(/\d/)
  })
})

describe('Reactions (family feed)', () => {
  it('offers family a heart and a 60-character comment field', () => {
    const out = html(ctx([]))
    expect(out).toContain('짧게 남겨 주세요 (60자)')
    expect(out).toContain('maxLength="60"')
    expect(out).toContain('하트 보내기')
  })

  it('plays the parent\'s voice reply with its transcript when the plan includes it', () => {
    const out = html(ctx([voice]))
    expect(out).toContain('<audio')
    expect(out).toContain('괜찮아, 오늘 많이 걸었어')
  })

  it('shows the locked card on a plan without voice replies, never the words or the clip', () => {
    const out = html(ctx([voice], { voiceAllowed: false }))
    expect(out).toContain('어머니 목소리로 답장을 받아보세요 · Basic')
    expect(out).not.toContain('<audio')
    expect(out).not.toContain('괜찮아')
  })

  it('hides voice replies entirely until they are rolled out', () => {
    const out = html(ctx([voice], { voiceOn: false }))
    expect(out).not.toContain('목소리')
    expect(out).not.toContain('<audio')
  })

  it('lets the patient answer family from their own feed, only where family reacted', () => {
    const own = { canReact: false, me: { uid: 'p1', name: '어머니' }, onReply: () => {} }
    expect(html(ctx([r('c', { kind: 'comment', text: '엄마 날씨 좋네요' })], own))).toContain('답장하기')
    expect(html(ctx([r('mine', { actorUid: 'p1' })], own))).not.toContain('답장하기')
    // Family never sees the patient's reply button.
    expect(html(ctx([r('c', { kind: 'comment', text: '안녕' })]))).not.toContain('답장하기')
  })

  it('is read-only for the patient looking at their own feed', () => {
    const out = html(ctx([r('h'), r('c', { kind: 'comment', text: '엄마 날씨 좋네요' })], { canReact: false, me: { uid: 'p1', name: '어머니' } }))
    expect(out).toContain('엄마 날씨 좋네요')
    expect(out).not.toContain('<input')
    expect(html(ctx([], { canReact: false }))).not.toContain('class="rx"')
  })
})
