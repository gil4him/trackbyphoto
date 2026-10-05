// The plan sheet, the locked voice card and 목소리 앨범, rendered without a browser.
// Plan contents are made up for the tests.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../firebase', () => ({ db: {}, auth: {}, storage: {} }))
vi.mock('../lib/reactions', () => ({
  COMMENT_MAX: 60,
  familyActor: vi.fn(), removeReaction: vi.fn(), sendComment: vi.fn(), sendFamilyHeart: vi.fn(),
}))

import { PlanCards, PlanSheetView } from './PlanSheet'
import { Reactions, type ReactionsContext } from './Reactions'
import { ToastProvider } from './Toast'
import { VoiceAlbumView } from '../pages/VoiceAlbum'
import { PLANS } from '../lib/plan.fixture'
import type { Plans, Reaction } from '../types'

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean)
const noop = () => {}
const NOW = Date.UTC(2026, 9, 5)
const DAY = 24 * 3600 * 1000

function sheet(over: Partial<Parameters<typeof PlanSheetView>[0]> = {}) {
  return renderToString(
    <PlanSheetView
      plans={PLANS} patientName="어머니" current="free" hasPlanSinceMs={undefined} reason={{ kind: 'settings' }} canChange
      memory={null} nowMs={NOW} busy={null} confirm={null}
      onChoose={noop} onConfirm={noop} onCancelConfirm={noop} onClose={noop}
      {...over}
    />,
  )
}

describe('plan cards', () => {
  const cards = (over: Partial<Parameters<typeof PlanCards>[0]> = {}) =>
    renderToString(<PlanCards plans={PLANS} current="free" patientName="어머니" canChange onChoose={noop} {...over} />)

  it('show three cards when the table offers three plans', () => {
    const { basic: _gone, ...three } = PLANS
    void _gone
    const out = text(cards({ plans: three as Plans }))
    expect(out.filter((l) => ['Free', 'Basic', 'Plus', 'Family'].includes(l))).toEqual(['Free', 'Plus', 'Family'])
    expect(out.join(' ')).not.toContain('Basic')
  })

  it('show four cards from the plans table and never a photo count', () => {
    const out = cards()
    expect(text(out)).toMatchInlineSnapshot(`
      [
        "Free",
        "지금 요금제",
        "앱 알림 + 이메일 요약 · 가족 1명 · 9일 보관",
        "Basic",
        "매일 카카오톡 요약 · 어머니 음성 답장 듣기 · 가족 2명 · 45일 보관",
        "Basic 시작하기",
        "Plus",
        "매일 카카오톡 요약 · 어머니 음성 답장 듣기 · 주간 하이라이트 · “오늘 사진 없음” 안심 알림 · 가족 2명 · 2년 보관",
        "Plus 시작하기",
        "Family",
        "매일 카카오톡 요약 · 어머니 음성 답장 듣기 · 주간 하이라이트 · “오늘 사진 없음” 안심 알림 · 월간 AI 앨범 · 목소리 앨범 · 부모님 2분 · 가족 6명 · 평생 보관",
        "Family 시작하기",
      ]
    `)
    // The made-up table allows 37 AI memos a day on Free and 411 photos a day for everyone.
    expect(out).not.toMatch(/37|411|\d\s*장/)
  })

  it('show a price only when the plans table has one', () => {
    const priced = { ...PLANS, basic: { ...PLANS.basic, priceLabel: '₩1,234/월' } } as Plans
    const out = text(cards({ plans: priced }))
    expect(out).toContain('₩1,234/월')
    expect(out).toContain('Basic 시작하기 ₩1,234/월')
    expect(cards()).not.toMatch(/₩|원/)
  })

  it('mark the plan in use and the suggested one; going down reads as a change, not a start', () => {
    const out = cards({ current: 'plus', suggested: 'family' })
    expect(out).toContain('plan-card current')
    expect(out).toContain('plan-card suggested')
    expect(text(out)).toEqual(expect.arrayContaining(['추천', 'Free로 바꾸기', 'Basic으로 바꾸기', 'Family 시작하기']))
    expect(text(out)).not.toContain('Plus 시작하기')
  })

  it('give a family member who only looks no buttons', () => {
    expect(cards({ canChange: false })).not.toContain('<button')
  })
})

