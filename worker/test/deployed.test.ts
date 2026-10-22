// The commit the running worker was built from, as install.sh records it.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deployedCommit } from '../src/deployed'

describe('deployedCommit', () => {
  it('reads the commit line install.sh writes, and says unknown without one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deployed-'))
    const file = join(dir, 'DEPLOYED')
    writeFileSync(file, 'commit=abc1234def\nbranch=main\ndate=2026-10-22T08:00:00Z\ncheckout=/x\n')
    expect(deployedCommit(file)).toBe('abc1234def')
    expect(deployedCommit(join(dir, 'missing'))).toBe('unknown')
    writeFileSync(file, 'branch=main\n')
    expect(deployedCommit(file)).toBe('unknown')
  })
})
