// Pill at the top of the page that lets a user switch between:
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

import { useEffect, useRef, useState } from 'react'
import type { LiveMembership } from '../hooks/useMemberships'
import type { Person } from '../lib/people'

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

export function PatientSwitcher({ selfUid, selfLabel, people, activePatientUid, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Outside-click closes the dropdown.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // No options beyond self → don't render.
  if (people.length === 0) return null

  const isSelf = activePatientUid === selfUid
  const activeLabel = isSelf
    ? selfLabel
    : people.find((p) => p.patientUid === activePatientUid)?.name || '사용자'
  // Switch menu (self + every patient).
  const menu = open && (
    <div className="ps-menu" role="menu">
      <button
        className={`ps-item ${isSelf ? 'on' : ''}`}
        onClick={() => { onChange(selfUid); setOpen(false) }}
        role="menuitem"
      >
        <span className="ps-item-name">{selfLabel}</span>
        <span className="ps-item-sub">내 계정</span>
      </button>
      {people.map((p) => {
        const selected = activePatientUid === p.patientUid
        return (
          <button
            key={p.patientUid}
            className={`ps-item ${selected ? 'on' : ''}`}
            onClick={() => { onChange(p.patientUid); setOpen(false) }}
            role="menuitem"
          >
            <span className="ps-item-name">{p.name}</span>
            <span className="ps-item-sub">가족 · {p.membership.role === 'viewer' ? '뷰어' : '관리자'}</span>
          </button>
        )
      })}
    </div>
  )

  // Full-width top bar in both modes — light/coral for self, blue for caregiver
  // — so placement is consistent and only the styling signals whose account.
  return (
    <div className={`acct-bar${isSelf ? '' : ' caregiver'}`} ref={ref}>
      <button className="acct-chip" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {!isSelf && <span className="acct-eye" aria-hidden="true">👁</span>}
        <span className="acct-name">{isSelf ? activeLabel : `${activeLabel}님`}</span>
        <span className="ps-caret" aria-hidden="true">▾</span>
      </button>
      {isSelf ? (
        <span className="acct-tag">내 계정</span>
      ) : (
        <button className="acct-return" onClick={() => { onChange(selfUid); setOpen(false) }}>
          내 계정으로
        </button>
      )}
      {menu}
    </div>
  )
}
