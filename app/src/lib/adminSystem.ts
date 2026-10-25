// 운영실 시스템 (D7): small words for the worker's numbers. Pure.

import type { AdminPerson } from './admin'

/** 18200 ms → "18초", 95000 → "1분 35초". */
export function secs(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분${s % 60 ? ` ${s % 60}초` : ''}`
}

/** Failures over the day as a share, one decimal; null with no photos. */
export function failRate(f: { failed: number; total: number }): number | null {
  return f.total ? Math.round((f.failed / f.total) * 1000) / 10 : null
}

/** Minutes since the worker started, when that is within the strip's hour. */
export function restartedMinutesAgo(startedAt: string, now: number): number | null {
  const m = Math.floor((now - Date.parse(startedAt)) / 60_000)
  return m < 60 ? Math.max(0, m) : null
}

const PLATFORM_KO: Record<string, string> = { ios: 'iPhone', android: 'Android', web: '웹 (브라우저)' }

/** Linked phones by platform, most first, with shares. */
export function platformSplit(people: AdminPerson[]): { label: string; count: number; pct: number }[] {
  const counts = new Map<string, number>()
  for (const p of people) if (p.kind === 'parent') for (const x of p.devices.platforms) counts.set(x, (counts.get(x) ?? 0) + 1)
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => ({ label: PLATFORM_KO[k] ?? k, count: n, pct: Math.round((n / total) * 100) }))
}
