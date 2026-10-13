import type { TabKey } from '../components/Tabs'

const TABS: TabKey[] = ['home', 'today', 'ask', 'alerts', 'settings']

/** The tab a link asked for (`/?tab=settings`), else home. The query is
 *  dropped from the address so a reload or a share doesn't carry it. */
export function tabFromUrl(loc: { search: string; pathname: string } | undefined = typeof window === 'undefined' ? undefined : window.location): TabKey {
  if (!loc) return 'home'
  const want = new URLSearchParams(loc.search).get('tab')
  if (!want || !(TABS as string[]).includes(want)) return 'home'
  if (typeof window !== 'undefined' && loc === window.location) {
    const rest = new URLSearchParams(loc.search)
    rest.delete('tab')
    const q = rest.toString()
    window.history.replaceState(null, '', `${loc.pathname}${q ? `?${q}` : ''}${window.location.hash}`)
  }
  return want as TabKey
}
