// 운영실 기능 스위치: the list matches the worker's flags, risky ones ask first,
// and the change history reads newest first.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('./worker', () => ({ callWorker: vi.fn() }))

import { FLAGS, flagChanges } from './adminFlags'

describe('기능 스위치', () => {
  it('lists exactly the worker\'s PLAN_FLAGS, each with a Korean name', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../worker/src/plans.ts', import.meta.url)), 'utf8')
    const workerFlags = [...src.match(/PLAN_FLAGS = \[([^\]]+)\]/)![1].matchAll(/'(\w+)'/g)].map((m) => m[1])
    expect(FLAGS.map((f) => f.key).sort()).toEqual([...workerFlags].sort())
    expect(FLAGS.every((f) => /[가-힣]/.test(f.name))).toBe(true)
  })

  it('asks first for the ones that delete, cost money or take payment', () => {
    const risky = FLAGS.filter((f) => f.confirm).map((f) => f.key)
    for (const k of ['retentionJob', 'cloudMemo', 'usageCaps', 'payments']) expect(risky).toContain(k)
    expect(FLAGS.find((f) => f.key === 'retentionJob')!.confirm!.on).toContain('되돌릴 수 없어요')
  })

  it('reads the last flag changes, newest first, ignoring other admin actions', () => {
    const at = (iso: string) => ({ toDate: () => new Date(iso) })
    const rows = [
      { action: 'flag.set', details: { flag: 'digest', from: false, to: true }, timestamp: at('2026-10-20T00:00:00Z') },
      { action: 'account.disable', details: {}, timestamp: at('2026-10-22T00:00:00Z') },
      { action: 'flag.set', details: { flag: 'cloudMemo', from: true, to: false }, timestamp: at('2026-10-23T00:00:00Z') },
    ]
    expect(flagChanges(rows).map((c) => [c.name, c.to])).toEqual([['클라우드 AI 메모', false], ['하루 요약', true]])
    expect(flagChanges(rows, 1)).toHaveLength(1)
  })
})
