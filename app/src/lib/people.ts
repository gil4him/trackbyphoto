// The people a family member looks after, as every list shows them (the
// switcher at the top, 설정 → 함께 보는 가족, the name check in 부모님
// 등록하기). One rule for all of them, so the lists can't disagree: a person
// is listed once their settings are known to exist. A link to an account
// that is gone, or whose settings the server says aren't there, is not a
// person anyone can open, so it is not listed.

import { lang, tr } from './lang'

/** A person's name; null when the server says there is no such account
 *  (or won't let us see it); undefined while we don't know yet. */
export type NameState = string | null | undefined

/** Who a parent's photos go to when no family member has a name yet. */
export const FAMILY = tr('가족', 'your family')

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

/**
 * Who the parent's photos go to, for "…에게 보냈어요": the first active family
 * member with a name. caregiverName is stamped by the worker and can be
 * missing on older rows, so there is always a fallback.
 */
export function sentToName(caregivers: { status: string; caregiverName?: string }[]): string {
  const named = caregivers.find((c) => c.status === 'active' && c.caregiverName?.trim())
  return named?.caregiverName?.trim() || FAMILY
}

/** The simple edition's consent button once a phone is linked: says who
 *  will see the photos (PairDevice). */
export function consentButtonLabel(caregivers: { status: string; caregiverName?: string }[]): string {
  const name = sentToName(caregivers)
  return name === FAMILY ? tr('네, 보여줄게요', 'Yes, show them') : tr(`네, ${name}에게 보여줄게요`, `Yes, show ${name}`)
}

/**
 * Whose records the app opens on: the stored choice while it is still
 * reachable (yourself, or a parent whose account still exists); with
 * nothing stored, the first parent whose name is known when `preferParent`
 * (the simple edition: the child opens the app to see the parent's day),
 * else yourself.
 */
export function pickActivePatient({ stored, selfUid, patientUids, names, preferParent = false }: {
  stored: string | null
  selfUid: string
  patientUids: string[]
  names: Record<string, NameState>
  preferParent?: boolean
}): string {
  const reachable = patientUids.filter((uid) => names[uid] !== null)
  if (stored && (stored === selfUid || reachable.includes(stored))) return stored
  if (preferParent) {
    const listed = patientUids.find((uid) => typeof names[uid] === 'string')
    if (listed) return listed
  }
  return selfUid
}

// ── How a parent is addressed ──────────────────────────────────────────────
// (docs/DAYLIE_V3_UI_FIX.md A10, both editions)

/** Kin words are names in their own right: never 엄마님, always 엄마. */
const KIN = ['엄마', '아빠', '어머니', '아버지', '할머니', '할아버지']

/** A parent's name as the app addresses them: `엄마` (whether the stored
 *  name is 엄마 or 엄마님) or `영희님`; a name that already ends in 님 is
 *  left alone. */
export function honorific(name: string): string {
  const n = name.trim()
  if (!n) return ''
  const bare = n.replace(/\s*님$/, '')
  // English screens: the name as given, no honorific suffix.
  if (lang === 'en') return bare
  if (KIN.includes(bare)) return bare
  return n.endsWith('님') ? n : `${n}님`
}

/** Whether a Hangul syllable ends in a consonant (받침): 님 does, 마 doesn't. */
function hasBatchim(s: string): boolean {
  const c = s.codePointAt(s.length - 1) ?? 0
  if (c < 0xac00 || c > 0xd7a3) return false
  return (c - 0xac00) % 28 !== 0
}

const PARTICLES = { 가: '이', 는: '은', 를: '을', 와: '과' } as const

/** `honorific` with the particle that follows it: 엄마가 · 영희님이,
 *  엄마는 · 영희님은, 엄마를 · 영희님을, 엄마와 · 영희님과. */
export function honorificWith(name: string, particle: keyof typeof PARTICLES): string {
  const who = honorific(name)
  if (!who) return ''
  return who + (hasBatchim(who) ? PARTICLES[particle] : particle)
}

/**
 * A line the worker wrote with `{name}님` at the front (`엄마님이 새 사진을
 * 올렸어요`), re-addressed the way the app does: `엄마가 새 사진을 올렸어요`.
 * Lines that start with anything else are returned as they are.
 */
export function addressed(line: string, name: string): string {
  const n = name.trim().replace(/\s*님$/, '')
  if (!n) return line
  const re = new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}님(이|가|은|는|을|를|과|와|의|께)?`)
  return line.replace(re, (_, p?: string) => {
    if (!p) return honorific(name)
    if (p === '의' || p === '께') return honorific(name) + p
    const base = ({ 이: '가', 가: '가', 은: '는', 는: '는', 을: '를', 를: '를', 과: '와', 와: '와' } as const)[p as '이']
    return honorificWith(name, base)
  })
}
