// Clock and calendar in a named time zone (the parent's, e.g. 'Asia/Seoul').
// The worker's own clock is no guide: the Mac mini runs on US Pacific time.

export function validTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Minutes the zone is ahead of UTC at that instant (DST included). */
export function tzOffsetMin(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
  return Math.round((asUtc - at.getTime()) / 60_000)
}

export interface LocalClock {
  year: number
  /** 1-12 */
  month: number
  day: number
  hour: number
  /** 0 = Sunday */
  weekday: number
  /** YYYYMMDD */
  dayKey: string
}

export function localClock(tz: string, at: Date): LocalClock {
  const local = new Date(at.getTime() + tzOffsetMin(tz, at) * 60_000)
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    weekday: local.getUTCDay(),
    dayKey: local.toISOString().slice(0, 10).replace(/-/g, ''),
  }
}

/** The instant a calendar day starts in the zone. `day` may run past the
 *  month's ends (0, -6, 32): it rolls over like Date.UTC. */
export function localDayStart(tz: string, year: number, month: number, day: number): Date {
  const wall = Date.UTC(year, month - 1, day)
  const first = new Date(wall - tzOffsetMin(tz, new Date(wall)) * 60_000)
  // The offset at the guess can differ from the offset at the answer on a
  // day the clocks change; one more pass settles it.
  return new Date(wall - tzOffsetMin(tz, first) * 60_000)
}
