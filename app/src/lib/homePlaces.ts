// 설정 → 집 위치 helpers (components/HomePicker.tsx).
import type { Memo, UserSettings } from '../types'

type Home = NonNullable<UserSettings['home']>

/** How long typing must pause before the places are looked up. */
export const AUTO_SEARCH_MS = 700

/** Worth looking up while typing: two Korean letters ("서초"), or three
 *  otherwise ("350", "Ana"); shorter matches half the map. */
export function autoSearchable(query: string): boolean {
  const q = query.trim()
  return /[가-힣]/.test(q) ? q.length >= 2 : q.length >= 3
}

/** Recent photo places, newest first, one chip per place name. */
export function recentPlacesOf(memos: Memo[], max = 4): Home[] {
  const seen = new Set<string>()
  const out: Home[] = []
  for (const m of memos) {
    if (m.lat == null || m.lng == null || !m.place || seen.has(m.place)) continue
    seen.add(m.place)
    out.push({ lat: m.lat, lng: m.lng, label: m.place })
    if (out.length === max) break
  }
  return out
}
