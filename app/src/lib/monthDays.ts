import { tr } from './lang'

/**
 * Days with a photo this month, by the phone's clock. It only ever grows
 * within a month: a missed day takes nothing away, and nothing here ever
 * mentions one (owner decision, 2026-10-30).
 */
export function monthDays(memos: Array<{ takenAt?: { toDate?: () => Date }; status?: string }>, now: Date): number {
  const days = new Set<number>()
  for (const m of memos) {
    const at = m.takenAt?.toDate?.()
    if (!at || m.status === 'error') continue
    if (at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth()) days.add(at.getDate())
  }
  return days.size
}

/** From the second day on; one day is nothing to count yet. */
export function monthDaysLine(days: number): string | null {
  return days >= 2 ? tr(`이번 달 ${days}일째 기록 중`, `${days} days of photos this month`) : null
}
