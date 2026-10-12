// In-memory failure throttle for code-redemption handlers (pairing codes,
// invite codes). Counts wrong guesses per caller and across all callers in a
// sliding window and refuses further attempts once either limit is hit.
// Resets when the worker restarts, which is fine: the point is to stop a
// script from guessing at volume, not to keep a ledger.

import { WorkerError } from './context.js'

export interface ThrottleLimits {
  /** Failures one caller uid may make inside the window. */
  perCaller: number
  /** Failures everyone together may make inside the window. */
  global: number
  windowMs: number
}

export class FailureThrottle {
  private readonly perCallerTimes = new Map<string, number[]>()
  private globalTimes: number[] = []

  constructor(private readonly limits: ThrottleLimits) {}

  private recent(times: number[], now: number): number[] {
    return times.filter((t) => now - t < this.limits.windowMs)
  }

  /** Throws 'resource-exhausted' when the caller (or everyone) is over the limit. */
  check(callerUid: string): void {
    const now = Date.now()
    this.globalTimes = this.recent(this.globalTimes, now)
    const mine = this.recent(this.perCallerTimes.get(callerUid) ?? [], now)
    this.perCallerTimes.set(callerUid, mine)
    if (mine.length >= this.limits.perCaller || this.globalTimes.length >= this.limits.global) {
      throw new WorkerError('resource-exhausted', 'too many attempts; try again later')
    }
  }

  fail(callerUid: string): void {
    const now = Date.now()
    this.perCallerTimes.set(callerUid, [...this.recent(this.perCallerTimes.get(callerUid) ?? [], now), now])
    this.globalTimes.push(now)
  }

  /** Test hook. */
  reset(): void {
    this.perCallerTimes.clear()
    this.globalTimes = []
  }
}
