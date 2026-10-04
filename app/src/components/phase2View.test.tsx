// Notification rows and the home-screen hint, rendered without a browser.
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))

import { InstallHint } from './InstallHint'
import { NotificationList } from './NotificationList'
import type { AppNotification } from '../types'

const at = (d: Date) => ({ toDate: () => d }) as AppNotification['createdAt']
function n(id: string, type: string, message: string, read = false): AppNotification {
  return { id, recipientUid: 'cg1', patientUid: 'p1', actorUid: 'p1', type, message, read, createdAt: at(new Date(2026, 9, 4, 15, 41)) }
}

describe('NotificationList', () => {
  it('renders a new-photo row and a voice-reply row, each with its own icon', () => {
    const out = renderToString(<NotificationList onOpen={() => {}} items={[
      n('a', 'photo.new', '어머니님이 새 사진을 올렸어요'),
      n('b', 'reaction.voice', '어머니님이 음성 답장을 남기셨어요'),
    ]} />)
    expect(out).toContain('어머니님이 새 사진을 올렸어요')
    expect(out).toContain('📷')
    expect(out).toContain('어머니님이 음성 답장을 남기셨어요')
    expect(out).toContain('🎙️')
  })

  it('marks only unread rows with a dot', () => {
    const out = renderToString(<NotificationList onOpen={() => {}} items={[
      n('a', 'photo.new', '읽지 않은 알림'),
      n('b', 'reaction.heart', '읽은 알림', true),
    ]} />)
    expect(out.match(/ntf-dot/g)?.length).toBe(1)
    expect(out).toContain('ntf-row unread')
  })

  it('says so when there is nothing yet', () => {
    expect(renderToString(<NotificationList onOpen={() => {}} items={[]} />)).toContain('아직 알림이 없어요')
  })
})

describe('InstallHint', () => {
  it('offers the steps on an iPhone and in an in-app browser', () => {
    for (const path of ['ios', 'in-app', 'android'] as const) {
      const out = renderToString(<InstallHint path={path} />)
      expect(out).toContain('홈 화면에 추가하면 알림을 바로 받아요')
      expect(out).toContain('방법 보기')
    }
  })
  it('offers the browser\'s own dialog when there is one', () => {
    expect(renderToString(<InstallHint path="prompt" />)).toContain('추가하기')
  })
  it('shows nothing from a home-screen icon, in the installed app, or on a computer', () => {
    expect(renderToString(<InstallHint path="none" />)).toBe('')
    expect(renderToString(<InstallHint path="desktop" />)).toBe('')
  })
})
