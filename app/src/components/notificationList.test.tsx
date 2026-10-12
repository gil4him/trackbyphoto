// The notification rows, rendered without a browser: family events vs
// bookkeeping, and the simple edition's folded 연결 기록 › row.
import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NotificationList } from './NotificationList'
import { isFamilyEvent } from '../lib/noticeKinds'
import type { AppNotification } from '../types'

const n = (id: string, type: string, read = false) => ({
  id, recipientUid: 'me', patientUid: 'mom', actorUid: 'mom', type, message: `${id} 메시지`, read,
  createdAt: { toDate: () => new Date(2026, 9, 4, 15, 30) },
}) as unknown as AppNotification
const items = [n('a', 'photo.new'), n('b', 'reaction.comment', true), n('c', 'daily.photos', true), n('d', 'checkin.no_photo', true), n('e', 'device.pair'), n('f', 'settings.update', true)]
const render = (grouped: boolean) => renderToString(<NotificationList items={items} onOpen={() => {}} grouped={grouped} />).replace(/<!-- -->/g, '')

describe('isFamilyEvent', () => {
  it("the parent's day is a family event; phones and settings are bookkeeping", () => {
    for (const t of ['photo.new', 'reaction.heart', 'familyPhoto.reply', 'daily.photos', 'checkin.no_photo', 'digest.ready']) expect(isFamilyEvent(t)).toBe(true)
    for (const t of ['device.pair', 'caregiver.accept', 'settings.update', 'recipient.add', 'membership.role', 'pairing.create']) expect(isFamilyEvent(t)).toBe(false)
  })
})

describe('NotificationList', () => {
  it('rows: a tinted icon for family events, a dim one for bookkeeping, bold + dot while unread', () => {
    const out = render(false)
    expect(out.split('class="ntf-row').length - 1).toBe(6)
    expect(out).toContain('class="ntf-icon family"')
    expect(out).toContain('class="ntf-icon system"')
    expect(out).toContain('class="ntf-row unread"')
    expect(out.split('aria-label="읽지 않음"').length - 1).toBe(2)
    expect(out).toContain('10월 4일 오후 3:30')
    expect(out).not.toContain('연결 기록')
  })

  it('grouped (simple edition): family events, then one 연결 기록 › row for the rest, with a dot when any is unread', () => {
    const out = render(true)
    expect(out).toContain('a 메시지')
    expect(out).toContain('d 메시지')
    expect(out).not.toContain('e 메시지')
    expect(out).not.toContain('f 메시지')
    expect(out).toContain('연결 기록 ›')
    expect(out.indexOf('d 메시지')).toBeLessThan(out.indexOf('연결 기록'))
    expect(out).toContain('ntf-group-row unread')
  })

  it('nothing yet: one line', () => {
    expect(renderToString(<NotificationList items={[]} onOpen={() => {}} grouped />)).toContain('아직 알림이 없어요')
  })
})
