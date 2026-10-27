import { useId, useState, type ReactNode } from 'react'
import { tr } from '../lib/lang'

/**
 * A settings section's label with its explanation folded behind ⓘ: the page
 * reads as a list of subjects, and the sentence about what a feature does
 * shows only when someone asks. Nothing is hidden that a choice depends on —
 * instructions and errors stay inline next to their controls.
 */
export function SectLab({ children, info }: { children: ReactNode; info?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <>
      <div className="sect-lab sect-lab-row">
        <span>{children}</span>
        {info && (
          <button
            type="button"
            className={`info-btn ${open ? 'on' : ''}`}
            aria-label={open ? tr('설명 닫기', 'Hide the explanation') : tr('설명 보기', 'Show the explanation')}
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((o) => !o)}
          >i</button>
        )}
      </div>
      {info && open && <div className="help sect-info" id={id}>{info}</div>}
    </>
  )
}
