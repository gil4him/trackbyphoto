// The bar at the top of the page that lets a user switch between:
//   - their own data (self-managed elder path)
//   - any patient they're an active caregiver on
//
// Rendered only when there's actually a choice to make (caregiver on ≥1 other
// patient). For pure self-managed accounts it returns null so the layout
// matches the original single-user UI.
//
// Who is listed, and under what name, is decided in one place for every list
// in the app (lib/people.ts, hooks/usePatientNames.ts): a person appears once
// their settings are known to exist, under users/{patientUid}.patientName.

import { useState } from 'react'
import type { LiveMembership } from '../hooks/useMemberships'
import { honorific } from '../lib/people'
import type { Person } from '../lib/people'
import { BottomSheet } from './BottomSheet'
import { tr } from '../lib/lang'

interface Props {
  /** Signed-in user's uid — the "self" entry. */
  selfUid: string
  /** What the user wants to call themselves on the self row. */
  selfLabel: string
  /** The people this user looks after, already named (see lib/people.ts). */
  people: Person<LiveMembership>[]
  /** Currently selected patientUid. */
  activePatientUid: string
  onChange: (patientUid: string) => void
}

/** The round initial: coral for oneself, blue for a parent. */
function Avatar({ name, parent }: { name: string; parent: boolean }) {
  return <span className={`acct-avatar${parent ? ' parent' : ''}`} aria-hidden="true">{name.trim().charAt(0) || '?'}</span>
}

export function PatientSwitcher({ selfUid, selfLabel, people, activePatientUid, onChange }: Props) {
  const [open, setOpen] = useState(false)

  // No options beyond self → don't render.
  if (people.length === 0) return null

  const isSelf = activePatientUid === selfUid
  const activeLabel = isSelf
    ? selfLabel
    : people.find((p) => p.patientUid === activePatientUid)?.name || tr('사용자', 'User')
  const pick = (uid: string) => { onChange(uid); setOpen(false) }

  const row = (uid: string, name: string, sub: string, parent: boolean) => {
    const on = activePatientUid === uid
    return (
      <button key={uid} type="button" className={`sheet-item ps-row${on ? ' on' : ''}`} onClick={() => pick(uid)} aria-current={on || undefined}>
        <Avatar name={name} parent={parent} />
        <span className="ps-row-text">
          <span className="ps-row-name">{name}</span>
          <span className="ps-row-sub">{sub}</span>
        </span>
        {on && <span className="ps-check" aria-hidden="true">✓</span>}
      </button>
    )
  }

  // Frosted bar up behind the status bar, in both modes — the tint and the
  // avatar say whose records these are.
  return (
    <div className={`acct-bar${isSelf ? '' : ' caregiver'}`}>
      <button type="button" className="acct-chip" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={tr(`보기 전환: ${activeLabel}`, `Switch view: ${activeLabel}`)}>
        <Avatar name={activeLabel} parent={!isSelf} />
        <span className="acct-name">{isSelf ? activeLabel : honorific(activeLabel)}</span>
        <span className="ps-caret" aria-hidden="true">⌄</span>
      </button>
      {!isSelf && (
        <button type="button" className="acct-return" onClick={() => pick(selfUid)}>{tr('내 계정으로', 'My account')}</button>
      )}
      {open && (
        <BottomSheet title={tr('보기 전환', 'Switch view')} onClose={() => setOpen(false)}>
          {row(selfUid, selfLabel, tr('내 계정', 'My account'), false)}
          {people.map((p) => row(p.patientUid, p.name, tr(`가족 · ${p.membership.role === 'viewer' ? '뷰어' : '관리자'}`, `Family · ${p.membership.role === 'viewer' ? 'Viewer' : 'Manager'}`), true))}
        </BottomSheet>
      )}
    </div>
  )
}
