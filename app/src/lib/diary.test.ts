import { describe, it, expect } from 'vitest'
import { collapseParents, type ParentMemo } from './diary'
import type { Memo } from '../types'

const pm = (id: string, uid: string): ParentMemo => ({ memo: { id, patientUid: uid } as unknown as Memo, name: uid, color: 'x' })
const parent = (id: string, uid: string, at: number) => ({ kind: 'parent' as const, at, item: pm(id, uid) })
const mine = (id: string, at: number) => ({ kind: 'mine' as const, at, memo: { id } as unknown as Memo })

describe('collapseParents (A14.3)', () => {
  it('two or more photos of one parent with nothing between them become one row', () => {
    const rows = collapseParents([parent('a', 'mom', 3), parent('b', 'mom', 2), parent('c', 'mom', 1)])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'parentGroup', uid: 'mom', at: 3 })
    expect((rows[0] as { items: ParentMemo[] }).items.map((i) => i.memo.id)).toEqual(['a', 'b', 'c'])
  })
  it('one\'s own photo, or the other parent, in between keeps them apart', () => {
    expect(collapseParents([parent('a', 'mom', 3), mine('m', 2), parent('b', 'mom', 1)]).map((r) => r.kind)).toEqual(['parent', 'mine', 'parent'])
    expect(collapseParents([parent('a', 'mom', 3), parent('d', 'dad', 2), parent('b', 'mom', 1)]).map((r) => r.kind)).toEqual(['parent', 'parent', 'parent'])
  })
  it('a single photo stays a plain row; runs at the edges fold too', () => {
    const rows = collapseParents([parent('a', 'mom', 5), parent('b', 'mom', 4), mine('m', 3), parent('d', 'dad', 2), parent('e', 'dad', 1)])
    expect(rows.map((r) => r.kind)).toEqual(['parentGroup', 'mine', 'parentGroup'])
    expect(collapseParents([parent('a', 'mom', 1)]).map((r) => r.kind)).toEqual(['parent'])
    expect(collapseParents([])).toEqual([])
  })
})
