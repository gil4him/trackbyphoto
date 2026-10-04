/**
 * One model at a time. The Mac mini has 16 GB shared by the memo vision
 * model and speech-to-text; running both at once would push it into swap.
 */

let chain: Promise<unknown> = Promise.resolve()

export function withModelLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => {})
  return run
}
