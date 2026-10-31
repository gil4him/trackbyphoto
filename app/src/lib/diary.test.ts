import { describe, it, expect } from 'vitest'
import { collapseParents, isNewParentPhoto, type ParentMemo } from './diary'
import type { Memo } from '../types'

const pm = (id: string, uid: string): ParentMemo => ({ memo: { id, patientUid: uid } as unknown as Memo, name: uid, color: 'x' })
const parent = (id: string, uid: string, at: number) => ({ kind: 'parent' as const, at, item: pm(id, uid) })
const mine = (id: string, at: number) => ({ kind: 'mine' as const, at, memo: { id } as unknown as Memo })

describe('collapseParents', () => {
  const kinds = (rows: { kind: string }[]) => rows.map((r) => r.kind)

  it('stacks all of a parent\'s old photos where the first was, even with rows between', () => {
    const rows = collapseParents([parent('a', 'mom', 4), mine('m', 3), parent('b', 'mom', 2), parent('c', 'mom', 1)])
    expect(kinds(rows)).toEqual(['parentGroup', 'mine'])
    expect(rows[0]).toMatchObject({ uid: 'mom', at: 4 })
    expect((rows[0] as { items: ParentMemo[] }).items.map((i) => i.memo.id)).toEqual(['a', 'b', 'c'])
  })

  it('gives each parent their own stack', () => {
    const rows = collapseParents([parent('a', 'mom', 4), parent('d', 'dad', 3), parent('b', 'mom', 2), parent('e', 'dad', 1)])
    expect(rows).toMatchObject([{ kind: 'parentGroup', uid: 'mom' }, { kind: 'parentGroup', uid: 'dad' }])
  })

  it('leaves new photos as their own rows, and stacks only the old', () => {
    const fresh = (p: ParentMemo) => p.memo.id === 'a' || p.memo.id === 'b'
    const rows = collapseParents([parent('a', 'mom', 4), parent('b', 'mom', 3), parent('c', 'mom', 2), parent('d', 'mom', 1)], fresh)
    expect(kinds(rows)).toEqual(['parent', 'parent', 'parentGroup'])
    expect((rows[2] as { items: ParentMemo[] }).items.map((i) => i.memo.id)).toEqual(['c', 'd'])
  })

  it('a parent\'s only old photo stays a plain row', () => {
    expect(kinds(collapseParents([parent('a', 'mom', 2), parent('b', 'mom', 1)], (p) => p.memo.id === 'a'))).toEqual(['parent', 'parent'])
    expect(kinds(collapseParents([parent('a', 'mom', 1)]))).toEqual(['parent'])
    expect(collapseParents([])).toEqual([])
  })
})

describe('isNewParentPhoto', () => {
  const memo = (takenMs: number, createdMs?: number) => ({
    takenAt: { toDate: () => new Date(takenMs) },
    ...(createdMs ? { createdAt: { toMillis: () => createdMs } } : {}),
  }) as unknown as Memo

  it('goes by when the photo reached the family, so a late upload still counts', () => {
    expect(isNewParentPhoto(memo(100, 300), 200)).toBe(true)
    expect(isNewParentPhoto(memo(100, 150), 200)).toBe(false)
  })
  it('falls back to when it was taken', () => {
    expect(isNewParentPhoto(memo(300), 200)).toBe(true)
    expect(isNewParentPhoto(memo(100), 200)).toBe(false)
  })
})
