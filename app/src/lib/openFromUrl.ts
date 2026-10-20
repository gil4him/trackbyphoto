import { digestIdFromPath } from './digest'

/** Something a tapped notification (or a link) asks the app to open. */
export type OpenTarget =
  | { kind: 'memo'; patientUid: string; memoId: string }
  | { kind: 'home' | 'today'; patientUid: string }
  | { kind: 'digest'; digestId: string }

const OPEN_KEYS = ['open', 'p', 'm']

/**
 * `/?open=memo&p=<patient>&m=<memo>`, `/?open=home&p=…`, `/?open=today&p=…`
 * (the worker's push links, worker/src/handlers/push.ts openPath) or
 * `/digest/<id>`. Null for anything else.
 */
export function parseOpen(link: string): OpenTarget | null {
  let url: URL
  try { url = new URL(link, 'https://app.invalid') } catch { return null }
  const digestId = digestIdFromPath(url.pathname)
  if (digestId) return { kind: 'digest', digestId }
  const q = url.searchParams
  const kind = q.get('open')
  const patientUid = q.get('p') ?? ''
  if (!patientUid) return null
  if (kind === 'memo') {
    const memoId = q.get('m') ?? ''
    return memoId ? { kind, patientUid, memoId } : { kind: 'today', patientUid }
  }
  if (kind === 'home' || kind === 'today') return { kind, patientUid }
  return null
}

/** What the address this page was opened with asks for (`?open=…` only; the
 *  digest path is read by App itself). The open/p/m keys are dropped from the
 *  address so a reload doesn't open it again. */
export function openFromUrl(): OpenTarget | null {
  if (typeof window === 'undefined') return null
  const { pathname, search, hash } = window.location
  const q = new URLSearchParams(search)
  if (!q.has('open')) return null
  const target = parseOpen(`${pathname}${search}`)
  for (const k of OPEN_KEYS) q.delete(k)
  const rest = q.toString()
  window.history.replaceState(null, '', `${pathname}${rest ? `?${rest}` : ''}${hash}`)
  return target
}
