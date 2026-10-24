/**
 * 운영실 시스템 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D7): a short memory of how
 * the worker has been doing, kept in this process only — no writes. The last
 * 60 heartbeats and the last 500 memo times (a memo's createdAt to ready).
 * A restart starts it empty; the dashboard says so.
 */

export interface Beat { at: number; modelUp: boolean; waiting: number }
export interface MemoTime { at: number; ms: number }

const MAX_BEATS = 60
const MAX_MEMOS = 500
const beats: Beat[] = []
const memoTimes: MemoTime[] = []
export const startedAt = Date.now()

export function recordBeat(b: Beat): void {
  beats.push(b)
  if (beats.length > MAX_BEATS) beats.splice(0, beats.length - MAX_BEATS)
}

/** Called once a memo is first ready. Never throws: the memo comes first. */
export function recordMemoTime(createdAtMs: number | null | undefined, readyAt = Date.now()): void {
  if (typeof createdAtMs !== 'number' || !Number.isFinite(createdAtMs) || readyAt < createdAtMs) return
  memoTimes.push({ at: readyAt, ms: readyAt - createdAtMs })
  if (memoTimes.length > MAX_MEMOS) memoTimes.splice(0, memoTimes.length - MAX_MEMOS)
}

/** Tests start clean. */
export function resetSystemHistory(): void { beats.length = 0; memoTimes.length = 0 }

export function history(): { beats: Beat[]; memoTimes: MemoTime[]; startedAt: number } {
  return { beats: [...beats], memoTimes: [...memoTimes], startedAt }
}

/** The p-th percentile (0–100) by nearest rank; null for no values. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}

/** Memo times, overall and over the last 15 minutes (for 할 일's "메모 느림";
 *  needs 3 memos there, so one slow photo doesn't raise it). */
export function memoStats(times: MemoTime[], now: number): { p50: number | null; p90: number | null; count: number; p50Last15: number | null } {
  const recent = times.filter((t) => t.at >= now - 15 * 60_000).map((t) => t.ms)
  return {
    p50: percentile(times.map((t) => t.ms), 50),
    p90: percentile(times.map((t) => t.ms), 90),
    count: times.length,
    p50Last15: recent.length >= 3 ? percentile(recent, 50) : null,
  }
}

export type BeatCell = 'ok' | 'slow' | 'miss' | 'none'

/**
 * The last 60 minutes, oldest first, one cell a minute: ok (a beat, model
 * answering, queue short), slow (model not answering or 5+ memos waiting),
 * miss (no beat that minute), none (before this worker started).
 */
export function beatCells(list: Beat[], now: number, started: number): BeatCell[] {
  const cells: BeatCell[] = []
  for (let i = 59; i >= 0; i--) {
    const from = now - (i + 1) * 60_000
    const to = now - i * 60_000
    if (to <= started) { cells.push('none'); continue }
    const inMinute = list.filter((b) => b.at > from && b.at <= to)
    if (!inMinute.length) { cells.push(from < started ? 'none' : 'miss'); continue }
    cells.push(inMinute.some((b) => !b.modelUp || b.waiting >= 5) ? 'slow' : 'ok')
  }
  return cells
}
