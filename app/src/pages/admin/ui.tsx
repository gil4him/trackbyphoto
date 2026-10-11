// Small pieces the admin pages share.

import type { ReactNode } from 'react'
import { KIND_KO, fmtAgo, personFlags, type AdminPerson } from '../../lib/admin'

export function Badge({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad' | 'good'; children: ReactNode }) {
  return <span className={`admin-badge ${tone}`}>{children}</span>
}

export function KindBadge({ kind }: { kind: AdminPerson['kind'] }) {
  return <span className={`admin-kind ${kind}`}>{KIND_KO[kind]}</span>
}

export function Flags({ person }: { person: AdminPerson }) {
  const flags = personFlags(person)
  if (!flags.length) return null
  return <>{flags.map((f) => <Badge key={f.key} tone={f.tone}>{f.label}</Badge>)}</>
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="admin-section">
      <div className="admin-section-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Stat({ label, value, sub, onClick }: { label: string; value: ReactNode; sub?: ReactNode; onClick?: () => void }) {
  const inner = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </>
  )
  return onClick
    ? <button type="button" className="stat-card stat-btn" onClick={onClick}>{inner}</button>
    : <div className="stat-card">{inner}</div>
}

/** One person as a compact row — name, who they are, when last seen. */
export function PersonChip({ person, onOpen }: { person: AdminPerson; onOpen: (uid: string) => void }) {
  return (
    <button type="button" className="admin-chip" onClick={() => onOpen(person.uid)}>
      <KindBadge kind={person.kind} />
      <span className="admin-chip-name">{person.name}</span>
      {person.email && <span className="admin-chip-sub">{person.email}</span>}
      <span className="admin-chip-ago">{fmtAgo(person.lastSignInAt ?? person.memos.lastAt)}</span>
    </button>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="admin-empty muted">{children}</div>
}
