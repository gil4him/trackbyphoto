import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * A panel that slides up from the bottom, over a dimmed page: the person
 * switcher and a photo's ⋯ menu. Tapping outside or Escape closes it.
 * Rendered into <body> — a frosted bar (backdrop-filter) would otherwise
 * become the panel's frame. Only render it while open.
 */
export function BottomSheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" aria-hidden="true" />
        {title && <div className="sheet-title">{title}</div>}
        {children}
      </div>
    </div>,
    document.body,
  )
}
