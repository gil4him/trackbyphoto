import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { BottomSheet } from './BottomSheet'
import { groupNotices, noticeLine, swipedAway, type NoticeGroup } from '../lib/noticeCard'
import { tr } from '../lib/lang'
import type { AppNotification } from '../types'

/**
 * One floating card instead of a pile of banners (owner decision,
 * 2026-10-30). It stays under the account bar while the page scrolls and
 * stays until dismissed. Several notices stack behind it with a count: a tap
 * opens them in a sheet, a tap on one notice goes to the page it is about.
 * ✕ or a sideways swipe clears the top one.
 */
export function NoticeCard({ notifications, onDismiss, onOpen, parentName }: {
  notifications: AppNotification[]
  onDismiss?: (id: string) => void
  onOpen?: (n: AppNotification) => void
  parentName?: string
}) {
  const groups = useMemo(() => groupNotices(notifications), [notifications])
  const [sheet, setSheet] = useState(false)
  const [dx, setDx] = useState(0)
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)
  const swiped = useRef(false)
  const wrap = useRef<HTMLDivElement>(null)

  // Right under the account bar, whatever its height (큰 글자, a notch).
  useLayoutEffect(() => {
    const bar = document.querySelector('.acct-bar')
    if (bar && wrap.current) wrap.current.style.top = `${Math.round(bar.getBoundingClientRect().height) + 8}px`
  })

  if (groups.length === 0) return null
  const top = groups[0]
  const several = groups.length > 1
  const clear = (g: NoticeGroup) => g.ids.forEach((id) => onDismiss?.(id))
  const go = (g: NoticeGroup) => { setSheet(false); clear(g); onOpen?.(g.notice) }
  const tap = () => {
    if (swiped.current) { swiped.current = false; return }
    if (several) setSheet(true)
    else go(top)
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    swiped.current = false
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const x = e.clientX - d.x
    if (!d.moved && Math.abs(x) > 10 && Math.abs(x) > Math.abs(e.clientY - d.y)) {
      d.moved = true
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    if (d.moved) setDx(x)
  }
  const onPointerEnd = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (d.moved) {
      swiped.current = true // the click that follows a drag is not a tap
      if (swipedAway(e.clientX - d.x)) clear(top)
    }
    setDx(0)
  }

  return (
    <div ref={wrap} className={`notice-float${several ? ' stacked' : ''}`} role="status" aria-label={tr('가족 활동 알림', 'Family activity alerts')}>
      <div
        className="notice-card"
        style={dx ? { transform: `translateX(${dx}px)`, opacity: Math.max(0.3, 1 - Math.abs(dx) / 240), transition: 'none' } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <button type="button" className="notice-card-open" onClick={tap} aria-haspopup={several ? 'dialog' : undefined}>
          <span className="notice-card-msg">{noticeLine(top, parentName)}</span>
          {several && <span className="notice-card-count">{groups.length}</span>}
        </button>
        {onDismiss && (
          <button type="button" className="notice-x" aria-label={tr('알림 지우기', 'Dismiss alert')} onPointerDown={(e) => e.stopPropagation()} onClick={() => clear(top)}>✕</button>
        )}
      </div>
      {sheet && several && (
        <BottomSheet onClose={() => setSheet(false)}>
          {groups.map((g) => (
            <button key={g.key} type="button" className="sheet-item notice-sheet-row" onClick={() => go(g)}>{noticeLine(g, parentName)}</button>
          ))}
          {onDismiss && (
            <button type="button" className="sheet-cancel" onClick={() => { setSheet(false); groups.forEach(clear) }}>{tr('모두 지우기', 'Clear all')}</button>
          )}
        </BottomSheet>
      )}
    </div>
  )
}
