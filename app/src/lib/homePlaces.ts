// 설정 → 집 위치 helpers (components/HomePicker.tsx).
/** How long typing must pause before the places are looked up. */
export const AUTO_SEARCH_MS = 700

/** Worth looking up while typing: two Korean letters ("서초"), or three
 *  otherwise ("350", "Ana"); shorter matches half the map. */
export function autoSearchable(query: string): boolean {
  const q = query.trim()
  return /[가-힣]/.test(q) ? q.length >= 2 : q.length >= 3
}
