import { useEffect, useRef } from 'react'
import { IDLE_RETURN_MS, watchIdle } from '../lib/idle'

/** While `active`, calls `onIdle` after a minute with no touch on the page. */
export function useIdleReturn(active: boolean, onIdle: () => void, ms = IDLE_RETURN_MS) {
  const latest = useRef(onIdle)
  useEffect(() => { latest.current = onIdle }, [onIdle])
  useEffect(() => {
    if (!active) return
    return watchIdle(document, ms, () => latest.current())
  }, [active, ms])
}
