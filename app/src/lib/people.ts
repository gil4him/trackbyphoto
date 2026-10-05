// The people a family member looks after, as every list shows them (the
// switcher at the top, 설정 → 함께 보는 가족, the name check in 부모님
// 등록하기). One rule for all of them, so the lists can't disagree: a person
// is listed once their settings are known to exist. A link to an account
// that is gone, or whose settings the server says aren't there, is not a
// person anyone can open, so it is not listed.

/** A person's name; null when the server says there is no such account
 *  (or won't let us see it); undefined while we don't know yet. */
export type NameState = string | null | undefined

export interface Person<M> {
  membership: M
  patientUid: string
  name: string
}

export function listedPeople<M extends { patientUid: string }>(memberships: M[], names: Record<string, NameState>): Person<M>[] {
  return memberships
    .map((m) => ({ membership: m, patientUid: m.patientUid, name: names[m.patientUid] }))
    .filter((p): p is Person<M> => typeof p.name === 'string')
}

/** Names compare without regard to spacing or letter case (the worker's rule too). */
export function sameName(a: string, b: string): boolean {
  const tidy = (s: string) => s.normalize('NFC').replace(/\s+/g, '').toLowerCase()
  return tidy(a) === tidy(b)
}

/** The existing name `name` would clash with, if any. */
export function nameTaken(name: string, existing: string[]): string | null {
  if (!name.trim()) return null
  return existing.find((e) => sameName(e, name)) ?? null
}
