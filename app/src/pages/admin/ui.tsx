// Small pieces the admin pages share.

import type { ReactNode } from 'react'
import { KIND_KO, personFlags, type AdminPerson } from '../../lib/admin'

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

export function Empty({ children }: { children: ReactNode }) {
  return <div className="admin-empty muted">{children}</div>
}
