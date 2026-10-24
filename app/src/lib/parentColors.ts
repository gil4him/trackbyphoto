// A colour per parent, so a family member with more than one parent can
// tell at a glance whose card, or which parent a sent photo went to. The
// order of the parent list decides it, so it stays the same everywhere.
// With one parent there is nothing to tell apart: the usual accent.

export const PARENT_COLORS = ['#F2994A', '#4A90D9', '#3BAA78', '#D9608C', '#8A6AD1', '#C9A227'] as const

export function parentColors(uids: string[]): Record<string, string> {
  if (uids.length <= 1) return Object.fromEntries(uids.map((u) => [u, 'var(--accent)']))
  return Object.fromEntries(uids.map((u, i) => [u, PARENT_COLORS[i % PARENT_COLORS.length]]))
}
