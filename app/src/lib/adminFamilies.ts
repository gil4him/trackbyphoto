// 운영실 가족 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D4): one row per family —
// a parent and the people who look after them — from the worker's people list
// (adminListPeople) and the plans table. Pure, so it is tested on its own.

import type { Plans } from '../types'
import { matchesQuery, type AdminPerson, type FamilyFilter } from './admin'

export const FILTER_KO: Record<FamilyFilter, string> = {
  all: '전체', quiet: '3일 사진 없음', unpaired: '휴대폰 미연결', limit: '가족 한도', blocked: '차단',
}
export const FILTERS: FamilyFilter[] = ['all', 'quiet', 'unpaired', 'limit', 'blocked']

const PLATFORM_KO: Record<string, string> = { ios: 'iPhone', android: 'Android', web: '웹' }

export type Tone = 'good' | 'acc' | 'bad'
export interface FamilyRow {
  uid: string
  /** "지민 가족", after the 대표 (or the first family member). */
  family: string
  parent: string
  /** Family members' names and emails, for the search. */
  members: { name: string; email: string | null }[]
  familyCount: number
  guardians: number
  limit: number | null
  tier: AdminPerson['plan']['tier']
  explicitPlan: boolean
  phone: string
  photos: number
  lastPhotoAt: string | null
  createdAt: string | null
  /** Which chips the row falls under ('all' always). */
  flags: Set<FamilyFilter>
  status: { label: string; tone: Tone }
}

const QUIET_MS = 72 * 3600_000

export function familyRows(people: AdminPerson[], plans: Plans | null, now = Date.now()): FamilyRow[] {
  const byUid = new Map(people.map((p) => [p.uid, p]))
  return people.filter((p) => p.kind === 'parent').map((p) => {
    const members = p.linkUids.map((u) => byUid.get(u)).filter((m): m is AdminPerson => !!m).map((m) => ({ name: m.name, email: m.email }))
    const limit = typeof plans?.[p.plan.tier]?.familyMembers === 'number' ? plans[p.plan.tier]!.familyMembers : null
    const last = p.memos.lastAt ? Date.parse(p.memos.lastAt) : null
    const flags = new Set<FamilyFilter>(['all'])
    if (last !== null && now - last > QUIET_MS) flags.add('quiet')
    if (p.devices.active === 0) flags.add('unpaired')
    if (limit !== null && p.links.active >= limit) flags.add('limit')
    if (p.disabled) flags.add('blocked')
    const status: FamilyRow['status'] = flags.has('blocked') ? { label: '차단', tone: 'bad' }
      : flags.has('quiet') ? { label: '3일 사진 없음', tone: 'bad' }
        : flags.has('unpaired') ? { label: '휴대폰 미연결', tone: 'acc' }
          : flags.has('limit') ? { label: '가족 한도', tone: 'acc' }
            : p.links.guardians === 0 ? { label: '대표 가족 없음', tone: 'acc' }
              : { label: '정상', tone: 'good' }
    const phones = p.devices.platforms.map((x) => PLATFORM_KO[x] ?? x)
    return {
      uid: p.uid,
      family: members.length ? `${members[0].name} 가족` : '가족 없음',
      parent: p.name,
      members,
      familyCount: p.links.active,
      guardians: p.links.guardians,
      limit,
      tier: p.plan.tier,
      explicitPlan: p.plan.explicit,
      phone: phones.length ? [...new Set(phones)].join(' · ') : '—',
      photos: p.memos.count,
      lastPhotoAt: p.memos.lastAt,
      createdAt: p.createdAt,
      flags,
      status,
    }
  })
}

/** The chip, then the search: the parent's name or uid, or a family member's name or email. */
export function filterRows(rows: FamilyRow[], people: AdminPerson[], filter: FamilyFilter, query: string): FamilyRow[] {
  const q = query.trim().toLowerCase()
  const byUid = new Map(people.map((p) => [p.uid, p]))
  return rows.filter((r) => r.flags.has(filter) && (!q
    || matchesQuery(byUid.get(r.uid)!, q)
    || r.members.some((m) => m.name.toLowerCase().includes(q) || (m.email ?? '').toLowerCase().includes(q))))
}

export type FamilySort = 'recent' | 'created' | 'name' | 'status'
export const SORT_KO: Record<FamilySort, string> = { status: '상태', recent: '최근 사진', created: '등록일', name: '이름' }
const TONE_RANK: Record<Tone, number> = { bad: 0, acc: 1, good: 2 }

export function sortRows(rows: FamilyRow[], by: FamilySort): FamilyRow[] {
  const t = (iso: string | null) => (iso ? Date.parse(iso) : 0)
  const arr = [...rows]
  if (by === 'name') return arr.sort((a, b) => a.parent.localeCompare(b.parent, 'ko'))
  if (by === 'created') return arr.sort((a, b) => t(b.createdAt) - t(a.createdAt))
  if (by === 'recent') return arr.sort((a, b) => t(b.lastPhotoAt) - t(a.lastPhotoAt))
  return arr.sort((a, b) => TONE_RANK[a.status.tone] - TONE_RANK[b.status.tone] || t(b.lastPhotoAt) - t(a.lastPhotoAt))
}

/** Where an inbox item's 목록 열기 lands: its rule's chip. */
export function filterForRule(rule: string): FamilyFilter {
  return rule === 'quietParent' ? 'quiet' : rule === 'unpaired' ? 'unpaired' : rule === 'familyLimit' ? 'limit' : rule === 'disabledAccount' ? 'blocked' : 'all'
}
