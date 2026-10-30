// The notification rows, rendered without a browser: family events vs
// bookkeeping, and the simple edition's folded 연결 기록 › row.
import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { NotificationList } from './NotificationList'
import { isAlertRow, isFamilyEvent } from '../lib/noticeKinds'
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

  it('a parent absent for a day is a family event; unaccepted link and invite reminders stand on their own', () => {
    expect(isFamilyEvent('absence.family')).toBe(true)
    for (const t of ['pairing.pending', 'invite.pending']) {
      expect(isFamilyEvent(t)).toBe(false)
      expect(isAlertRow(t)).toBe(true)
    }
    expect(isAlertRow('pairing.create')).toBe(false)
  })

  it('free-trial notices about a plan stand on their own with 🎁, not folded into 연결 기록', () => {
    for (const t of ['plan.trialStarted', 'plan.trialEnding', 'plan.trialEnded']) expect(isAlertRow(t)).toBe(true)
    expect(isAlertRow('device.pair')).toBe(false)
    const trial = [n('t1', 'plan.trialStarted'), n('t2', 'plan.trialEnding', true), n('t3', 'plan.trialEnded', true), n('e', 'device.pair')]
    const out = renderToString(<NotificationList items={trial} onOpen={() => {}} grouped />).replace(/<!-- -->/g, '')
    const group = out.indexOf('연결 기록')
    for (const id of ['t1', 't2', 't3']) {
      expect(out).toContain(`${id} 메시지`)
      expect(out.indexOf(`${id} 메시지`)).toBeLessThan(group)
    }
    expect(out.split('🎁').length - 1).toBe(3)
    expect(out).not.toContain('e 메시지')
  })

  it('nothing yet: one line', () => {
    expect(renderToString(<NotificationList items={[]} onOpen={() => {}} grouped />)).toContain('아직 알림이 없어요')
  })
})