describe('plan sheet', () => {
  it('is titled as a gift and says nothing is charged during the beta', () => {
    const out = text(sheet())
    expect(out[0]).toBe('부모님께 드리는 선물')
    expect(out).toContain('지금은 베타 기간이라 요금이 청구되지 않아요.')
  })

  it('opens at the family count with the reason and the plan that has room', () => {
    const out = sheet({ reason: { kind: 'family', limit: 1 } })
    expect(text(out)).toContain('가족 1명까지 함께 볼 수 있어요. 더 초대하려면 Basic이 필요해요')
    expect(out).toContain('plan-card suggested')
  })

  it('opens from the locked voice card with how many replies are waiting', () => {
    expect(text(sheet({ reason: { kind: 'voice', count: 3 } }))).toContain('어머니가 남긴 답장 3개가 기다리고 있어요')
  })

  it('shows the memory strip, with a date only when photos will really be deleted', () => {
    const memory = { count: 312, oldestMs: NOW - 3 * DAY }
    expect(text(sheet({ memory, hasPlanSinceMs: NOW - 100 * DAY }))).toContain('보관 중인 사진 312장 · 가장 오래된 사진 6일 뒤 삭제')
    // Nobody put this parent on a plan: everything is kept.
    expect(text(sheet({ memory }))).toContain('보관 중인 사진 312장')
    expect(sheet({ memory })).not.toContain('삭제')
    expect(sheet({ memory: { count: 0, oldestMs: null } })).not.toContain('보관 중인')
  })

  it('tells a family member who only looks who can change it', () => {
    const out = sheet({ canChange: false })
    expect(text(out)).toContain('요금제는 대표 가족이나 관리자가 바꿀 수 있어요.')
    expect(out).not.toContain('plan-go')
  })

  it('asks before a change that would let kept photos go', () => {
    const out = text(sheet({ current: 'plus', hasPlanSinceMs: NOW, confirm: { tier: 'basic', count: 18 } }))
    expect(out.join(' ')).toContain('Basic은 사진을 45일 동안 보관해요. 그보다 오래된 사진 18장은 일주일 뒤부터 지워져요.')
    expect(out).toEqual(expect.arrayContaining(['취소', 'Basic으로 바꾸기']))
    expect(out).not.toContain('Family 시작하기')
  })
})

describe('locked voice card', () => {
  const voice: Reaction = { id: 'v1', memoId: 'm1', patientUid: 'p1', actorUid: 'p1', actorName: '어머니', kind: 'voice', status: 'ready', audioUrl: 'https://example.test/v.webm', transcript: '괜찮아, 오늘 많이 걸었어', createdAtMs: NOW }
  const ctx = (over: Partial<ReactionsContext> = {}): ReactionsContext => ({
    byMemo: new Map([['m1', [voice]]]), me: { uid: 'cg1', name: '민수' }, patientUid: 'p1', patientName: '어머니',
    canReact: true, voiceOn: true, voiceAllowed: false, ...over,
  })
  const html = (c: ReactionsContext) => renderToString(<ToastProvider><Reactions memoId="m1" ctx={c} /></ToastProvider>)

  it('is a door to the plan sheet once the sheet is rolled out, and never shows the words', () => {
    const out = html(ctx({ onVoiceLocked: noop }))
    expect(out).toContain('<button type="button" class="rx-voice locked"')
    expect(out).toContain('어머니 목소리로 답장을 받아보세요 · Basic')
    expect(out).not.toContain('괜찮아')
    expect(out).not.toContain('<audio')
  })

  it('is a plain card until then', () => {
    expect(html(ctx())).toContain('<div class="rx-voice locked"')
  })
})

describe('목소리 앨범', () => {
  const v = (id: string, at: Date, transcript?: string): Reaction => ({
    id, memoId: `m-${id}`, patientUid: 'p1', actorUid: 'p1', actorName: '어머니', kind: 'voice', status: 'ready',
    audioUrl: `https://example.test/${id}.webm`, transcript, createdAtMs: at.getTime(),
  })

  it('lists replies by month with their words', () => {
    const out = renderToString(
      <VoiceAlbumView patientName="어머니" patientUid="p1" memoOf={() => undefined}
        voices={[v('a', new Date(2026, 8, 3, 9), '잘 다녀왔어'), v('b', new Date(2026, 9, 4, 15, 41), '괜찮아, 오늘 많이 걸었어'), v('c', new Date(2026, 9, 1, 8))]} />,
    )
    const lines = text(out)
    expect(lines).toEqual(expect.arrayContaining(['목소리 앨범', '2026년 10월', '2026년 9월', '“괜찮아, 오늘 많이 걸었어”', '“잘 다녀왔어”', '받아쓴 글이 없어요. 눌러서 들어 보세요.']))
    expect(lines.indexOf('2026년 10월')).toBeLessThan(lines.indexOf('2026년 9월'))
    expect((out.match(/<audio/g) ?? []).length).toBe(3)
  })

  it('says so when there are none yet', () => {
    expect(renderToString(<VoiceAlbumView patientName="어머니" patientUid="p1" voices={[]} memoOf={() => undefined} />)).toContain('아직 음성 답장이 없어요.')
  })
})
