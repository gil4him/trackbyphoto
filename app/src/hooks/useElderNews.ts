import { useEffect, useState } from 'react'
import { elderNews, type ElderNews } from '../lib/reactionsModel'
import type { Reaction } from '../types'

/** News the person has opened, kept as it was when they tapped it. */
export type OpenNews = Extract<ElderNews, { state: 'new' | 'seen' }>

/**
 * The one piece of family news for the 가족 소식 card of whoever's records
 * these are. Null while reactions aren't available (not rolled out, or not
 * looking at one's own records).
 */
export function useElderNews(reactions: Reaction[] | null, uid: string | undefined): ElderNews | null {
  // "Today" for the card; refreshed now and then so it turns over at midnight.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10 * 60_000)
    return () => clearInterval(t)
  }, [])
  return reactions && uid ? elderNews(reactions, uid, now) : null
}
