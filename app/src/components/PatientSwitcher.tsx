// Pill at the top of the page that lets a user switch between:
//   - their own data (self-managed elder path)
//   - any patient they're an active caregiver on
//
// Rendered only when there's actually a choice to make (caregiver on ≥1 other
// patient). For pure self-managed accounts it returns null so the layout
// matches the original single-user UI.
//
// The displayed name for each patient comes from users/{patientUid}.patientName
// — same field the Settings screen edits. We subscribe per patient rather
// than fetch-once because the patient's name may change while we're open.

import { useEffect, useRef, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import type { LiveMembership } from '../hooks/useMemberships'

interface Props {
  /** Signed-in user's uid — the "self" entry. */
  selfUid: string
  /** What the user wants to call themselves on the self row. */
  selfLabel: string
  /** Active patient memberships where caregiverUid == selfUid. */
  patients: LiveMembership[]
  /** Currently selected patientUid. */
  activePatientUid: string
  onChange: (patientUid: string) => void
}

export function PatientSwitcher({ selfUid, selfLabel, patients, activePatientUid, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Subscribe to each patient's display name. Keyed map keeps it stable as
  // patients come and go.
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    if (patients.length === 0) return
    const unsubs = patients.map((p) =>
      onSnapshot(doc(db, 'users', p.patientUid), (snap) => {
        const name = (snap.data()?.patientName as string | undefined) || '사용자'
        setNames((prev) => ({ ...prev, [p.patientUid]: name }))
      }, (err) => console.warn('[switcher] name subscription error', err)),
    )
    return () => { unsubs.forEach((u) => u()) }
  }, [patients])

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
  if (patients.length === 0) return null

  const isSelf = activePatientUid === selfUid
  const activeLabel = isSelf
    ? selfLabel
    : names[activePatientUid] || '사용자'
  const activeRoleLabel = isSelf ? '내 계정' : '보호자로 보기'

  return (
    <div className="patient-switcher" ref={ref}>
      <button className="ps-pill" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="ps-name">{activeLabel}</span>
        <span className="ps-sub">{activeRoleLabel}</span>
        <span className="ps-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="ps-menu" role="menu">
          <button
            className={`ps-item ${isSelf ? 'on' : ''}`}
            onClick={() => { onChange(selfUid); setOpen(false) }}
            role="menuitem"
          >
            <span className="ps-item-name">{selfLabel}</span>
            <span className="ps-item-sub">내 계정</span>
          </button>
          {patients.map((p) => {
            const selected = activePatientUid === p.patientUid
            return (
              <button
                key={p.patientUid}
                className={`ps-item ${selected ? 'on' : ''}`}
                onClick={() => { onChange(p.patientUid); setOpen(false) }}
                role="menuitem"
              >
                <span className="ps-item-name">{names[p.patientUid] || '사용자'}</span>
                <span className="ps-item-sub">보호자 · {p.role === 'admin' ? '관리자' : '뷰어'}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
