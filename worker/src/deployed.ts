import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Which commit this copy of the worker was built from: scripts/install.sh
 * writes DEPLOYED next to dist/ (commit, branch, date, checkout). Logged at
 * start so anyone can tell from the log what is running. 'unknown' for a
 * copy installed before the file existed, or run from a checkout.
 */
export function deployedCommit(file = join(dirname(fileURLToPath(import.meta.url)), '..', 'DEPLOYED')): string {
  try {
    const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('commit='))
    return line ? line.slice('commit='.length).trim() || 'unknown' : 'unknown'
  } catch {
    return 'unknown'
  }
}
