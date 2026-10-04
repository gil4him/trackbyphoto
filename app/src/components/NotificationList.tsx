import { fmtTime, relativeDateLabel } from '../util'
import type { AppNotification } from '../types'

const ICONS: Array<[prefix: string, icon: string]> = [
  ['photo.', '📷'],
  ['reaction.voice', '🎙️'],
  ['reaction.comment', '💬'],
  ['reaction.', '❤️'],
  ['device.', '📱'],
  ['caregiver.', '👪'],
  ['recipient.', '👪'],
  ['settings.', '⚙️'],
]
const iconFor = (type: string) => ICONS.find(([p]) => type.startsWith(p))?.[1] ?? '🔔'

/** Rows of the notification centre: icon, one line, when, and a dot while unread. */
export function NotificationList({ items, onOpen }: { items: AppNotification[]; onOpen: (n: AppNotification) => void }) {
  if (items.length === 0) return <div className="empty"><div>아직 알림이 없어요.</div></div>
  return (
    <ul className="ntf-list">
      {items.map((n) => {
        const when = n.createdAt?.toDate?.()
        return (
          <li key={n.id}>
            <button type="button" className={`ntf-row ${n.read ? '' : 'unread'}`} onClick={() => onOpen(n)}>
              <span className="ntf-icon" aria-hidden="true">{iconFor(n.type)}</span>
              <span className="ntf-body">
                <span className="ntf-msg">{n.message}</span>
                {when && <span className="ntf-when">{relativeDateLabel(when)} {fmtTime(when)}</span>}
              </span>
              {!n.read && <span className="ntf-dot" aria-label="읽지 않음" />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
