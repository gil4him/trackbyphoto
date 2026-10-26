import type { ReactNode } from 'react'

/** One day's rows in one white card, divided by thin lines (A14.1). */
export function DayCard({ children, label }: { children: ReactNode; label?: string }) {
  return <div className="day-card" role="list" aria-label={label}>{children}</div>
}
