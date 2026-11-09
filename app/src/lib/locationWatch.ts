// Keeps a location fix fresh while a capture screen is open and the app is in
// front, so the photo has one at the shutter. Stops when the app goes to the
// background (no background location) and after WATCH_FOR_MS in front; the
// next return to the app starts it again. Never asks for permission.
// The plugin is wired in location.ts; this part is plain so it can be tested.

export const WATCH_FOR_MS = 10 * 60_000

export interface WatchDeps {
  /** Location already allowed (no prompt). */
  allowed: () => Promise<boolean>
  /** Start watching; resolves to a function that stops it. */
  start: () => Promise<() => void>
  visible: () => boolean
  /** Call back on every visibility change; returns an unsubscribe. */
  onVisibility: (cb: () => void) => () => void
}

/** Start keeping the fix fresh; returns a function that stops for good. */
export function freshWhileVisible(deps: WatchDeps): () => void {
  let stopWatch: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let gen = 0
  let done = false

  const stop = () => {
    gen++
    clearTimeout(timer)
    stopWatch?.()
    stopWatch = null
  }
  const start = async () => {
    if (done || stopWatch || !deps.visible()) return
    const mine = ++gen
    try {
      if (!(await deps.allowed()) || mine !== gen || done) return
      const s = await deps.start()
      if (mine !== gen || done) { s(); return }
      stopWatch = s
      timer = setTimeout(stop, WATCH_FOR_MS)
    } catch {
      // No location service: the shutter's one-shot attempt still runs.
    }
  }
  const unsubscribe = deps.onVisibility(() => { if (deps.visible()) void start(); else stop() })
  void start()
  return () => { done = true; stop(); unsubscribe() }
}
