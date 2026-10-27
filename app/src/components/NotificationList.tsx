import { useState } from 'react'
import { fmtTime, relativeDateLabel } from '../util'
import { isFamilyEvent } from '../lib/noticeKinds'
import { tr } from '../lib/lang'
import type { AppNotification } from '../types'

const ICONS: Array<[prefix: string, icon: string]> = [
  ['photo.', '📷'],
  ['familyPhoto.', '🖼️'],
  ['reaction.voice', '🎙️'],
  ['reaction.comment', '💬'],
  ['reaction.', '❤️'],
  ['voice.', '🔓'],
  ['family.', '👪'],
  ['device.', '📱'],
  ['caregiver.', '👪'],
  ['recipient.', '👪'],
  ['settings.', '⚙️'],
  ['retention.', '🗓️'],
  ['digest.', '🌙'],
  ['checkin.', '🕊️'],
  ['daily.', '🌙'],
]
const iconFor = (type: string) => ICONS.find(([p]) => type.startsWith(p))?.[1] ?? '🔔'

function Row({ n, onOpen }: { n: AppNotification; onOpen: (n: AppNotification) => void }) {
  const when = n.createdAt?.toDate?.()
  return (
    <li>
      <button type="button" className={`ntf-row ${n.read ? '' : 'unread'}`} onClick={() => onOpen(n)}>
        <span className={`ntf-icon ${isFamilyEvent(n.type) ? 'family' : 'system'}`} aria-hidden="true">{iconFor(n.type)}</span>
        <span className="ntf-body">
          <span className="ntf-msg">{n.message}</span>
          {when && <span className="ntf-when">{relativeDateLabel(when)} {fmtTime(when)}</span>}
        </span>
        {!n.read && <span className="ntf-dot" aria-label={tr('읽지 않음', 'Unread')} />}
      </button>
    </li>
  )
}

/**
 * Rows of the notification centre: a 48px icon, one line, when, and a dot
 * while unread. With `grouped` (the simple edition) the bookkeeping rows
 * fold into one muted 연결 기록 › row at the bottom.
 */
export function NotificationList({ items, onOpen, grouped = false }: { items: AppNotification[]; onOpen: (n: AppNotification) => void; grouped?: boolean }) {
  const [systemOpen, setSystemOpen] = useState(false)
  if (items.length === 0) return <div className="empty"><div>{tr('아직 알림이 없어요.', 'No alerts yet.')}</div></div>
  const shown = grouped ? items.filter((n) => isFamilyEvent(n.type)) : items
  const system = grouped ? items.filter((n) => !isFamilyEvent(n.type)) : []
  const systemUnread = system.filter((n) => !n.read).length
  return (
    <ul className="ntf-list">
      {shown.map((n) => <Row key={n.id} n={n} onOpen={onOpen} />)}
      {system.length > 0 && (
        <li className="ntf-group">
          <button type="button" className={`ntf-row ntf-group-row ${systemUnread ? 'unread' : ''}`} onClick={() => setSystemOpen((v) => !v)} aria-expanded={systemOpen}>
            <span className="ntf-icon system" aria-hidden="true">📱</span>
            <span className="ntf-body"><span className="ntf-msg">{tr('연결 기록', 'Account history')} {systemOpen ? '⌃' : '›'}</span></span>
            {systemUnread > 0 && <span className="ntf-dot" aria-label={tr('읽지 않음', 'Unread')} />}
          </button>
          {systemOpen && <ul className="ntf-list ntf-sub">{system.map((n) => <Row key={n.id} n={n} onOpen={onOpen} />)}</ul>}
        </li>
      )}
    </ul>
  )
}
